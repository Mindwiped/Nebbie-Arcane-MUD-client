import { parseMudNumber } from '../prompt/promptParser';
import defaultFormati from './formati.json';
import type { Dir, ItemRow, NebbieEvents, RoomEvent, ScoreEvent } from './types';

export type Formati = typeof defaultFormati;
export type Emit = <K extends keyof NebbieEvents>(event: K, data: NebbieEvents[K]) => void;

const re = (source: string) => new RegExp(source, 'u');
/** Oltre questa lunghezza una riga è descrizione, non titolo (dal mapper Mudlet). */
const RIGA_LUNGA = 55;
/** Righe tenute in memoria dall'ultimo prompt per trovare titolo e descrizione. */
const MAX_BUFFER = 40;
/** Dopo `look <dir>` per questo tempo le stanze sono "guardate", non visitate. */
const LOOK_MS = 2000;

interface Compiled {
  uscite: RegExp;
  usciteVisibili: RegExp;
  separatore: RegExp;
  rigaUscitaVisibile: RegExp;
  guardando: RegExp;
  ripetizione: RegExp;
  mobMorto: RegExp;
  atterratoBash: RegExp;
  disarmFallito: RegExp;
  fingerFallito: RegExp;
  ancoraATerra: RegExp;
  esperienza: RegExp;
  esperienzaZona: RegExp;
  monete: RegExp;
  lancio: RegExp;
  passoImpossibile: RegExp;
  portaChiusa: RegExp;
  fineRun: RegExp;
  portaAperta: RegExp;
  portaChiusaOra: RegExp;
  titoloMezzo: RegExp;
  achievement: RegExp;
  scoreInizio: RegExp;
  scoreVitali: RegExp;
  scoreEsperienza: RegExp;
  scoreProssimoLivello: RegExp;
  scoreLivelli: RegExp;
  scorePosizione: RegExp;
  incantesimiAttivi: RegExp;
  rigaIncantesimoAttivo: RegExp;
  equipaggiamento: RegExp;
  inventario: RegExp;
  contenitore: RegExp;
  rigaEq: RegExp;
  rigaOggetto: RegExp;
  listaVuota: RegExp;
  fermataDiligenza: RegExp;
  prossimaFermata: RegExp;
  fermataMongolfiera: RegExp[];
  rumore: RegExp[];
  direzioni: Record<string, Dir>;
  fineIncantesimi: { regex: RegExp; incantesimo: string; avviso: boolean; parziale: boolean }[];
}

function compile(f: Formati): Compiled {
  return {
    uscite: re(f.uscite),
    usciteVisibili: re(f.usciteVisibili),
    separatore: re(f.separatore),
    rigaUscitaVisibile: re(f.rigaUscitaVisibile),
    guardando: re(f.guardando),
    ripetizione: re(f.ripetizione),
    mobMorto: re(f.mobMorto),
    atterratoBash: re(f.atterratoBash),
    disarmFallito: re(f.disarmFallito),
    fingerFallito: re(f.fingerFallito),
    ancoraATerra: re(f.ancoraATerra),
    esperienza: re(f.esperienza),
    esperienzaZona: re(f.esperienzaZona),
    monete: re(f.monete),
    lancio: re(f.lancio),
    passoImpossibile: re(f.passoImpossibile),
    portaChiusa: re(f.portaChiusa),
    fineRun: re(f.fineRun),
    portaAperta: re(f.portaAperta),
    portaChiusaOra: re(f.portaChiusaOra),
    titoloMezzo: re(f.titoloMezzo),
    achievement: re(f.achievement),
    scoreInizio: re(f.scoreInizio),
    scoreVitali: re(f.scoreVitali),
    scoreEsperienza: re(f.scoreEsperienza),
    scoreProssimoLivello: re(f.scoreProssimoLivello),
    scoreLivelli: re(f.scoreLivelli),
    scorePosizione: re(f.scorePosizione),
    incantesimiAttivi: re(f.incantesimiAttivi),
    rigaIncantesimoAttivo: new RegExp(f.rigaIncantesimoAttivo, 'gu'),
    equipaggiamento: re(f.equipaggiamento),
    inventario: re(f.inventario),
    contenitore: re(f.contenitore),
    rigaEq: re(f.rigaEq),
    rigaOggetto: re(f.rigaOggetto),
    listaVuota: re(f.listaVuota),
    fermataDiligenza: re(f.fermataDiligenza),
    prossimaFermata: re(f.prossimaFermata),
    fermataMongolfiera: f.fermataMongolfiera.map(re),
    rumore: f.rumore.map(re),
    direzioni: f.direzioni as Record<string, Dir>,
    fineIncantesimi: f.fineIncantesimi.map((x) => ({
      regex: re(x.regex),
      incantesimo: x.incantesimo,
      avviso: 'avviso' in x && x.avviso === true,
      parziale: 'parziale' in x && x.parziale === true,
    })),
  };
}

const LOOK_CMD = /^(?:l|look|guarda)\s+(\S+)/i;

/** Nome normalizzato per i confronti (come `normNome` del mapper Mudlet). */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una riga che finisce come una frase (". ? : ; ,") è descrizione, non titolo. */
const isSentence = (l: string) => /[.?:;,]$/.test(l.trim());

/**
 * Parser del testo di Nebbie: riceve le righe complete (già senza prompt) e i prompt,
 * e produce eventi tipizzati. La cattura delle stanze è portata da mappa_automatica.xml:
 * - `Uscite:` (anche attaccata all'ultima riga di descrizione) apre la stanza; titolo e
 *   descrizione sono le righe arrivate prima, dall'ultimo prompt;
 * - le righe successive sono mob e oggetti, fino a "Uscite visibili";
 * - le righe `Dir - Nome` fino al separatore chiudono la stanza; con `look` (niente uscite
 *   visibili) la chiude il prompt.
 */
export class NebbieParser {
  private f: Compiled;
  private buf: string[] = [];
  private room: (Omit<RoomEvent, 'titolo' | 'righeDescrizione'> & { righe: string[] }) | null =
    null;
  private roomState: 'uscite' | 'visibili' | null = null;
  /** Nomi delle stanze attorno all'ultima stanza: aiutano a riconoscere il titolo della prossima. */
  private lastVisible: string[] = [];
  private list: {
    kind: 'equipmentList' | 'inventoryList' | 'containerList';
    titolo: string;
    righe: ItemRow[];
  } | null = null;
  private lookUntil = 0;
  /** Blocco di `score` in corso (finisce con una riga vuota o il prompt). */
  private score: ScoreEvent | null = null;
  /** Sezione "Spells attivi" di `att` in corso. */
  private affects: { nome: string; durata: number }[] | null = null;

  constructor(
    private readonly emit: Emit,
    formati: Formati = defaultFormati,
    private readonly now: () => number = Date.now,
  ) {
    this.f = compile(formati);
  }

  /** Comando inviato: serve a riconoscere i `look <direzione>`. */
  command(text: string): void {
    // Le righe arrivate prima di un comando non sono la sua risposta: senza questo, dopo il
    // login le NEWS (che non finiscono con un prompt di gioco) diventavano il titolo della
    // prima stanza.
    if (!this.room) this.buf = [];
    const m = LOOK_CMD.exec(text.trim());
    this.lookUntil = m && m[1].toLowerCase() !== 'in' ? this.now() + LOOK_MS : 0;
  }

  prompt(): void {
    this.endScore();
    this.endAffects();
    this.endList();
    if (this.room) this.closeRoom();
    this.buf = [];
  }

  line(raw: string): void {
    if (this.blockLine(raw)) return;
    if (this.list && this.listLine(raw)) return;
    const f = this.f;
    let text = raw;
    let volte = 1;
    const rep = f.ripetizione.exec(raw);
    if (rep?.groups) {
      text = rep.groups.testo;
      volte = Number(rep.groups.volte);
    }
    this.events(text, volte);
    this.roomLine(raw);
  }

  // ---------- eventi su riga singola ----------

  private events(text: string, volte: number): void {
    const f = this.f;
    let m: RegExpExecArray | null;
    if ((m = f.mobMorto.exec(text))) {
      this.emit('mobKilled', { nome: m.groups!.nome, volte });
    } else if (f.atterratoBash.test(text)) {
      this.emit('knockedDown', { causa: 'bash', testo: text });
    } else if (f.disarmFallito.test(text)) {
      this.emit('knockedDown', { causa: 'disarm', testo: text });
    } else if (f.fingerFallito.test(text)) {
      this.emit('knockedDown', { causa: 'finger', testo: text });
    } else if (f.ancoraATerra.test(text)) {
      // lo stand di prima non è riuscito (log reale col Saladino, 2026-11-15)
      this.emit('knockedDown', { causa: 'ancora', testo: text });
    } else if ((m = f.esperienza.exec(text))) {
      this.emit('xpGained', { punti: (parseMudNumber(m.groups!.punti) ?? 0) * volte });
    } else if ((m = f.esperienzaZona.exec(text))) {
      this.emit('xpGained', {
        punti: parseMudNumber(m.groups!.punti) ?? 0,
        nemici: Number(m.groups!.nemici),
      });
    } else if ((m = f.monete.exec(text))) {
      this.emit('goldLooted', { monete: (parseMudNumber(m.groups!.monete) ?? 0) * volte });
    } else if ((m = f.lancio.exec(text))) {
      this.emit('spellCast', { nome: m.groups!.nome });
    } else if (f.passoImpossibile.test(text)) {
      this.emit('moveFailed', { motivo: 'muro', testo: text });
    } else if (f.portaChiusa.test(text)) {
      this.emit('moveFailed', { motivo: 'porta', testo: text });
    } else if (f.fineRun.test(text)) {
      this.emit('moveFailed', { motivo: 'fineRun', testo: text });
    } else if ((m = f.portaAperta.exec(text) ?? f.portaChiusaOra.exec(text))) {
      const azione = f.portaAperta.test(text) ? 'aperta' : 'chiusa';
      this.emit('door', m.groups?.chi ? { azione, chi: m.groups.chi } : { azione });
    } else if ((m = f.achievement.exec(text))) {
      const g = m.groups!;
      this.emit('achievement', {
        tipo: g.tipo,
        numero: Number(g.numero),
        nome: g.nome,
        valore: Number(g.valore),
        totale: Number(g.totale),
      });
    } else if (f.equipaggiamento.test(text)) {
      this.startList('equipmentList', '');
    } else if (f.inventario.test(text)) {
      this.startList('inventoryList', '');
    } else if ((m = f.contenitore.exec(text))) {
      this.startList('containerList', m.groups!.titolo);
    } else {
      for (const end of f.fineIncantesimi) {
        if (end.regex.test(text)) {
          this.emit(
            'affectEnd',
            end.parziale
              ? { nome: end.incantesimo, avviso: false, parziale: true }
              : { nome: end.incantesimo, avviso: end.avviso },
          );
          break;
        }
      }
      this.transport(text);
    }
  }

  private transport(text: string): void {
    const f = this.f;
    const d = f.fermataDiligenza.exec(text);
    if (d?.groups) {
      this.pendingStop = { mezzo: 'diligenza', fermata: d.groups.fermata };
      return;
    }
    const p = f.prossimaFermata.exec(text);
    if (p?.groups && this.pendingStop) {
      this.emit('transportStop', { ...this.pendingStop, prossima: p.groups.fermata });
      this.pendingStop = null;
      return;
    }
    for (const r of f.fermataMongolfiera) {
      const m = r.exec(text);
      if (m?.groups) {
        this.emit('transportStop', { mezzo: 'mongolfiera', fermata: m.groups.fermata });
        return;
      }
    }
  }

  private pendingStop: { mezzo: 'diligenza'; fermata: string } | null = null;

  // ---------- score e incantesimi attivi (att) ----------

  /**
   * Righe di `score` e della sezione "Spells attivi" di `att`. Le regex non sono ancorate:
   * funzionano sia con una frase per riga (come le manda il MUD) sia con il testo incollato
   * tutto su una riga. Restituisce true se la riga è stata consumata.
   */
  private blockLine(text: string): boolean {
    const f = this.f;
    if (text.trim() === '') {
      const had = this.score !== null || this.affects !== null;
      this.endScore();
      this.endAffects();
      return had;
    }
    if (f.scoreInizio.test(text) || f.scoreVitali.test(text)) this.score ??= {};
    let used = false;
    if (this.score) {
      const s = this.score;
      let m: RegExpExecArray | null;
      if ((m = f.scoreVitali.exec(text))) {
        const g = m.groups!;
        for (const k of ['hp', 'hpMax', 'mp', 'mpMax', 'mv', 'mvMax'] as const) s[k] = Number(g[k]);
        used = true;
      }
      if ((m = f.scoreEsperienza.exec(text))) {
        s.exp = parseMudNumber(m.groups!.exp);
        s.monete = parseMudNumber(m.groups!.monete);
        used = true;
      }
      if ((m = f.scoreProssimoLivello.exec(text)))
        s.prossimoLivello = classValues(m.groups!.valori);
      if ((m = f.scoreLivelli.exec(text))) s.livelli = classValues(m.groups!.valori);
      if ((m = f.scorePosizione.exec(text))) s.posizione = m.groups!.posizione;
      used = used || f.scoreInizio.test(text);
    }
    if (f.incantesimiAttivi.test(text)) {
      this.endScore();
      this.affects = [];
    }
    if (this.affects) {
      for (const m of text.matchAll(f.rigaIncantesimoAttivo)) {
        this.affects.push({ nome: m.groups!.nome, durata: Number(m.groups!.durata) });
      }
      return true;
    }
    return used;
  }

  private endScore(): void {
    const s = this.score;
    this.score = null;
    if (s && Object.keys(s).length) this.emit('score', s);
  }

  private endAffects(): void {
    const a = this.affects;
    this.affects = null;
    if (a) this.emit('affectsList', { incantesimi: a });
  }

  // ---------- liste di eq / inventario / contenitore ----------

  private startList(kind: 'equipmentList' | 'inventoryList' | 'containerList', titolo: string) {
    this.endList();
    this.list = { kind, titolo, righe: [] };
  }

  /** Gestisce una riga mentre una lista è aperta; restituisce false se la lista è finita. */
  private listLine(text: string): boolean {
    const f = this.f;
    const list = this.list!;
    if (f.listaVuota.test(text) && list.righe.length === 0) {
      this.endList();
      return true;
    }
    const m = f.rigaEq.exec(text) ?? f.rigaOggetto.exec(text);
    if (m?.groups) {
      list.righe.push(parseItem(Number(m.groups.pos), m.groups.nome, m.groups.slot));
      return true;
    }
    this.endList();
    return text.trim() === '';
  }

  private endList(): void {
    const list = this.list;
    if (!list) return;
    this.list = null;
    if (list.kind === 'containerList') {
      this.emit('containerList', { titolo: list.titolo, righe: list.righe });
    } else {
      this.emit(list.kind, { righe: list.righe });
    }
  }

  // ---------- stanze (porting di M.riga / M.elabora) ----------

  private roomLine(l: string): void {
    const f = this.f;
    const u = f.uscite.exec(l);
    if (this.roomState === null) {
      if (u) {
        const righe = [...this.buf];
        if (u[1]) righe.push(u[1]);
        this.startRoom(u[2], righe);
        return;
      }
      // Stanze senza riga `Uscite:` (es. il cestello della mongolfiera): si parte da qui.
      if (f.usciteVisibili.test(l) && this.buf.some((r) => !this.noise(r))) {
        this.startRoom(
          '',
          this.buf.filter((r) => !f.separatore.test(r)),
        );
        this.roomState = 'visibili';
        return;
      }
      this.buf.push(l);
      if (this.buf.length > MAX_BUFFER) this.buf.shift();
    } else if (this.roomState === 'uscite') {
      if (f.usciteVisibili.test(l)) {
        this.roomState = 'visibili';
      } else if (u) {
        // Stanze di fila senza "Uscite visibili" (raro): la nuova inizia qui.
        const after = this.room!.contenuti;
        this.room!.contenuti = [];
        if (u[1]) after.push(u[1]);
        this.closeRoom();
        this.startRoom(u[2], after);
      } else if (!f.separatore.test(l) && l.trim() !== '') {
        this.room!.contenuti.push(l);
      }
    } else if (this.roomState === 'visibili') {
      if (f.separatore.test(l)) {
        this.closeRoom();
      } else {
        const m = f.rigaUscitaVisibile.exec(l);
        const dir = m?.groups && f.direzioni[m.groups.dir.toLowerCase()];
        if (dir) this.room!.visibili.push({ dir, nome: m!.groups!.nome });
      }
    }
  }

  private startRoom(usciteRiga: string, righe: string[]): void {
    const uscite: Dir[] = [];
    for (const w of usciteRiga.match(/\p{L}+/gu) ?? []) {
      const d = this.f.direzioni[w.toLowerCase()];
      if (d) uscite.push(d);
    }
    this.room = {
      righe,
      uscite,
      usciteRiga: usciteRiga.trim(),
      visibili: [],
      contenuti: [],
      guardata: this.now() < this.lookUntil,
    };
    this.buf = [];
    this.roomState = 'uscite';
  }

  private closeRoom(): void {
    const st = this.room;
    this.room = null;
    this.roomState = null;
    if (!st) return;
    const righe = st.righe;
    const guardata = st.guardata || righe.some((l) => this.f.guardando.test(l));
    const fermata = this.stopIn(righe);
    let idx = this.titleIndex(righe);
    let titolo = idx >= 0 ? righe[idx].trim() : 'Stanza senza nome';
    if (fermata) {
      // Fermata di un mezzo (porting di M.fermata): titolo "La diligenza: …" se c'è,
      // altrimenti costruito dalla fermata come nel mapper Mudlet.
      const m = righe.findIndex((l) => this.f.titoloMezzo.test(l));
      idx = m;
      titolo = m >= 0 ? righe[m].trim() : `La ${fermata.mezzo}: ${fermata.fermata}`;
    }
    const righeDescrizione = righe.slice(idx + 1).filter((l) => l.trim() !== '');
    const { righe: _righe, ...rest } = st;
    if (!guardata && st.visibili.length) this.lastVisible = st.visibili.map((v) => v.nome);
    const room: RoomEvent = { ...rest, titolo, righeDescrizione, guardata };
    if (fermata) room.fermata = fermata;
    this.emit('room', room);
  }

  /** Fermata di diligenza o mongolfiera tra le righe di una stanza (porting di fermataDi). */
  private stopIn(righe: string[]): RoomEvent['fermata'] {
    for (const l of righe) {
      const d = this.f.fermataDiligenza.exec(l);
      if (d?.groups) return { mezzo: 'diligenza', fermata: d.groups.fermata };
      for (const r of this.f.fermataMongolfiera) {
        const m = r.exec(l);
        if (m?.groups) return { mezzo: 'mongolfiera', fermata: m.groups.fermata };
      }
    }
    return undefined;
  }

  private noise(l: string): boolean {
    const t = l.trim();
    return t === '' || this.f.rumore.some((r) => r.test(t));
  }

  /** Indice della riga del titolo (porting della scelta del titolo di M.elabora). */
  private titleIndex(righe: string[]): number {
    // 1) una riga uguale al nome di una stanza vicina all'ultima visitata
    const neighbours = new Set(this.lastVisible.map(normName));
    for (let i = 0; i < righe.length; i++) {
      if (neighbours.has(normName(righe[i]))) return i;
    }
    // 2) la riga "pulita" subito prima della prima riga lunga di descrizione
    const longIdx = righe.findIndex((l) => l.length >= RIGA_LUNGA && !this.noise(l));
    const short = (l: string) => !this.noise(l) && l.length < RIGA_LUNGA;
    if (longIdx >= 0) {
      for (let i = longIdx - 1; i >= 0; i--) {
        if (short(righe[i]) && !isSentence(righe[i])) return i;
      }
      for (let i = longIdx - 1; i >= 0; i--) {
        if (short(righe[i])) return i;
      }
    }
    // 3) la prima riga che non è rumore e non finisce come una frase, poi la prima non rumore
    const clean = righe.findIndex((l) => !this.noise(l) && !isSentence(l));
    if (clean >= 0) return clean;
    return righe.findIndex((l) => !this.noise(l));
  }
}

/** `M:-103.366.565 K:-103.366.565` → `{ M: -103366565, K: -103366565 }`. */
function classValues(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/(\p{L}+):(-?[\d.]+)/gu)) {
    const v = parseMudNumber(m[2]);
    if (v !== undefined) out[m[1]] = v;
  }
  return out;
}

/** Riga di lista: `Nome (note) (in condizioni eccellenti)[3]`. */
export function parseItem(pos: number, text: string, slot?: string): ItemRow {
  let nome = text.trim();
  let quantita = 1;
  const q = /^(.*?)\s*\[(\d+)\]$/.exec(nome);
  if (q) {
    nome = q[1];
    quantita = Number(q[2]);
  }
  const note: string[] = [];
  let condizione: string | undefined;
  for (let m = /\s*\(([^()]*)\)$/.exec(nome); m; m = /\s*\(([^()]*)\)$/.exec(nome)) {
    nome = nome.slice(0, m.index);
    if (/^in .*condizion/.test(m[1])) condizione = m[1];
    else note.unshift(m[1]);
  }
  const row: ItemRow = { pos, nome: nome.trim(), note, quantita };
  if (slot) row.slot = slot.trim();
  if (condizione) row.condizione = condizione;
  return row;
}
