/**
 * Mantieni attivi (SPECIFICA 5.4, regole dell'utente del 2026-11-15): un incantesimo si
 * rilancia solo quando è **finito** (finché è attivo il MUD non lo rilancia, quindi niente
 * rilanci in anticipo). Se finisce in combattimento si aspetta la fine del combattimento e il
 * loot del cadavere. Il costo in mana si impara dal prompt (MP prima e dopo un lancio
 * riuscito); senza mana sufficienti, o mentre gira una sequenza (percorso, cambio di set), il
 * rilancio aspetta.
 */
export interface KeepEntry {
  incantesimo: string;
  /** Bersaglio: `{pg}` = te stesso; vuoto = nessun bersaglio. */
  bersaglio: string;
  /** false = resta in elenco ma non si rilancia da solo (il ⟳ a mano funziona). */
  attivo?: boolean;
}

export interface KeepHost {
  now(): number;
  /** Manda il lancio (l'host lo scrive nell'output col motivo). */
  cast(cmd: string, motivo: string): void;
  info(text: string, level?: 'info' | 'warn'): void;
  /** Gira una sequenza: niente lanci in mezzo (confonderebbero i passi). */
  busy(): boolean;
  /** Si può lanciare: collegati, non si sta scrivendo la password. */
  ready(): boolean;
  /** Richiama `fn` dopo `ms` (per riprovare anche se non arrivano prompt). */
  later(fn: () => void, ms: number): void;
}

/**
 * Un lancio alla volta: il MUD mette i comandi in coda e li esegue uno dopo l'altro (circa 3 s
 * per incantesimo). Mandandoli tutti insieme "Pronunci le parole" degli ultimi arrivava oltre il
 * tempo di attesa e l'incantesimo partiva due volte (log reale del 2026-11-16: fireshield
 * lanciato di nuovo quando era già attivo). Si riprova solo se il MUD tace per tanto.
 */
const RETRY_MS = 8000;
const MAX_TRIES = 3;
/** Dopo l'ultima riga di loot, il loot è finito se per tanto non ne arrivano altre. */
const LOOT_QUIET_MS = 1500;
/** Mob ucciso ma nessun loot: si rilancia comunque dopo questo tempo. */
const NO_LOOT_MS = 6000;
/** Loot mandato ma risposte che non arrivano (lag, messaggi sconosciuti): al massimo tanto. */
const MAX_LOOT_MS = 15000;

interface Pending {
  entry: KeepEntry;
  motivo: string;
  /** Tentativi già fatti. */
  tentativi: number;
  /** Ora dell'ultimo lancio (0 = non ancora lanciato). */
  lanciato: number;
}

export const norm = (s: string) => s.trim().toLowerCase();

export function castCommand(e: KeepEntry): string {
  const t = e.bersaglio.trim();
  return `cast '${e.incantesimo}'${t ? ` ${t}` : ''}`;
}

export class KeepActive {
  enabled = false;
  entries: KeepEntry[] = [];
  /** Incantesimo → mana (imparato dal prompt). */
  costs: Record<string, number> = {};
  /** Chiamata quando si impara un costo (l'app lo salva). */
  onCostLearned?: (costs: Record<string, number>) => void;
  onChange?: () => void;

  private pending = new Map<string, Pending>();
  private mp: number | undefined;
  /** Lancio riuscito in attesa del prompt per misurarne il costo. */
  private measuring: { nome: string; prima: number } | null = null;
  private fighting = false;
  /** Mob ucciso nel combattimento in corso. */
  private killedNow = false;
  /** Dopo un combattimento con un mob ucciso: si aspetta il loot del cadavere. */
  private after: { since: number; lastLoot: number; pending: number } | null = null;
  /** Comandi di loot mandati prima del prompt che chiude il combattimento, ancora senza risposta. */
  private lootEarly = 0;
  /** Zona senza magia ("Il mana si rifuta di scorrere"): si riprova nella prossima stanza. */
  private noMagic = false;

  constructor(private readonly host: KeepHost) {}

  /** Incantesimi in attesa di rilancio (per il pannello). */
  get waiting(): { nome: string; motivo: string; tentativi: number }[] {
    return [...this.pending.values()].map((p) => ({
      nome: p.entry.incantesimo,
      motivo: p.motivo,
      tentativi: p.tentativi,
    }));
  }

  private entry(nome: string): KeepEntry | undefined {
    const n = norm(nome);
    return this.entries.find((e) => norm(e.incantesimo) === n);
  }

  reset(): void {
    this.pending.clear();
    this.measuring = null;
    this.mp = undefined;
    this.fighting = false;
    this.killedNow = false;
    this.after = null;
    this.noMagic = false;
    this.onChange?.();
  }

  /**
   * "Il mana si rifuta di scorrere in questa zona.": il lancio non conta come tentativo e si
   * riprova solo cambiando stanza (log reale del 2026-11-18: major invulnerability tre volte
   * nella banca di Myst).
   */
  noMagicZone(): void {
    this.noMagic = true;
    for (const p of this.pending.values()) {
      if (p.lanciato) {
        p.lanciato = 0;
        p.tentativi = Math.max(0, p.tentativi - 1);
      }
      if (!p.motivo.includes('zona senza magia')) p.motivo = `${p.motivo}, zona senza magia`;
    }
    this.onChange?.();
  }

  /** Entrato in un'altra stanza. */
  room(): void {
    if (!this.noMagic) return;
    this.noMagic = false;
    for (const p of this.pending.values()) p.motivo = p.motivo.replace(', zona senza magia', '');
    this.flush();
  }

  /**
   * Un incantesimo è finito (`avviso` = sta solo per finire: è ancora attivo e il MUD non lo
   * rilancerebbe, quindi si aspetta la fine vera).
   */
  wearOff(nome: string, avviso: boolean): void {
    const e = this.entry(nome);
    if (!e || e.attivo === false || !this.enabled || avviso) return;
    this.request(e, 'finito');
  }

  /** Inizio o fine del combattimento (tank o bersaglio nel prompt). */
  fight(inizio: boolean): void {
    if (inizio) {
      this.fighting = true;
      this.after = null;
      this.lootEarly = 0;
      return;
    }
    if (!this.fighting) return;
    this.fighting = false;
    if (this.killedNow) {
      this.after = this.newAfter();
      this.host.later(() => this.flush(), NO_LOOT_MS + 50);
    }
    this.killedNow = false;
    this.flush();
  }

  /** Un mob ucciso da te ("Il tuo sangue si gela al grido di morte di…"). */
  killed(): void {
    if (this.fighting) this.killedNow = true;
    else if (!this.after) {
      // il messaggio può arrivare subito dopo il prompt che chiude il combattimento
      this.after = this.newAfter();
      this.host.later(() => this.flush(), NO_LOOT_MS + 50);
    }
  }

  private newAfter(): { since: number; lastLoot: number; pending: number } {
    const now = this.host.now();
    const a = { since: now, lastLoot: this.lootEarly ? now : 0, pending: this.lootEarly };
    this.lootEarly = 0;
    this.host.later(() => this.flush(), MAX_LOOT_MS + 50);
    return a;
  }

  /** Una riga di loot ("Prendi … da il corpo di …", "… da a pile of dust and bones."). */
  looted(): void {
    this.lootReply();
  }

  /** Risposta di loot senza niente ("Non vedi nessun corp."). */
  lootNone(): void {
    this.lootReply();
  }

  private lootReply(): void {
    if (!this.after) {
      if (this.fighting) this.lootEarly = Math.max(0, this.lootEarly - 1);
      return;
    }
    this.after.lastLoot = this.host.now();
    this.after.pending = Math.max(0, this.after.pending - 1);
    this.host.later(() => this.flush(), LOOT_QUIET_MS + 50);
  }

  /**
   * Mandato un comando di loot (`get all.coin corp`): si aspetta la sua risposta. Di solito parte
   * quando muore il mob, prima del prompt che chiude il combattimento (log reale).
   */
  lootSent(): void {
    if (this.after) {
      this.after.pending += 1;
      this.after.lastLoot = this.host.now();
    } else if (this.fighting) this.lootEarly += 1;
  }

  /** In combattimento, o subito dopo mentre si fa il loot del cadavere. */
  private holding(): boolean {
    if (this.fighting) return true;
    const a = this.after;
    if (!a) return false;
    const now = this.host.now();
    // Loot finito: nessuna risposta attesa e un attimo di calma; nessun loot: qualche secondo;
    // in ogni caso non oltre MAX_LOOT_MS (log reale: risposte arrivate 7,5 s dopo per il lag).
    const done =
      now - a.since >= MAX_LOOT_MS ||
      (a.pending === 0 &&
        (a.lastLoot ? now - a.lastLoot >= LOOT_QUIET_MS : now - a.since >= NO_LOOT_MS));
    if (done) this.after = null;
    return !done;
  }

  /** "Pronunci le parole": il lancio è partito. */
  spellCast(nome: string): void {
    const n = norm(nome);
    if (this.mp !== undefined) this.measuring = { nome: n, prima: this.mp };
    if (this.pending.delete(n)) this.onChange?.();
  }

  /** Prompt: impara il costo, poi riprova i rilanci in attesa. */
  prompt(mp: number | undefined): void {
    if (mp !== undefined) {
      const m = this.measuring;
      this.measuring = null;
      if (m && m.prima > mp && m.prima - mp < 2000) {
        // Tra un prompt e l'altro i mana possono anche risalire (rigenerazione): la differenza
        // misurata è al massimo il costo vero, quindi si tiene la più alta vista (log reale:
        // shield misurato 1).
        const cost = Math.max(m.prima - mp, this.costs[m.nome] ?? 0);
        if (this.costs[m.nome] !== cost) {
          this.costs = { ...this.costs, [m.nome]: cost };
          this.onCostLearned?.(this.costs);
        }
      }
      this.mp = mp;
    }
    this.flush();
  }

  /**
   * "Non c'e' nessuno con quel nome qui." mentre un rilancio aspetta risposta: il bersaglio non
   * si trova (log reale: invisibile senza detect invisibility, il tuo nome non ti trova). Inutile
   * riprovare.
   */
  targetMissing(): void {
    const now = this.host.now();
    for (const [n, p] of this.pending) {
      if (!p.lanciato || now - p.lanciato >= RETRY_MS) continue;
      this.pending.delete(n);
      this.host.info(
        `${p.entry.incantesimo}: "${p.entry.bersaglio || 'nessun bersaglio'}" non si trova ` +
          '(sei invisibile senza detect invisibility?). Non lo rilancio finché non finisce di nuovo.',
        'warn',
      );
      this.onChange?.();
      this.flush();
      return;
    }
  }

  /** Lancia ora (comando del pannello o `mantieni lancia`). */
  castNow(nome: string): void {
    const e = this.entry(nome);
    if (e) this.request(e, 'a mano', true);
  }

  private request(e: KeepEntry, motivo: string, force = false): void {
    const n = norm(e.incantesimo);
    if (!this.pending.has(n)) this.pending.set(n, { entry: e, motivo, tentativi: 0, lanciato: 0 });
    else if (force) this.pending.get(n)!.lanciato = 0;
    this.onChange?.();
    this.flush();
  }

  /** Spento dal pannello mentre aspettava: resta solo un lancio chiesto a mano. */
  prune(): void {
    for (const [n, p] of this.pending) {
      if (this.entry(n)?.attivo !== false || p.motivo.startsWith('a mano')) continue;
      this.pending.delete(n);
      this.onChange?.();
    }
  }

  /** Riprova i rilanci in attesa (anche quando finisce una sequenza). */
  flush(): void {
    this.prune();
    if (!this.host.ready() || this.host.busy() || this.noMagic) return;
    if (this.holding()) {
      for (const p of this.pending.values()) {
        if (!p.motivo.includes('combattimento')) {
          p.motivo = `${p.motivo}, aspetto la fine del combattimento e il loot`;
          this.onChange?.();
        }
      }
      return;
    }
    const now = this.host.now();
    // uno alla volta: finché un lancio aspetta risposta non ne parte un altro
    for (const p of this.pending.values()) if (p.lanciato && now - p.lanciato < RETRY_MS) return;
    for (const [n, p] of this.pending) {
      if (p.tentativi >= MAX_TRIES) {
        this.pending.delete(n);
        this.host.info(
          `${p.entry.incantesimo}: ${MAX_TRIES} tentativi senza "Pronunci le parole", rinuncio.`,
          'warn',
        );
        continue;
      }
      const cost = this.costs[n];
      p.motivo = p.motivo.replace(/, aspetto la fine del combattimento e il loot/, '');
      if (cost !== undefined && this.mp !== undefined && this.mp < cost) {
        if (p.motivo.indexOf('mana') < 0) {
          p.motivo = `${p.motivo}, aspetto i mana (${this.mp}/${cost})`;
          this.onChange?.();
        }
        continue;
      }
      p.tentativi += 1;
      p.lanciato = now;
      this.host.later(() => this.flush(), RETRY_MS + 100);
      this.host.cast(
        castCommand(p.entry),
        `${p.entry.incantesimo} ${p.motivo.replace(/, aspetto (i mana|la fine del combattimento).*$/, '')}` +
          (p.tentativi > 1 ? ` (tentativo ${p.tentativi})` : ''),
      );
      this.onChange?.();
      return;
    }
  }
}

/** Lettura tollerante di una voce salvata (il vecchio campo `quando` si ignora). */
export function parseKeepEntry(v: unknown): KeepEntry | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (typeof d.incantesimo !== 'string' || !d.incantesimo.trim()) return null;
  return {
    incantesimo: d.incantesimo.trim(),
    bersaglio: typeof d.bersaglio === 'string' ? d.bersaglio : '{pg}',
    ...(d.attivo === false ? { attivo: false } : {}),
  };
}

/** Gli incantesimi rinnovati dal pacchetto Mudlet (per il pulsante "aggiungi i classici"). */
export const MUDLET_KEEP: KeepEntry[] = [
  { incantesimo: 'stone skin', bersaglio: '' },
  { incantesimo: 'minor invulnerability', bersaglio: '' },
  { incantesimo: 'major invulnerability', bersaglio: '' },
  { incantesimo: 'armor', bersaglio: '{pg}' },
  { incantesimo: 'shield', bersaglio: '{pg}' },
  { incantesimo: 'strength', bersaglio: '{pg}' },
  { incantesimo: 'fly', bersaglio: '{pg}' },
];
