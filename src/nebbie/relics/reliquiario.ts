/**
 * Reliquiario (richiesta dell'utente del 2026-11-17): il database degli oggetti identificati e
 * dell'equipaggiamento dei pg, in `identi.js` (`window.MUD_DB = {…};`) nella cartella scelta
 * dall'utente, letto dalla pagina `identi.html`. Prima lo aggiornava lo script Mudlet "Identi";
 * qui la stessa logica e lo stesso formato, così pagina, Mudlet e client restano compatibili.
 *
 * - ogni identify (pergamena o incantesimo) si salva; il nome dell'oggetto si prende dalla riga
 *   "Smetti di usare…", "Prendi…", "Impugni…", "Tieni in mano…" che lo precede;
 * - ogni `eq` salva l'equipaggiamento del pg del prompt; se ti sei tolto dei pezzi per
 *   identificarli non li dimentica (finché il loro posto è libero).
 */

export interface Relic {
  chiave: string;
  /** Parole chiave dell'identify (`Oggetto: '…'`), se diverse dalla chiave. */
  parole?: string;
  /** Nome come appare in eq/inventario. */
  nome?: string;
  tipo: string;
  flags: string[];
  stats: Record<string, number>;
  poteri?: string[];
  extra: string[];
  peso?: number;
  valore?: number;
  rent?: number;
  raro?: boolean;
  ac?: number;
  dado?: string;
  tipoDanno?: string;
  livello?: number;
  cariche?: number;
  incantesimi?: string[];
  /** Posto in cui l'hai indossato (`sul dito destro`). */
  slot?: string;
  /** Data di aggiunta o aggiornamento (AAAA-MM-GG). */
  visto?: string;
  /** Contenitore in cui lo tieni (oggetti delle borse); assente = non in un contenitore. */
  contenitore?: string;
  /** Dati della wiki (importati dalla pagina). */
  wiki?: Record<string, string>;
  /** Altri campi della pagina (categoria, tag…): si conservano. */
  [altro: string]: unknown;
}

export interface WornPiece {
  slot: string;
  nome: string;
}

export interface RelicDb {
  versione: number;
  oggetti: Record<string, Relic>;
  pg: Record<string, { eq: WornPiece[]; aggiornato?: string }>;
  /** Nomi dei contenitori scelti dall'utente (per il menu di ogni oggetto). */
  contenitori?: string[];
  aggiornato?: string;
  [altro: string]: unknown;
}

/** Identify in lettura. */
export interface IdentifyCapture {
  chiave: string;
  tipo: string;
  flags: string[];
  stats: Record<string, number>;
  poteri: string[];
  extra: string[];
  peso?: number;
  valore?: number;
  rent?: number;
  raro?: boolean;
  ac?: number;
  dado?: string;
  tipoDanno?: string;
  livello?: number;
  cariche?: number;
  incantesimi?: string[];
  ultimo?: 'flags' | 'incantesimi';
}

export const emptyDb = (): RelicDb => ({ versione: 1, oggetti: {}, pg: {} });

// ---------- nomi ----------

const STOP = new Set(
  'il lo la i gli le un uno una l di del della dei degli delle dello dal dalla dai dalle dallo al alla ai alle allo a da in con su sul sulla sui e d'.split(
    ' ',
  ),
);

export const words = (s: string | undefined): string[] =>
  (s ?? '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .split(/[^a-zà-ù0-9]+/)
    .filter((w) => w && !STOP.has(w));

/** "3.500" = 3500. */
export const number = (s: string): number =>
  Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;

/** Toglie le note finali tra parentesi: "Anello (luminoso) (ammaccato)" → "Anello". */
export function cleanName(s: string | undefined): string {
  let t = (s ?? '').trim();
  let prima: string;
  do {
    prima = t;
    t = t.replace(/\s*\([^()]*\)\s*$/, '');
  } while (t !== prima);
  return t.trim();
}

/**
 * Quante parole significative del nome compaiono nelle parole chiave: ne servono due. `una`: ne
 * basta una se le parole chiave sono una sola (log reale del 2026-11-17: "Cero della Veglia
 * Funebre" con parola chiave `cero` restava "da identificare").
 */
function affinity(nome: string, chiave: string, una = true): { comuni: number; servono: number } {
  const n = words(nome);
  const k = new Set(words(chiave));
  const servono = una ? Math.min(2, n.length, k.size) : Math.min(2, n.length);
  return { comuni: n.filter((w) => k.has(w)).length, servono };
}

export function compatible(nome: string, chiave: string): boolean {
  const a = affinity(nome, chiave);
  return a.servono > 0 && a.comuni >= a.servono;
}

const keywordsOf = (o: Relic) => o.parole || o.chiave;

/** L'oggetto del database che corrisponde a un nome visto in eq o in inventario. */
export function findRelic(db: RelicDb, nome: string): Relic | undefined {
  const pn = cleanName(nome).toLowerCase();
  let best: Relic | undefined;
  let punti = 0;
  for (const o of Object.values(db.oggetti)) {
    if (o.nome && cleanName(o.nome).toLowerCase() === pn) return o;
    // una parola sola basta solo per gli oggetti senza nome (identificati in gioco): `elmo`
    // della wiki ("Vikinghi Elmo Soti") non è "L'elmo con maschera oscura"
    const a = affinity(nome, keywordsOf(o), !o.nome);
    // a parità l'oggetto già visto addosso o identificato in gioco
    const bonus = (o.slot ? 0.5 : 0) + (o.wiki ? 0 : 0.2);
    if (a.servono > 0 && a.comuni >= a.servono && a.comuni + bonus > punti) {
      best = o;
      punti = a.comuni + bonus;
    }
  }
  return best;
}

// ---------- identify ----------

export function startIdentify(line: string): IdentifyCapture | null {
  const m =
    /^Oggetto: '(.+?)',?\s*(?:Tipo di Oggetto\s*(.*))?$/.exec(line) ??
    /^Object '(.+?)',?\s*(?:Item type:\s*(.*))?$/.exec(line);
  if (!m) return null;
  return { chiave: m[1], tipo: (m[2] ?? '').trim(), flags: [], stats: {}, poteri: [], extra: [] };
}

/** Una riga dell'identify (formato italiano e vecchio formato inglese). */
export function identifyLine(c: IdentifyCapture, line: string): void {
  let m: RegExpExecArray | null;
  const t = line.trim();
  if (
    !t ||
    /^(La conoscenza ti pervade|Vieni sopraffatt|Caratteristiche:|Can affect you as|Ti puo' dare\s*:?\s*$)/.test(
      t,
    )
  )
    return;
  if (!c.tipo && (m = /^(?:Tipo di Oggetto|Item type:)\s*(.+)$/.exec(t))) {
    c.tipo = m[1].trim();
    return;
  }
  if ((m = /^(?:L'oggetto e'|Item is):?\s*(.*)$/.exec(t))) {
    c.flags = m[1].split(/\s+/).filter(Boolean);
    c.ultimo = 'flags';
    return;
  }
  if (c.ultimo === 'flags' && /^[A-Z][A-Z0-9_-]*(\s+[A-Z][A-Z0-9_-]*)*$/.test(t)) {
    c.flags.push(...t.split(/\s+/));
    return;
  }
  if (c.ultimo === 'flags') c.ultimo = undefined;
  if (
    (m =
      /^(?:Peso|Weight):?\s*([\d.]+),\s*(?:Valore|Value):?\s*([\d.]+),\s*(?:Costo di rent|Rent cost|Rent):?\s*(-?[\d.]+)/i.exec(
        t,
      ))
  ) {
    c.peso = number(m[1]);
    c.valore = number(m[2]);
    c.rent = number(m[3]);
    c.raro = /\[RARO\]|\[RARE\]/i.test(t);
    return;
  }
  if ((m = /^AC-apply (?:di|is)\s*(-?\d+)/.exec(t))) {
    c.ac = Number(m[1]);
    return;
  }
  if ((m = /^(?:Ti puo' dare|Affects)\s*:\s*(.+?) by (.+?)\.?$/.exec(t))) {
    if (/^-?\d+$/.test(m[2].trim())) c.stats[m[1]] = (c.stats[m[1]] ?? 0) + Number(m[2]);
    else c.poteri.push(`${m[1]}: ${m[2].trim()}`);
    return;
  }
  if ((m = /^(?:Dado di danno|Damage Dice is):?\s*'?(\d+)D(\d+)'?/i.exec(t))) {
    c.dado = `${m[1]}d${m[2]}`;
    return;
  }
  if ((m = /^(?:Tipo di danno|Damage type is):?\s*'?([^']+)'?/i.exec(t))) {
    c.tipoDanno = m[1].trim();
    return;
  }
  if ((m = /^(?:Livello (\d+) dell'incantesimo|Level (\d+) spells? of):?/.exec(t))) {
    c.livello = Number(m[1] ?? m[2]);
    c.incantesimi ??= [];
    c.ultimo = 'incantesimi';
    return;
  }
  if ((m = /^(?:Ha (\d+) cariche totali|Has (\d+) ch\w*ges)/.exec(t))) {
    c.cariche = Number(m[1] ?? m[2]);
    return;
  }
  if (c.incantesimi && /^[a-z][a-z \-']*$/.test(t)) {
    c.incantesimi.push(t);
    return;
  }
  c.extra.push(t);
}

/** Stesse statistiche e stessa AC: è lo stesso oggetto. */
function statsSignature(o: { stats?: Record<string, number>; ac?: number }): string {
  const t = Object.entries(o.stats ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return `${t.join(',')}|${o.ac ?? 0}`;
}
const empty = (t: object | undefined) => !t || Object.keys(t).length === 0;

/** Dove salvare un identify: lo stesso oggetto già presente o una chiave nuova (`x (2)`). */
function keyFor(db: RelicDb, c: IdentifyCapture): string {
  const f = statsSignature(c);
  const esiste = db.oggetti[c.chiave];
  if (esiste && (empty(esiste.stats) || empty(c.stats) || statsSignature(esiste) === f))
    return c.chiave;
  if (!empty(c.stats)) {
    const p = c.chiave.toLowerCase();
    for (const [k, o] of Object.entries(db.oggetti))
      if (String(keywordsOf(o)).toLowerCase() === p && statsSignature(o) === f) return k;
  }
  if (!esiste) return c.chiave;
  let n = 2;
  while (db.oggetti[`${c.chiave} (${n})`]) n++;
  return `${c.chiave} (${n})`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Aggiunge (o aggiorna) un identify nel database. `nome`: l'ultimo oggetto preso o tolto, se
 * compatibile con le parole chiave; `pg`: chi lo identifica (se lo indossa, si sa dove va).
 */
export function addIdentify(
  db: RelicDb,
  c: IdentifyCapture,
  oggi: string,
  nome?: string,
  pg?: string,
): { chiave: string; nuovo: boolean; oggetto: Relic } {
  const chiave = keyFor(db, c);
  const vecchio = db.oggetti[chiave];
  const o: Relic = vecchio ?? { chiave, tipo: '', flags: [], stats: {}, extra: [] };
  if (nome && compatible(nome, c.chiave) && !(vecchio?.slot && vecchio.nome))
    o.nome = capitalize(nome);
  o.chiave = chiave;
  o.parole = c.chiave;
  o.tipo = c.tipo;
  o.flags = c.flags;
  o.stats = c.stats;
  o.extra = c.extra;
  for (const k of [
    'peso',
    'valore',
    'rent',
    'raro',
    'ac',
    'dado',
    'tipoDanno',
    'livello',
    'cariche',
    'incantesimi',
  ] as const) {
    if (c[k] !== undefined) (o as Record<string, unknown>)[k] = c[k];
    else delete o[k];
  }
  if (c.poteri.length) o.poteri = c.poteri;
  else delete o.poteri;
  o.visto = oggi;
  for (const e of (pg && db.pg[pg]?.eq) || [])
    if (compatible(e.nome, c.chiave)) {
      o.slot = e.slot;
      o.nome = e.nome;
      break;
    }
  db.oggetti[chiave] = o;
  return { chiave, nuovo: !vecchio, oggetto: o };
}

/**
 * Salva l'eq di un pg così com'è (richiesta del 2026-11-17: prima, come lo script Mudlet, teneva
 * i pezzi tolti col posto libero, e l'eq salvato non era più quello vero). I pezzi tolti non
 * perdono niente: nome e posto restano sull'oggetto identificato.
 */
export function saveEquipment(db: RelicDb, pg: string, eq: WornPiece[], ora: string): void {
  db.pg[pg] = { eq, aggiornato: ora };
  for (const e of eq) {
    const o = findRelic(db, e.nome);
    if (o) {
      o.slot = e.slot;
      o.nome = e.nome;
    }
  }
}

// ---------- file ----------

/** Legge identi.js. Lancia un errore se il file non si legge (non va sovrascritto). */
export function parseDb(text: string | null): RelicDb {
  if (text === null) return emptyDb();
  const t = text
    .replace(/^\s*window\.MUD_DB\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .trim();
  if (!t) return emptyDb();
  const d = JSON.parse(t) as Partial<RelicDb>;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('non è un database');
  const db: RelicDb = { ...d, versione: d.versione ?? 1, oggetti: {}, pg: {} };
  // Mudlet (yajl) scrive le tabelle vuote come []
  const oggetti = d.oggetti && !Array.isArray(d.oggetti) ? d.oggetti : {};
  for (const [k, o] of Object.entries(oggetti)) {
    if (!o || typeof o !== 'object') continue;
    db.oggetti[k] = {
      ...o,
      chiave: o.chiave || k,
      tipo: o.tipo ?? '',
      flags: Array.isArray(o.flags) ? o.flags : [],
      stats: o.stats && !Array.isArray(o.stats) ? o.stats : {},
      extra: Array.isArray(o.extra) ? o.extra : [],
    };
  }
  const pg = d.pg && !Array.isArray(d.pg) ? d.pg : {};
  for (const [n, p] of Object.entries(pg))
    if (p && Array.isArray(p.eq)) db.pg[n] = { ...p, eq: p.eq };
  return db;
}

export function serializeDb(db: RelicDb): string {
  return `window.MUD_DB = ${JSON.stringify(db)};\n`;
}

// ---------- lettura delle righe ----------

/** Quanto vale l'ultimo oggetto preso o tolto per dare il nome a un identify. */
export const NAME_TTL_MS = 180_000;

const NAME_LINE = [
  /^Smetti di usare (.+)\.$/,
  /^Prendi (.+?) da .+\.$/,
  /^Prendi (.+)\.$/,
  /^Impugni (.+)\.$/,
  /^Tieni in mano (.+)\.$/,
];

/**
 * Segue le righe del MUD: raccoglie gli identify e l'ultimo oggetto preso o tolto. L'identify
 * finisce col prompt (o con "Vieni sopraffatto").
 */
export class IdentifyReader {
  private cap: IdentifyCapture | null = null;
  private lastName: { nome: string; t: number } | null = null;

  constructor(
    private readonly now: () => number,
    private readonly done: (c: IdentifyCapture, nome?: string) => void,
  ) {}

  line(text: string): void {
    const l = text.replace(/\r/g, '');
    if (this.cap) {
      if (/^Vieni sopraffatt/.test(l)) return this.close();
      return identifyLine(this.cap, l);
    }
    const start = startIdentify(l.trim());
    if (start) {
      this.cap = start;
      return;
    }
    for (const re of NAME_LINE) {
      const m = re.exec(l.trim());
      if (m) {
        this.lastName = { nome: m[1], t: this.now() };
        return;
      }
    }
  }

  prompt(): void {
    if (this.cap) this.close();
  }

  private close(): void {
    const c = this.cap!;
    this.cap = null;
    if (c.ultimo === 'flags') c.ultimo = undefined;
    delete c.ultimo;
    const n =
      this.lastName && this.now() - this.lastName.t < NAME_TTL_MS ? this.lastName.nome : undefined;
    this.done(c, n);
  }
}

// ---------- importazione ----------

const PROMPT = /^(\S+) H-?\d+ M-?\d+ V-?\d+/;

/**
 * Gli identify di un testo incollato (log, documento con i copia-incolla): ognuno comincia con
 * `Oggetto: '…'` e finisce al successivo, a un prompt o a "Vieni sopraffatto".
 */
export function identifiesFromText(text: string): IdentifyCapture[] {
  const out: IdentifyCapture[] = [];
  let c: IdentifyCapture | null = null;
  const close = () => {
    if (c) {
      delete c.ultimo;
      out.push(c);
    }
    c = null;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const l = raw.replace(/\u00a0/g, ' ');
    const start = startIdentify(l.trim());
    if (start) {
      close();
      c = start;
    } else if (c && (PROMPT.test(l) || /^Vieni sopraffatt/.test(l.trim()))) close();
    else if (c) identifyLine(c, l);
  }
  close();
  return out;
}

/** Nomi dei contenitori: quelli scelti più quelli già usati dagli oggetti. */
export function containerNames(db: RelicDb): string[] {
  const s = new Set(db.contenitori ?? []);
  for (const o of Object.values(db.oggetti)) if (o.contenitore) s.add(o.contenitore);
  return [...s].sort((a, b) => a.localeCompare(b, 'it'));
}

/** Pulisce un elenco di nomi di contenitore (spazi, doppioni, vuoti). */
export function cleanContainers(nomi: string[]): string[] {
  const out: string[] = [];
  for (const n of nomi) {
    const t = n.trim().replace(/\s+/g, ' ');
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

// ---------- per i pannelli ----------

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/** Riassunto in una riga: "AC 5 · MANA +28 · MANA-REGEN +13". */
export function statLine(o: Relic): string {
  const p: string[] = [];
  if (o.dado) p.push(`${o.dado}${o.tipoDanno ? ` ${o.tipoDanno}` : ''}`);
  if (o.ac) p.push(`AC ${o.ac}`);
  for (const [k, v] of Object.entries(o.stats)) p.push(`${k} ${signed(v)}`);
  for (const x of o.poteri ?? []) p.push(x);
  return p.join(' · ');
}

/** Oggetti che corrispondono alla ricerca (nome, parole chiave, statistiche, flag, tipo). */
export function searchRelics(
  db: RelicDb,
  q: string,
  max = 200,
  filtro: (o: Relic) => boolean = () => true,
): Relic[] {
  const parti = q.toLowerCase().split(/\s+/).filter(Boolean);
  const testo = (o: Relic) =>
    [o.nome, o.chiave, o.parole, o.tipo, o.slot, o.contenitore, ...o.flags, ...Object.keys(o.stats)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  return Object.values(db.oggetti)
    .filter((o) => filtro(o) && parti.every((w) => testo(o).includes(w)))
    .sort((a, b) => (a.nome ?? a.chiave).localeCompare(b.nome ?? b.chiave, 'it'))
    .slice(0, max);
}
