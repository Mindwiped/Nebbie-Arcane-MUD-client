import type { Dir, NebbieEvents, RoomEvent } from '../parser/types';
import { dirOf, isNeverStep, runDir } from '../paths/moves';
import {
  DELTA,
  DIRS,
  emptyMap,
  normName,
  OPP,
  seenOf,
  type MapData,
  type MapRoom,
  type Seen,
} from './model';

/**
 * Mapper automatico (SPECIFICA 4.2): costruisce la mappa mentre giochi. Ogni comando mandato
 * aspetta il suo prompt; le stanze che arrivano prima del prompt sono la sua risposta (un `run`
 * ne porta più d'una). Camminando, una stanza già nota si riusa solo con una prova positiva;
 * arrivando senza passo (portal, recall…) si cerca la stanza per firma, altrimenti nasce
 * un'isola.
 */
interface Pending {
  cmd: string;
  dir?: Dir;
  failed: boolean;
}

/** Comandi che spostano senza una direzione (portali, incantesimi di viaggio). */
const TRAVEL =
  /^(enter|entra|recall|astral|doorway|portal|climb|board|sali|scendi|jump|salta)\b|^cast '(teleport|portal|word of recall|astral walk|doorway|summon)/i;

export interface MapperInfo {
  text: string;
  level?: 'info' | 'warn';
}

export class Mapper {
  data: MapData = emptyMap();
  cur: number | null = null;
  enabled = true;
  /**
   * Registrazione (interruttore MAPPER, richiesta dell'utente del 2026-11-15): solo quando è
   * accesa il mapper crea, collega e marca le stanze. Spenta, segue la posizione sulle stanze
   * già note e non tocca la mappa. Si accende a mano e parte sempre spenta.
   */
  registra = false;
  /** Zona in cui finiscono le stanze nuove mentre si registra. */
  zonaRegistra: number | null = null;
  /** Chiamata quando cambia la mappa (`salva` = c'è da salvare) o la posizione. */
  onChange?: (salva: boolean) => void;
  onInfo?: (m: MapperInfo) => void;
  /** Lascia `n` monete per terra (una alla volta) per marcare la stanza attuale. */
  onMark?: (n: number) => boolean;

  private queue: Pending[] = [];
  /** `open …` riuscito nella stanza attuale: va sulla porta del prossimo passo. */
  private opened: { room: number; cmd: string } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  load(data: MapData): void {
    this.data = data;
    this.cleanMarks();
    this.cur = null;
    this.queue = [];
    this.onChange?.(false);
  }

  get current(): MapRoom | undefined {
    return this.cur === null ? undefined : this.data.stanze[this.cur];
  }

  // ---------- eventi ----------

  command(cmd: string): void {
    const c = cmd.trim();
    if (!this.enabled || !c) return;
    const d = (dirOf(c) ?? runDir(c)) as Dir | undefined;
    this.queue.push({ cmd: c, ...(d ? { dir: d } : {}), failed: false });
  }

  moveFailed(f: NebbieEvents['moveFailed']): void {
    const h = this.queue[0];
    if (h?.dir && f.motivo !== 'fineRun') h.failed = true;
  }

  door(d: NebbieEvents['door']): void {
    const h = this.queue[0];
    if (d.azione === 'aperta' && !d.chi && h && /^(open|apri)\s/i.test(h.cmd) && this.cur !== null)
      this.opened = { room: this.cur, cmd: h.cmd };
  }

  /** Il prompt chiude il comando più vecchio in attesa. */
  prompt(): void {
    this.queue.shift();
  }

  room(ev: RoomEvent): void {
    if (!this.enabled || ev.guardata) return;
    const st = seenOf(ev);
    const h = this.queue[0];
    if (!this.registra) return this.follow(st, h && !h.failed ? h.dir : undefined);
    if (h?.dir && !h.failed && this.cur !== null && this.data.stanze[this.cur])
      this.step(h.dir, st);
    else if (h && !h.dir) this.arrive(st, h.cmd, h.dir);
    else this.arrive(st, null, h?.dir);
  }

  // ---------- camminando ----------

  private step(d: Dir, st: Seen): void {
    const c = this.data.stanze[this.cur!];
    if (this.opened?.room === c.id) {
      c.porte = { ...c.porte, [d]: { ...c.porte?.[d], apri: this.opened.cmd } };
    }
    this.opened = null;
    // Stanze identiche (stessa descrizione e stesse uscite) nella stessa zona: le monete per
    // terra dicono quale è (idea dell'utente, 2026-11-14). N monete = la stanza marcata con N,
    // anche se ci arrivi da una direzione illogica; nessuna moneta = non è una di quelle marcate.
    const known = this.markersOn ? this.twins(st, c.zona) : [];
    let exclude = new Set<number>();
    if (known.length && !st.mucchio) {
      if (st.monete > 0) {
        const r = known.find((t) => t.marca === st.monete);
        if (r) {
          if (c.uscite[d] !== r.id) {
            this.info(
              `${st.monete} monete per terra: è la stanza ${r.id}, uscita ${d} collegata lì.`,
            );
            this.link(c, r, d, st);
          }
          return this.enter(r, st);
        }
      } else {
        // Nessuna moneta: non è nessuna delle stanze marcate, TRANNE quella che la posizione
        // indica (uscita nota o punto atteso coerente): lì le monete possono essere sparite
        // (raccolte da altri su una strada trafficata, log reale del 2026-11-15: doppione 139
        // della 123 sulla Strada Carovaniera dell'Ovest). Si riusa e le monete si rimettono.
        const here = this.atExpected(d, st, c);
        exclude = new Set(
          known.filter((t) => t.marca !== undefined && t.id !== here?.id).map((t) => t.id),
        );
      }
    }
    const r = this.choose(d, st, c, exclude);
    this.joinIsland(c, r);
    this.enter(r, st);
    // Si marca solo se c'è davvero un'ALTRA stanza identica (la stanza stessa non conta).
    if (!this.markersOn || st.mucchio || !this.twins(st, r.zona).some((t) => t.id !== r.id)) return;
    if (st.monete === 0) {
      // Con altri passi già mandati (es. "n;n;e" scritto di fila) il drop arriverebbe al MUD
      // dopo di loro e le monete cadrebbero più avanti (log reale): si marca alla prossima visita.
      if (this.queue.slice(1).some((p) => p.dir || TRAVEL.test(p.cmd))) {
        this.info(
          `non marco la stanza ${r.id}: ci sono altri passi in coda, lo farò alla prossima visita.`,
        );
        return;
      }
      this.markRoom(r, st);
    } else if (
      r.marca === undefined &&
      !this.twins(st, r.zona).some((t) => t.marca === st.monete)
    ) {
      // monete già per terra che nessuna stanza usa: le adotto come marca
      r.marca = st.monete;
      r.posate = true;
      this.onChange?.(true);
    }
  }

  /**
   * Unione automatica delle isole (SPECIFICA 4.5): un passo che collega una stanza di un'isola
   * a una stanza di un'altra zona sposta tutta l'isola in quella zona, allineata al passo.
   */
  private joinIsland(a: MapRoom, b: MapRoom): void {
    if (a.zona === b.zona) return;
    const tipo = (z: number) => this.data.zone.find((x) => x.id === z)?.tipo;
    const [from, to] =
      tipo(b.zona) === 'isola'
        ? [b.zona, a.zona]
        : tipo(a.zona) === 'isola'
          ? [a.zona, b.zona]
          : [];
    if (from === undefined || to === undefined) return;
    const nome = this.data.zone.find((x) => x.id === from)?.nome ?? '';
    const zona = this.data.zone.find((x) => x.id === to)?.nome ?? '';
    const n = this.moveArea(from, to);
    if (n) this.info(`"${nome}" collegata camminando: ${n} stanze unite alla zona "${zona}".`);
  }

  /** Stanza già mappata nel punto atteso, coerente con quella vista e con l'uscita di ritorno. */
  private atExpected(d: Dir, st: Seen, c: MapRoom): MapRoom | undefined {
    const [dx, dy, dz] = DELTA[d];
    const back = OPP[d];
    return this.roomsAt(c.zona, c.x + dx, c.y + dy, c.z + dz).find(
      (r) =>
        normName(r.titolo) === normName(st.titolo) &&
        this.compatible(r, st, true) &&
        (r.uscite[back] === undefined || r.uscite[back] === c.id),
    );
  }

  /** Regole di riconoscimento camminando (SPECIFICA 4.2); `exclude`: stanze da non riusare. */
  private choose(d: Dir, st: Seen, c: MapRoom, exclude: Set<number>): MapRoom {
    // 1) uscita già nota e coerente
    const ex = c.uscite[d];
    if (ex !== undefined && this.data.stanze[ex]) {
      const r = this.data.stanze[ex];
      if (normName(r.titolo) === normName(st.titolo) && this.compatible(r, st, true)) return r;
      this.info(
        `l'uscita ${d} di "${c.titolo}" portava alla stanza sbagliata: la correggo.`,
        'warn',
      );
    }
    // 2) stanza già mappata nel punto atteso
    const [dx, dy, dz] = DELTA[d];
    const tx = c.x + dx;
    const ty = c.y + dy;
    const tz = c.z + dz;
    const o = OPP[d];
    for (const r of this.roomsAt(c.zona, tx, ty, tz)) {
      const back = r.uscite[o];
      if (
        !exclude.has(r.id) &&
        normName(r.titolo) === normName(st.titolo) &&
        this.compatible(r, st, true) &&
        (back === undefined || back === c.id)
      ) {
        this.link(c, r, d, st);
        return r;
      }
    }
    // 3) la stessa stanza altrove, con prova positiva
    const cand = this.byFirma(st.firma).filter(
      (r) => r.id !== c.id && !exclude.has(r.id) && this.congruent(r, st, c, d),
    );
    if (cand.length) {
      const r = this.best(cand, c.zona);
      this.link(c, r, d, st);
      if (cand.length === 1)
        this.info(`riconosciuta "${st.titolo}": collegata alla stanza ${r.id}.`);
      return r;
    }
    // 3b) uscita illogica verso una stanza unica: se nella zona c'è UNA sola stanza con questa
    // descrizione, stesse uscite e stessi vicini, mai marcata, ed è un'altra stanza a portarti lì
    // (non sei in un tratto di stanze tutte uguali), è lei. Log reale del 2026-11-14: dalla
    // muraglia di rovi verso ovest si torna nella stessa radura, che era diventata un doppione.
    if (c.firma !== st.firma && !st.mucchio) {
      const same = this.byFirma(st.firma).filter((r) => r.zona === c.zona);
      const r = same[0];
      if (
        same.length === 1 &&
        r.marca === undefined &&
        !exclude.has(r.id) &&
        // senza "Uscite visibili" (solo look) da una parte o dall'altra non c'è prova
        DIRS.some((x) => r.vicini[x]) &&
        DIRS.some((x) => st.vicini[x]) &&
        this.sameExits(r, st) &&
        this.compatible(r, st)
      ) {
        this.link(c, r, d, st);
        this.info(`"${st.titolo}" è la stanza ${r.id}: uscita ${d} illogica, collegata lì.`);
        return r;
      }
    }
    // 4) stanza nuova nel primo posto libero nella direzione del passo. Nella zona scelta
    // accendendo il mapper, se è un'altra: al centro se è vuota, altrimenti in un posto libero a
    // destra delle sue stanze (le coordinate di un'altra zona lì non valgono niente: il Palazzo
    // di Agamennone era finito a caso, 2026-11-16).
    const zona = this.target(c.zona);
    let [x, y, z] = [tx, ty, tz];
    if (zona !== c.zona) {
      const rs = Object.values(this.data.stanze).filter((r) => r.zona === zona);
      if (!rs.length) [x, y, z] = [0, 0, 0];
      else {
        [x, y, z] = [Math.max(...rs.map((r) => r.x)) + 2, Math.min(...rs.map((r) => r.y)), 0];
        const nome = this.data.zone.find((q) => q.id === zona)?.nome ?? '';
        this.info(
          `"${st.titolo}" messa ai margini della zona "${nome}": vieni da un'altra zona, ` +
            'sposta la stanza da dove arrivi o questa al posto giusto.',
          'warn',
        );
      }
    }
    for (let i = 0; i < 10 && this.roomsAt(zona, x, y, z).length; i++) {
      x += dx;
      y += dy;
      z += dz;
    }
    const r = this.create(zona, x, y, z, st);
    this.link(c, r, d, st);
    return r;
  }

  // ---------- marcatura con le monete ----------

  get markersOn(): boolean {
    return !this.data.noMonete && !!this.onMark;
  }

  private sameExits(r: MapRoom, st: Seen): boolean {
    return r.viste.length === st.viste.length && st.viste.every((d) => r.viste.includes(d));
  }

  /** Altre stanze della zona identiche a quella vista (descrizione e uscite). */
  private twins(st: Seen, zona: number): MapRoom[] {
    return this.byFirma(st.firma).filter((r) => r.zona === zona && this.sameExits(r, st));
  }

  /** Marca la stanza: il primo numero libero tra le gemelle, o il suo se le monete sono sparite. */
  /**
   * Toglie le marche che non servono: stanze senza un'altra identica nella zona (la prima
   * versione marcava anche quelle), numeri doppi tra le gemelle (resta il primo) e marche senza
   * monete posate.
   */
  cleanMarks(): number {
    let n = 0;
    const rooms = Object.values(this.data.stanze);
    const key = (r: MapRoom) => `${r.zona}|${r.firma}|${[...r.viste].sort().join(',')}`;
    const groups = new Map<string, MapRoom[]>();
    for (const r of rooms) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
    for (const g of groups.values()) {
      const seen = new Set<number>();
      for (const r of g.sort((a, b) => a.id - b.id)) {
        if (r.marca === undefined) continue;
        // marche senza monete (assegnate durante un percorso dalla versione di prima)
        if (g.length < 2 || seen.has(r.marca) || !r.posate) {
          delete r.marca;
          n++;
        } else seen.add(r.marca);
      }
    }
    return n;
  }

  /**
   * Marca la stanza: il primo numero libero tra le gemelle, o il suo se le monete sono sparite.
   * La marca vale solo se le monete vengono posate davvero (non durante un percorso).
   */
  private markRoom(r: MapRoom, st: Seen): void {
    const n = r.marca ?? Math.max(0, ...this.twins(st, r.zona).map((t) => t.marca ?? 0)) + 1;
    if (!this.onMark?.(n)) return;
    if (r.marca === undefined)
      this.info(`stanza identica ad altre: la marco con ${n} monete (stanza ${r.id}).`);
    else this.info(`le ${n} monete della stanza ${r.id} non ci sono più: le rimetto.`, 'warn');
    r.marca = n;
    r.posate = true;
    this.onChange?.(true);
  }

  // ---------- arrivi senza passo ----------

  private arrive(st: Seen, cmd: string | null, dir?: Dir): void {
    const cur = this.current;
    // monete per terra: la stanza marcata con quel numero
    if (this.markersOn && st.monete > 0 && !st.mucchio) {
      const marked = this.byFirma(st.firma).find(
        (r) => r.marca === st.monete && this.sameExits(r, st),
      );
      if (marked) return this.enter(marked, st);
    }
    // stessa stanza (look, o una stanza ridisegnata)
    if (cur && cur.firma === st.firma && this.compatible(cur, st)) return this.enter(cur, st);
    const found = this.byFirma(st.firma).filter((r) => this.compatible(r, st));
    if (found.length) {
      const r = this.best(found, cur?.zona);
      if (cur && cmd && this.isSpecial(cmd)) cur.speciali = { ...cur.speciali, [cmd]: r.id };
      if (found.length > 1 && !cur)
        this.info(`"${st.titolo}" c'è ${found.length} volte: scelgo la stanza ${r.id}.`, 'warn');
      return this.enter(r, st);
    }
    if (Object.keys(this.data.stanze).length === 0) {
      const z = this.zonaRegistra ?? this.newArea('Nebbie', 'mondo');
      return this.enter(this.create(z, 0, 0, 0, st), st);
    }
    // la zona scelta accendendo il mapper è ancora vuota: la prima stanza nasce lì
    if (this.zonaRegistra !== null && this.isEmpty(this.zonaRegistra)) {
      const r = this.create(this.zonaRegistra, 0, 0, 0, st);
      if (cur && cmd && this.isSpecial(cmd)) cur.speciali = { ...cur.speciali, [cmd]: r.id };
      return this.enter(r, st);
    }
    // con un comando di viaggio (o camminando da una posizione sconosciuta): isola nuova
    if ((cmd && (TRAVEL.test(cmd) || this.isSpecial(cmd))) || dir) {
      const z = this.newArea(
        `Isola ${String(this.islands() + 1).padStart(3, '0')} - ${st.titolo}`,
        'isola',
      );
      const r = this.create(z, 0, 0, 0, st);
      if (cur && cmd && this.isSpecial(cmd)) cur.speciali = { ...cur.speciali, [cmd]: r.id };
      this.info(`"${st.titolo}" non è sulla mappa: zona separata (isola) finché non la colleghi.`);
      return this.enter(r, st);
    }
    // nessun comando spiega lo spostamento: posizione sconosciuta finché non riconosco una stanza
    if (this.cur !== null)
      this.info('posizione sconosciuta: mi ritrovo alla prima stanza nota.', 'warn');
    this.cur = null;
    this.onChange?.(false);
  }

  // ---------- senza registrare: solo la posizione ----------

  /**
   * Mapper spento: riconosce le stanze note (monete, uscita nota, punto atteso, firma unica) e
   * aggiorna solo la posizione. Non crea, non collega, non marca e non salva.
   */
  private follow(st: Seen, d?: Dir): void {
    const c = this.current;
    const go = (r: MapRoom | undefined) => {
      if (!r) return false;
      if (this.cur !== r.id) {
        this.cur = r.id;
        this.onChange?.(false);
      }
      return true;
    };
    if (st.monete > 0 && !st.mucchio) {
      const m = this.byFirma(st.firma).filter(
        (r) => r.marca === st.monete && this.sameExits(r, st),
      );
      if (m.length === 1 && go(m[0])) return;
    }
    const same = (r: MapRoom) =>
      normName(r.titolo) === normName(st.titolo) && this.compatible(r, st, true);
    if (c && d) {
      const ex = c.uscite[d] !== undefined ? this.data.stanze[c.uscite[d]] : undefined;
      if (ex && same(ex) && go(ex)) return;
      const [dx, dy, dz] = DELTA[d];
      if (go(this.roomsAt(c.zona, c.x + dx, c.y + dy, c.z + dz).find(same))) return;
    }
    if (c && !d && c.firma === st.firma && this.compatible(c, st)) return;
    const found = this.byFirma(st.firma).filter((r) => this.compatible(r, st));
    if (found.length === 1 && go(found[0])) return;
    if (this.cur !== null) {
      this.cur = null;
      this.onChange?.(false);
    }
  }

  // ---------- regole di riconoscimento ----------

  /**
   * Vicini compatibili (solo le direzioni presenti in entrambe) e stesse uscite. `porte`: quando
   * la posizione conferma già la stanza (uscita nota, punto atteso), un'uscita in più o in meno è
   * una porta aperta o chiusa e non una stanza diversa (log reale del 2026-11-14: la muraglia di
   * rovi vista col cancello aperto, N S O, e poi chiuso, N S, era diventata due stanze).
   */
  compatible(r: MapRoom, st: Seen, porte = false): boolean {
    const mine = st.vicini;
    const his = r.vicini;
    for (const d of DIRS) if (mine[d] && his[d] && mine[d] !== his[d]) return false;
    const md = DIRS.filter((d) => mine[d]);
    const hd = DIRS.filter((d) => his[d]);
    const subset = (a: Dir[], b: Dir[]) => a.every((d) => b.includes(d));
    if (md.length && hd.length) {
      if (porte) return md.some((d) => his[d]) && (subset(md, hd) || subset(hd, md));
      return md.length === hd.length && subset(md, hd);
    }
    // senza "Uscite visibili" (look): le uscite viste devono essere tra quelle note
    if (st.viste.length && r.viste.length)
      return subset(st.viste, r.viste) || (porte && subset(r.viste, st.viste));
    return true;
  }

  /** Prova positiva che `r` è la stanza in cui si arriva andando in `d` da `from`. */
  private congruent(r: MapRoom, st: Seen, from: MapRoom, d: Dir): boolean {
    if (normName(r.titolo) !== normName(st.titolo) || !this.compatible(r, st)) return false;
    const o = OPP[d];
    const back = r.uscite[o];
    if (back !== undefined && back !== from.id) return false;
    if (back === from.id) return true;
    if (!DIRS.some((x) => r.vicini[x])) return false; // nessuna prova: non mi fido
    const name = normName(from.titolo);
    const vic = DIRS.some((x) => st.vicini[x]) ? st.vicini : r.vicini;
    // Il nome del vicino prova qualcosa solo se è l'unico con quel nome: nel campo di battaglia
    // tutti i vicini si chiamano "il campo di battaglia" (log reale del 2026-11-14).
    return vic[o] === name && DIRS.filter((x) => vic[x] === name).length === 1;
  }

  private isSpecial(cmd: string): boolean {
    return !isNeverStep(cmd) && !/^cast\s/i.test(cmd) && !/^(recall|astral)\b/i.test(cmd);
  }

  // ---------- operazioni sulla mappa ----------

  private roomsAt(zona: number, x: number, y: number, z: number): MapRoom[] {
    return Object.values(this.data.stanze).filter(
      (r) => r.zona === zona && r.x === x && r.y === y && r.z === z,
    );
  }

  private byFirma(f: string): MapRoom[] {
    return Object.values(this.data.stanze).filter((r) => r.firma === f);
  }

  /** Fra più candidate: prima la stessa zona, poi la mappa principale, poi la più collegata. */
  private best(list: MapRoom[], zona?: number): MapRoom {
    const main = new Set(this.data.zone.filter((z) => z.tipo === 'mondo').map((z) => z.id));
    const score = (r: MapRoom) =>
      (r.zona === zona ? 100 : 0) + (main.has(r.zona) ? 10 : 0) + Object.keys(r.uscite).length;
    return [...list].sort((a, b) => score(b) - score(a))[0];
  }

  private isEmpty(zona: number): boolean {
    return !Object.values(this.data.stanze).some((r) => r.zona === zona);
  }

  /**
   * Zona delle stanze nuove: quella scelta accendendo il mapper, se esiste ancora. Partendo da
   * un'isola le stanze nuove restano nell'isola (si unirà quando ritrovi una stanza nota).
   */
  private target(zona: number): number {
    if (this.data.zone.find((z) => z.id === zona)?.tipo === 'isola') return zona;
    const t = this.zonaRegistra;
    return t !== null && this.data.zone.some((z) => z.id === t) ? t : zona;
  }

  private islands(): number {
    return this.data.zone.filter((z) => z.tipo === 'isola').length;
  }

  private newArea(nome: string, tipo: 'mondo' | 'isola'): number {
    const id = Math.max(0, ...this.data.zone.map((z) => z.id)) + 1;
    this.data.zone.push({ id, nome, tipo });
    return id;
  }

  private create(zona: number, x: number, y: number, z: number, st: Seen): MapRoom {
    const id = this.data.prossima++;
    const r: MapRoom = {
      id,
      zona,
      x,
      y,
      z,
      titolo: st.titolo,
      desc: st.desc,
      firma: st.firma,
      uscite: {},
      viste: [...st.viste],
      vicini: { ...st.vicini },
    };
    this.data.stanze[id] = r;
    return r;
  }

  private link(a: MapRoom, b: MapRoom, d: Dir, st: Seen): void {
    a.uscite[d] = b.id;
    const o = OPP[d];
    if (st.viste.includes(o) && b.uscite[o] === undefined) b.uscite[o] = a.id;
  }

  private enter(r: MapRoom, st: Seen): void {
    if (!r.desc && st.desc) r.desc = st.desc;
    r.viste = [...new Set([...r.viste, ...st.viste])];
    if (DIRS.some((d) => st.vicini[d])) r.vicini = { ...r.vicini, ...st.vicini };
    r.visita = this.now();
    this.cur = r.id;
    this.onChange?.(true);
  }

  private info(text: string, level: 'info' | 'warn' = 'info'): void {
    this.onInfo?.({ text, level });
  }

  // ---------- comandi a mano ----------

  /** `mappa sono <n>`: dice al mapper dove sei. */
  setCurrent(id: number): boolean {
    if (!this.data.stanze[id]) return false;
    this.cur = id;
    this.onChange?.(false);
    return true;
  }

  /**
   * Accende la registrazione: le stanze nuove vanno nella zona `zona` (esistente) o in una zona
   * nuova chiamata `nuova`. Restituisce la zona usata.
   */
  startRecording(scelta: { zona: number } | { nuova: string }): number {
    const id =
      'zona' in scelta && this.data.zone.some((z) => z.id === scelta.zona)
        ? scelta.zona
        : this.newArea(
            'nuova' in scelta && scelta.nuova.trim() ? scelta.nuova.trim() : 'Zona nuova',
            'mondo',
          );
    this.registra = true;
    this.zonaRegistra = id;
    this.queue = [];
    this.onChange?.(true);
    return id;
  }

  stopRecording(): void {
    this.registra = false;
    this.zonaRegistra = null;
    this.onChange?.(false);
  }

  /**
   * Sposta tutte le stanze della zona `from` (un'isola) nella zona `to` e cancella `from`.
   * Se un'uscita collega già le due zone, l'isola viene messa al posto giusto rispetto a quella
   * uscita; altrimenti accanto alle stanze della zona, a destra. Mai due stanze nello stesso punto.
   */
  moveArea(from: number, to: number): number {
    if (from === to || !this.data.zone.some((z) => z.id === to)) return 0;
    const ids = Object.values(this.data.stanze)
      .filter((r) => r.zona === from)
      .map((r) => r.id);
    const n = this.moveRooms(ids, to);
    if (n) this.data.zone = this.data.zone.filter((z) => z.id !== from);
    if (this.zonaRegistra === from) this.zonaRegistra = to;
    if (n) this.onChange?.(true);
    return n;
  }

  /**
   * Le stanze collegate a `id` dentro la sua zona (uscite e uscite speciali, nei due sensi).
   * In un'isola: tutta l'isola.
   */
  groupOf(id: number): number[] {
    const start = this.data.stanze[id];
    if (!start) return [];
    const zona = start.zona;
    const all = Object.values(this.data.stanze).filter((r) => r.zona === zona);
    if (this.data.zone.find((z) => z.id === zona)?.tipo === 'isola') return all.map((r) => r.id);
    const adj = new Map<number, Set<number>>(all.map((r) => [r.id, new Set<number>()]));
    for (const r of all)
      for (const t of [...Object.values(r.uscite), ...Object.values(r.speciali ?? {})]) {
        if (t === undefined || !adj.has(t)) continue;
        adj.get(r.id)!.add(t);
        adj.get(t)!.add(r.id);
      }
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length)
      for (const b of adj.get(queue.pop()!) ?? [])
        if (!seen.has(b)) {
          seen.add(b);
          queue.push(b);
        }
    return [...seen].sort((a, b) => a - b);
  }

  /** Crea una zona vera (non un'isola) e ne restituisce il numero. */
  addZone(nome: string): number {
    return this.newArea(nome.trim() || 'Zona nuova', 'mondo');
  }

  /**
   * Sposta le stanze `ids` nella zona `to` (richiesta dell'utente del 2026-11-16: stanze finite
   * nella zona sbagliata). Allineate a un'uscita che le collega già alla zona, altrimenti a
   * destra delle sue stanze; mai due stanze nello stesso punto. Un'isola rimasta vuota sparisce.
   * Se registri e la stanza in cui sei si sposta, le stanze nuove vanno nella zona `to`.
   */
  moveRooms(ids: number[], to: number): number {
    if (!this.data.zone.some((z) => z.id === to)) return 0;
    const moving = ids.map((i) => this.data.stanze[i]).filter((r) => r && r.zona !== to);
    if (!moving.length) return 0;
    const set = new Set(moving.map((r) => r.id));
    const froms = new Set(moving.map((r) => r.zona));
    const dest = Object.values(this.data.stanze).filter((r) => r.zona === to);
    let off: [number, number, number] | null = null;
    for (const a of moving) {
      for (const d of DIRS) {
        const b = this.data.stanze[a.uscite[d] ?? -1];
        if (b && b.zona === to) {
          off = [b.x - DELTA[d][0] - a.x, b.y - DELTA[d][1] - a.y, b.z - DELTA[d][2] - a.z];
          break;
        }
      }
      if (off) break;
      for (const b of dest) {
        const d = DIRS.find((x) => b.uscite[x] === a.id);
        if (d) {
          off = [b.x + DELTA[d][0] - a.x, b.y + DELTA[d][1] - a.y, b.z + DELTA[d][2] - a.z];
          break;
        }
      }
      if (off) break;
    }
    if (!off) {
      const maxX = dest.length ? Math.max(...dest.map((r) => r.x)) : -2;
      const minX = Math.min(...moving.map((r) => r.x));
      const minY = Math.min(...moving.map((r) => r.y));
      const minZ = Math.min(...moving.map((r) => r.z));
      const destY = dest.length ? Math.min(...dest.map((r) => r.y)) : 0;
      off = [maxX + 2 - minX, destY - minY, dest.length ? 0 : -minZ];
    }
    const taken = new Set(dest.map((r) => `${r.x},${r.y},${r.z}`));
    const clash = (o: [number, number, number]) =>
      moving.some((r) => taken.has(`${r.x + o[0]},${r.y + o[1]},${r.z + o[2]}`));
    for (let i = 0; i < 500 && clash(off); i++) off = [off[0] + 1, off[1], off[2]];
    for (const r of moving) {
      r.zona = to;
      r.x += off[0];
      r.y += off[1];
      r.z += off[2];
    }
    // isole rimaste vuote
    for (const f of froms)
      if (
        this.data.zone.find((z) => z.id === f)?.tipo === 'isola' &&
        this.isEmpty(f) &&
        this.zonaRegistra !== f
      )
        this.data.zone = this.data.zone.filter((z) => z.id !== f);
    if (this.registra && this.cur !== null && set.has(this.cur)) this.zonaRegistra = to;
    this.onChange?.(true);
    return moving.length;
  }

  // ---------- strumenti (SPECIFICA 4.5) ----------

  /**
   * Unisce due stanze che sono la stessa: `drop` sparisce e tutto quello che puntava a lei
   * (uscite, uscite speciali) punta a `keep`; uscite, porte, note, mob e monete di `drop` si
   * aggiungono a `keep` dove mancano.
   */
  mergeRooms(keep: number, drop: number): boolean {
    const k = this.data.stanze[keep];
    const d = this.data.stanze[drop];
    if (!k || !d || keep === drop) return false;
    for (const r of Object.values(this.data.stanze)) {
      for (const x of DIRS) if (r.uscite[x] === drop) r.uscite[x] = keep;
      for (const c of Object.keys(r.speciali ?? {}))
        if (r.speciali![c] === drop) r.speciali![c] = keep;
    }
    for (const x of DIRS) {
      if (k.uscite[x] === undefined && d.uscite[x] !== undefined) k.uscite[x] = d.uscite[x];
      if (!k.vicini[x] && d.vicini[x]) k.vicini[x] = d.vicini[x];
      if (!k.porte?.[x] && d.porte?.[x]) k.porte = { ...k.porte, [x]: d.porte[x] };
    }
    k.speciali = { ...d.speciali, ...k.speciali };
    if (!Object.keys(k.speciali).length) delete k.speciali;
    k.viste = [...new Set([...k.viste, ...d.viste])];
    if (d.note) k.note = k.note ? `${k.note}\n${d.note}` : d.note;
    if (d.mob?.length) k.mob = [...new Set([...(k.mob ?? []), ...d.mob])];
    if (k.marca === undefined && d.marca !== undefined) {
      k.marca = d.marca;
      k.posate = d.posate;
    }
    if (!k.desc) k.desc = d.desc;
    delete this.data.stanze[drop];
    this.dropEmptyIsland(d.zona);
    if (this.cur === drop) this.cur = keep;
    this.onChange?.(true);
    return true;
  }

  /** Cancella una stanza e le uscite che portavano lì. */
  deleteRoom(id: number): boolean {
    const r = this.data.stanze[id];
    if (!r) return false;
    delete this.data.stanze[id];
    for (const o of Object.values(this.data.stanze)) {
      for (const x of DIRS) if (o.uscite[x] === id) delete o.uscite[x];
      for (const c of Object.keys(o.speciali ?? {}))
        if (o.speciali![c] === id) delete o.speciali![c];
    }
    this.dropEmptyIsland(r.zona);
    if (this.cur === id) this.cur = null;
    this.onChange?.(true);
    return true;
  }

  /** Note e mob di una stanza (scritti a mano nel pannello o con `mappa nota`). */
  setNotes(id: number, note: string, mob?: string[]): void {
    const r = this.data.stanze[id];
    if (!r) return;
    const n = note.trim();
    if (n) r.note = n;
    else delete r.note;
    if (mob) {
      const m = [...new Set(mob.map((x) => x.trim()).filter(Boolean))];
      if (m.length) r.mob = m;
      else delete r.mob;
    }
    this.onChange?.(true);
  }

  /** Un mob ucciso nella stanza attuale (solo mentre si registra). */
  mobSeen(nome: string): void {
    const r = this.current;
    if (!this.registra || !r || !nome.trim()) return;
    const n = nome.trim();
    if (r.mob?.some((m) => m.toLowerCase() === n.toLowerCase())) return;
    r.mob = [...(r.mob ?? []), n];
    this.onChange?.(true);
  }

  /** Cerca nelle stanze: numero, titolo, note, mob, descrizione (prima i titoli). */
  search(q: string, max = 50): MapRoom[] {
    const t = q.trim().toLowerCase().replace(/^#/, '');
    if (!t) return [];
    if (/^\d+$/.test(t)) return this.data.stanze[Number(t)] ? [this.data.stanze[Number(t)]] : [];
    const score = (r: MapRoom) =>
      r.titolo.toLowerCase().includes(t)
        ? 3
        : r.note?.toLowerCase().includes(t) || r.mob?.some((m) => m.toLowerCase().includes(t))
          ? 2
          : r.desc.toLowerCase().includes(t)
            ? 1
            : 0;
    return Object.values(this.data.stanze)
      .map((r) => [score(r), r] as const)
      .filter(([sc]) => sc > 0)
      .sort((a, b) => b[0] - a[0] || a[1].id - b[1].id)
      .slice(0, max)
      .map(([, r]) => r);
  }

  private dropEmptyIsland(zona: number): void {
    const z = this.data.zone.find((x) => x.id === zona);
    if (z?.tipo === 'isola' && this.isEmpty(zona))
      this.data.zone = this.data.zone.filter((x) => x.id !== zona);
  }

  renameArea(id: number, nome: string): void {
    const z = this.data.zone.find((x) => x.id === id);
    if (z) {
      z.nome = nome;
      this.onChange?.(true);
    }
  }

  reset(): void {
    this.data = emptyMap();
    this.cur = null;
    this.queue = [];
    this.onChange?.(true);
  }

  /** Percorso più breve (uscite e uscite speciali) come lista di comandi, porte comprese. */
  path(from: number, to: number): string[] | null {
    if (from === to) return [];
    const prev = new Map<number, { da: number; cmds: string[] }>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const id = queue.shift()!;
      const r = this.data.stanze[id];
      if (!r) continue;
      const nexts: [number, string[]][] = [];
      for (const d of DIRS) {
        const t = r.uscite[d];
        if (t === undefined) continue;
        const apri = r.porte?.[d]?.apri;
        nexts.push([t, apri ? [apri, d] : [d]]);
      }
      for (const [cmd, t] of Object.entries(r.speciali ?? {})) nexts.push([t, [cmd]]);
      for (const [t, cmds] of nexts) {
        if (seen.has(t) || !this.data.stanze[t]) continue;
        seen.add(t);
        prev.set(t, { da: id, cmds });
        if (t === to) {
          const out: string[][] = [];
          for (let x = to; x !== from; x = prev.get(x)!.da) out.unshift(prev.get(x)!.cmds);
          return out.flat();
        }
        queue.push(t);
      }
    }
    return null;
  }
}
