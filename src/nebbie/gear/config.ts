import type { EqsetConfig } from './legacyEqset';

/**
 * Configurazione del vestiario di un personaggio (SPECIFICA 5.3): contenitori, set ed
 * eccezioni dei singoli oggetti. Si salva in vestiario.json, una per profilo.
 */
export interface Piece {
  nome: string;
  slot?: string;
}

export type UseCmd = 'wear' | 'hold' | 'wield';

export interface Container {
  /** Parola chiave per i comandi (`exa compendium`, `get x compendium`). */
  parola: string;
  /** Parte del nome per riconoscerlo nelle liste (vuoto = la parola chiave). */
  nome: string;
  /** Dove sta di solito. `dentro`: dentro il contenitore `in`. */
  dove: 'indossato' | 'inventario' | 'dentro';
  in?: string;
  /** Va tolto di dosso per guardarci dentro o usarlo (exa non funziona se lo indossi). */
  togliPerUsare?: boolean;
}

export interface GearConfig {
  /** Dove si cercano i pezzi da indossare, in ordine (dopo l'inventario). */
  contenitori: Container[];
  /**
   * Dove vanno i pezzi tolti: parola di un contenitore o `inv`. Non impostata = il primo
   * contenitore. Con nessun contenitore e nessuna destinazione il client te li chiede.
   */
  destinazione?: string;
  sets: Record<string, Piece[]>;
  /** Nome dell'oggetto → parola chiave (vince sulle regole automatiche). */
  chiavi: Record<string, string>;
  /** Nome dell'oggetto → comando per indossarlo. */
  usa: Record<string, UseCmd>;
  /** Nome dell'oggetto → dove va quando lo togli: parola di un contenitore o `inv`. */
  posti: Record<string, string>;
  /** Risposte del MUD (in minuscolo, parti di frase) che fanno fallire un passo. */
  errori: string[];
  /** Riparazione: testo che dice che il fabbro è nella stanza, e a chi dare i pezzi. */
  fabbro: { testo: string; nome: string; automatico: boolean };
}

export const DEFAULT_ERRORS = [
  'non hai',
  'non trovi',
  'non riesci',
  'non puoi',
  'non vedi',
  'non lo vedi',
  'non la vedi',
  'non sembra che tu abbia',
  "non c'e'",
  "non c'è",
  "hai gia'",
  'hai già',
  "stai gia'",
  'stai già',
  "e' pien",
  'è pien',
  'troppo pesant',
  "you don't",
  'you do not',
  "you can't",
  'you cannot',
];

export function defaultGearConfig(): GearConfig {
  return {
    contenitori: [],
    sets: {},
    chiavi: {},
    usa: {},
    posti: {},
    errori: [...DEFAULT_ERRORS],
    fabbro: { testo: 'fabbro molto esperto', nome: 'fabbro', automatico: false },
  };
}

/** Configurazione del vecchio EqSet (compendium + borsa fissi) → contenitori generici. */
export function fromEqset(e: EqsetConfig): GearConfig {
  const cfg = defaultGearConfig();
  cfg.contenitori = [
    {
      parola: e.compendium,
      nome: e.compendiumNome || e.compendium,
      dove: 'indossato',
      togliPerUsare: true,
    },
    { parola: e.borsa, nome: e.borsa, dove: 'dentro', in: e.compendium },
  ];
  cfg.sets = structuredClone(e.sets);
  cfg.chiavi = { ...e.chiavi };
  cfg.usa = { ...e.usa };
  for (const [nome, p] of Object.entries(e.posti))
    cfg.posti[nome] = p === 'compendium' ? e.compendium : p === 'borsa' ? e.borsa : 'inv';
  cfg.errori = [...new Set([...e.errori, ...DEFAULT_ERRORS])];
  return cfg;
}

const ARTICOLI = new Set([
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'l',
  'un',
  'uno',
  'una',
  'a',
  'an',
  'the',
  'some',
  'pair',
  'of',
]);

/** Oggetti diversi con la stessa prima parola: la parola chiave giusta è un'altra. */
const CHIAVI_REGOLE: [RegExp, string][] = [
  [/anell.*\bnani\b/u, 'nani'],
  [/anell.*\bdorat/u, 'dorato'],
];

/** Parola chiave di un oggetto: eccezione, regola, poi prima parola che non è un articolo. */
export function keyword(nome: string, cfg: Pick<GearConfig, 'chiavi'>): string {
  if (cfg.chiavi[nome]) return cfg.chiavi[nome];
  const basso = nome.toLowerCase();
  for (const [re, k] of CHIAVI_REGOLE) if (re.test(basso)) return k;
  for (const w of nome.split(/[\s']+/)) {
    const p = w.toLowerCase();
    if (!ARTICOLI.has(p) && p.length > 1) return p.replace(/[^\p{L}\p{N}]/gu, '');
  }
  return basso;
}

/** Parole di un nome utili come parole chiave (senza articoli e preposizioni brevi). */
export function nameWords(nome: string): string[] {
  return nome
    .split(/[\s']+/)
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 2 && !ARTICOLI.has(w) && !PREPOSIZIONI.has(w));
}

const PREPOSIZIONI = new Set([
  'di',
  'del',
  'dei',
  'della',
  'delle',
  'dal',
  'dalla',
  'dello',
  'degli',
  'al',
  'alla',
  'alle',
  'allo',
  'agli',
  'con',
  'per',
  'tra',
  'fra',
  'and',
  'with',
]);

/**
 * Parole chiave univoche (richiesta del 2026-11-24): il MUD accetta l'inizio di una parola
 * (`get cotu` prende i coturni), quindi `bracciale` prende anche i braccialetti e `calzari` i
 * coturni (che tra le parole chiave hanno "calzari"). Per ogni nome la cui parola chiave
 * prenderebbe anche un altro oggetto si cerca, tra le sue parole chiave vere (identify o file
 * d'area, `kwOf`) o in mancanza tra le parole del nome, una che non è l'inizio di nessuna parola
 * degli altri. Le chiavi scritte a mano restano.
 */
export function uniqueKeys(
  nomi: string[],
  kwOf: (nome: string) => string[] | undefined,
  cfg: Pick<GearConfig, 'chiavi'>,
): { chiavi: Record<string, string>; dubbi: string[]; irrisolti: string[] } {
  const tutti = [...new Set(nomi)];
  const parole = new Map<string, { vere: boolean; w: string[] }>();
  for (const n of tutti) {
    const k = kwOf(n)
      ?.map((w) => w.toLowerCase())
      .filter(Boolean);
    parole.set(n, k?.length ? { vere: true, w: k } : { vere: false, w: nameWords(n) });
  }
  const prende = (k: string, n: string) =>
    tutti.some((o) => o !== n && parole.get(o)!.w.some((w) => w.startsWith(k)));
  const chiavi: Record<string, string> = {};
  const dubbi: string[] = [];
  const irrisolti: string[] = [];
  for (const n of tutti) {
    if (cfg.chiavi[n]) continue;
    const k = keyword(n, cfg);
    if (!prende(k, n)) continue;
    const { vere, w } = parole.get(n)!;
    // prima le parole chiave vere, poi quelle del nome; le più lunghe sbagliano meno
    const cand = [...w, ...nameWords(n)].filter((x, i, a) => x.length > 2 && a.indexOf(x) === i);
    const ok = cand.find((c) => !prende(c, n) && (vere ? w.includes(c) : true));
    if (ok) {
      chiavi[n] = ok;
      if (!vere) dubbi.push(n);
    } else irrisolti.push(n);
  }
  return { chiavi, dubbi, irrisolti };
}

/**
 * Ordine sicuro per parole chiave che sono l'inizio di altre (`bracciale` e `braccialetto`, log
 * del 2026-11-24): il MUD con `bracciale` può prendere il braccialetto, quindi i pezzi con la
 * parola più lunga si muovono prima e `bracciale` arriva quando resta solo lui. Ordine stabile.
 */
export function prefixSafe<T>(items: T[], k: (x: T) => string): T[] {
  const keys = items.map(k);
  const rank = keys.map((a) => keys.filter((b) => b !== a && b.startsWith(a)).length);
  return items
    .map((x, i) => ({ x, i }))
    .sort((p, q) => rank[p.i] - rank[q.i] || p.i - q.i)
    .map((p) => p.x);
}

export function useCommand(p: Piece, cfg: Pick<GearConfig, 'usa'>): UseCmd {
  if (cfg.usa[p.nome]) return cfg.usa[p.nome];
  const s = (p.slot ?? '').toLowerCase();
  if (s.includes('impugn') || s.includes('wield')) return 'wield';
  if (['tien', 'tenut', 'held', 'hold'].some((x) => s.includes(x))) return 'hold';
  return 'wear';
}

/** Il contenitore che corrisponde a un nome visto nelle liste, se c'è. */
export function containerOf(
  nome: string,
  cfg: Pick<GearConfig, 'contenitori'>,
): Container | undefined {
  const n = nome.toLowerCase();
  return cfg.contenitori.find((c) => n.includes((c.nome || c.parola).toLowerCase()));
}

const validPlace = (p: string | undefined, cfg: GearConfig): p is string =>
  p === 'inv' || (!!p && cfg.contenitori.some((c) => c.parola === p));

/** Dove vanno i pezzi tolti, se per l'oggetto non è detto altro. */
export function defaultPlace(cfg: GearConfig): string {
  if (validPlace(cfg.destinazione, cfg)) return cfg.destinazione;
  return cfg.contenitori[0]?.parola ?? 'inv';
}

/** Dove va un pezzo tolto: il suo posto, altrimenti la destinazione dei pezzi tolti. */
export function placeOf(nome: string, cfg: GearConfig): string {
  const p = cfg.posti[nome];
  return validPlace(p, cfg) ? p : defaultPlace(cfg);
}

/** Contenitori mai impostati per questo personaggio: prima di cambiare set vanno chiesti. */
export function needsContainers(cfg: GearConfig): boolean {
  return cfg.contenitori.length === 0 && cfg.destinazione === undefined;
}

/** Lettura tollerante (campi mancanti o sbagliati → predefiniti). */
export function parseGearConfig(json: unknown): GearConfig {
  const base = defaultGearConfig();
  if (!json || typeof json !== 'object') return base;
  const d = json as Record<string, unknown>;
  const rec = <T>(v: unknown): Record<string, T> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};
  const sets: Record<string, Piece[]> = {};
  for (const [k, v] of Object.entries(rec<unknown>(d.sets))) {
    if (!Array.isArray(v)) continue;
    sets[k] = v
      .filter((p) => p && typeof p.nome === 'string')
      .map((p) => (typeof p.slot === 'string' ? { nome: p.nome, slot: p.slot } : { nome: p.nome }));
  }
  const contenitori = (Array.isArray(d.contenitori) ? d.contenitori : [])
    .filter((c) => c && typeof c.parola === 'string' && c.parola)
    .map((c): Container => {
      const dove = c.dove === 'inventario' || c.dove === 'dentro' ? c.dove : 'indossato';
      const out: Container = {
        parola: c.parola,
        nome: typeof c.nome === 'string' ? c.nome : '',
        dove,
      };
      if (dove === 'dentro' && typeof c.in === 'string') out.in = c.in;
      if (c.togliPerUsare === true) out.togliPerUsare = true;
      return out;
    });
  const f = rec<unknown>(d.fabbro);
  return {
    contenitori,
    ...(typeof d.destinazione === 'string' && d.destinazione
      ? { destinazione: d.destinazione }
      : {}),
    sets,
    chiavi: rec(d.chiavi),
    usa: rec(d.usa),
    posti: rec(d.posti),
    errori: Array.isArray(d.errori)
      ? d.errori.filter((e): e is string => typeof e === 'string')
      : base.errori,
    fabbro: {
      testo: typeof f.testo === 'string' && f.testo ? f.testo : base.fabbro.testo,
      nome: typeof f.nome === 'string' && f.nome ? f.nome : base.fabbro.nome,
      automatico: f.automatico === true,
    },
  };
}
