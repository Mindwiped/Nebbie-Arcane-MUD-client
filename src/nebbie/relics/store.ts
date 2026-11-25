import {
  addIdentify,
  cleanContainers,
  emptyDb,
  identifiesFromText,
  parseDb,
  saveEquipment,
  serializeDb,
  type IdentifyCapture,
  type RelicDb,
  type WornPiece,
} from './reliquiario';
import { emptyMobDb, parseMobDb, type MobDb } from './bestiario';

/** Accesso a identi.js nella cartella scelta (nei test un finto). */
export interface RelicHost {
  read(cartella: string): Promise<string | null>;
  write(cartella: string, testo: string): Promise<void>;
  /** mob.js nella stessa cartella (assente = niente bestiario). */
  readMobs?(cartella: string): Promise<string | null>;
  info(text: string, level?: 'info' | 'warn'): void;
  now(): number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function day(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const minute = (t: number) => {
  const d = new Date(t);
  return `${day(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Il Reliquiario del client: una copia in memoria (per i pannelli) e gli aggiornamenti scritti
 * su identi.js. Ogni aggiornamento rilegge il file prima di scriverlo: la pagina identi.html (o
 * Mudlet) può averlo cambiato nel frattempo. Gli aggiornamenti vanno in fila, uno alla volta.
 */
export class RelicStore {
  /** Cartella di identi.js; vuota = Reliquiario spento. */
  cartella = '';
  db: RelicDb = emptyDb();
  /** Bestiario (mob.js), se c'è: solo lettura. */
  mobDb: MobDb = emptyMobDb();
  /** Il file c'è ma non si legge: non si scrive finché non si sistema. */
  errore?: string;
  /** Cresce a ogni cambio (i pannelli ridisegnano). */
  versione = 0;
  onChange?: () => void;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly host: RelicHost) {}

  get attivo(): boolean {
    return this.cartella !== '';
  }

  /** Cambia cartella (vuota = spento) e rilegge. */
  setFolder(cartella: string): Promise<void> {
    this.cartella = cartella.trim().replace(/\/+$/, '');
    if (!this.cartella) {
      this.db = emptyDb();
      this.mobDb = emptyMobDb();
      this.errore = undefined;
      this.changed();
      return this.queue;
    }
    return this.reload();
  }

  /** Rilegge identi.js (dopo una modifica fatta con la pagina). */
  reload(): Promise<void> {
    return this.enqueue(async () => {
      this.db = await this.load();
      this.mobDb = await this.loadMobs();
      this.changed();
    });
  }

  /** Un identify finito: lo aggiunge o lo aggiorna. Restituisce la chiave dell'oggetto. */
  identify(
    c: IdentifyCapture,
    nome: string | undefined,
    pg: string | undefined,
  ): Promise<{ chiave: string; nome: string; contenitore?: string } | undefined> {
    return this.update((db) => {
      const r = addIdentify(db, c, day(this.host.now()), nome, pg);
      const n = Object.keys(db.oggetti).length;
      const titolo = r.oggetto.nome ?? r.chiave;
      this.host.info(
        `${r.nuovo ? 'nuovo' : 'aggiornato'}: ${titolo} (${n} oggetti nel Reliquiario)`,
      );
      return { chiave: r.chiave, nome: titolo, contenitore: r.oggetto.contenitore };
    });
  }

  /**
   * Importa gli identify di un testo incollato. `contenitore`: dove li tieni (vuoto = nessuno;
   * undefined = lascia quello che avevano).
   */
  importText(
    testo: string,
    contenitore: string | undefined,
  ): Promise<{ nuovi: number; aggiornati: number } | undefined> {
    const caps = identifiesFromText(testo);
    if (!caps.length) return Promise.resolve({ nuovi: 0, aggiornati: 0 });
    return this.update((db) => {
      let nuovi = 0;
      for (const c of caps) {
        const r = addIdentify(db, c, day(this.host.now()));
        if (r.nuovo) nuovi++;
        if (contenitore) r.oggetto.contenitore = contenitore;
        else if (contenitore === '') delete r.oggetto.contenitore;
      }
      if (contenitore) db.contenitori = cleanContainers([...(db.contenitori ?? []), contenitore]);
      this.host.info(
        `importati ${caps.length} identify: ${nuovi} nuovi, ${caps.length - nuovi} aggiornati` +
          (contenitore ? `, nel contenitore "${contenitore}"` : '') +
          '.',
      );
      return { nuovi, aggiornati: caps.length - nuovi };
    });
  }

  /** Contenitore di un oggetto (vuoto = non in un contenitore). */
  setContainer(chiave: string, contenitore: string): Promise<void> {
    return this.update((db) => {
      const o = db.oggetti[chiave];
      if (!o) return;
      const c = contenitore.trim();
      if (c) {
        o.contenitore = c;
        db.contenitori = cleanContainers([...(db.contenitori ?? []), c]);
      } else delete o.contenitore;
    }).then(() => undefined);
  }

  /** Nomi dei contenitori proposti nei menu. */
  setContainers(nomi: string[]): Promise<void> {
    return this.update((db) => {
      db.contenitori = cleanContainers(nomi);
    }).then(() => undefined);
  }

  /** Un `eq` letto: lo salva per il pg così com'è (anche vuoto: non indossi niente). */
  equipment(pg: string, eq: WornPiece[]): Promise<void> {
    return this.update<void>((db) => {
      saveEquipment(db, pg, eq, minute(this.host.now()));
    }).then(() => undefined);
  }

  private async update<T>(fn: (db: RelicDb) => T): Promise<T | undefined> {
    if (!this.attivo) {
      await this.queue;
      return undefined;
    }
    let out: T | undefined;
    await this.enqueue(async () => {
      const db = await this.load();
      if (this.errore) return;
      const r = fn(db);
      db.aggiornato = minute(this.host.now());
      await this.host.write(this.cartella, serializeDb(db));
      this.db = db;
      out = r;
      this.changed();
    });
    return out;
  }

  private async load(): Promise<RelicDb> {
    const prima = this.errore;
    this.errore = undefined;
    let testo: string | null;
    try {
      testo = await this.host.read(this.cartella);
    } catch (e) {
      this.errore = `non riesco a leggere identi.js: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!this.errore)
      try {
        return parseDb(testo!);
      } catch {
        this.errore = 'identi.js non si legge (modificato a mano?): non lo tocco.';
      }
    if (this.errore !== prima) this.host.info(this.errore!, 'warn');
    return this.db;
  }

  private async loadMobs(): Promise<MobDb> {
    if (!this.host.readMobs) return emptyMobDb();
    try {
      const t = await this.host.readMobs(this.cartella);
      return t ? parseMobDb(t) : emptyMobDb();
    } catch (e) {
      this.host.info(`mob.js non si legge: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      return this.mobDb;
    }
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn).catch((e: unknown) => {
      this.host.info(
        `identi.js non salvato: ${e instanceof Error ? e.message : String(e)}`,
        'warn',
      );
    });
    return this.queue;
  }

  private changed(): void {
    this.versione++;
    this.onChange?.();
  }
}
