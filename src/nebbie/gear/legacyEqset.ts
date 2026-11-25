/** Formato del vecchio EqSet (eqset.json), letto solo per convertirlo in vestiario.json.
 *
 * Configurazione di EqSet (porting di eqset.xml, "EQSET 2" del 2026-11-09). Un set è la
 * "fotografia" di ciò che indossi; i pezzi tolti vanno nel compendium (il contenitore che
 * indossi), nella borsa che sta dentro il compendium, o in inventario.
 */
export interface EqsetPiece {
  nome: string;
  slot?: string;
}

export type UseCmd = 'wear' | 'hold' | 'wield';
export type Place = 'compendium' | 'borsa' | 'inv';

export interface EqsetConfig {
  /** Parola chiave del contenitore indossato. */
  compendium: string;
  /** Parte del nome del contenitore (per riconoscerlo nelle liste). */
  compendiumNome: string;
  /** Parola chiave della borsa dentro il compendium. */
  borsa: string;
  sets: Record<string, EqsetPiece[]>;
  /** Nome dell'oggetto → parola chiave (vince sulle regole automatiche). */
  chiavi: Record<string, string>;
  /** Nome dell'oggetto → comando per indossarlo. */
  usa: Record<string, UseCmd>;
  /** Nome dell'oggetto → dove va quando lo togli. */
  posti: Record<string, Place>;
  /** Risposte del MUD (in minuscolo, parti di frase) che fermano il cambio. */
  errori: string[];
}

export function defaultConfig(): EqsetConfig {
  return {
    compendium: 'compendium',
    compendiumNome: 'compendium',
    borsa: 'borsa',
    sets: {},
    // Niente oggetti di un personaggio preciso: l'app si può passare ad altri giocatori.
    chiavi: {},
    usa: {},
    posti: {},
    errori: [
      'non hai',
      'non trovi',
      'non riesci',
      'non puoi',
      'non vedi',
      'non lo vedi',
      'non la vedi',
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
    ],
  };
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
]);

/** Oggetti diversi con la stessa prima parola: la parola chiave giusta è un'altra. */
const CHIAVI_REGOLE: [RegExp, string][] = [
  [/anell.*\bnani\b/u, 'nani'],
  [/anell.*\bdorat/u, 'dorato'],
];

export function keyword(nome: string, cfg: EqsetConfig): string {
  if (cfg.chiavi[nome]) return cfg.chiavi[nome];
  const basso = nome.toLowerCase();
  for (const [re, k] of CHIAVI_REGOLE) if (re.test(basso)) return k;
  for (const w of nome.split(/[\s']+/)) {
    const p = w.toLowerCase();
    if (!ARTICOLI.has(p) && p.length > 1) return p.replace(/[^\p{L}\p{N}]/gu, '');
  }
  return basso;
}

export function useCommand(p: EqsetPiece, cfg: EqsetConfig): UseCmd {
  if (cfg.usa[p.nome]) return cfg.usa[p.nome];
  const s = (p.slot ?? '').toLowerCase();
  if (s.includes('impugn') || s.includes('wield')) return 'wield';
  if (['tien', 'tenut', 'held', 'hold'].some((x) => s.includes(x))) return 'hold';
  return 'wear';
}

export function placeOf(nome: string, cfg: EqsetConfig): Place {
  const p = cfg.posti[nome];
  return p === 'borsa' || p === 'inv' ? p : 'compendium';
}

export const isBag = (nome: string, cfg: EqsetConfig) =>
  nome.toLowerCase().includes(cfg.borsa.toLowerCase());

export const isContainer = (nome: string, cfg: EqsetConfig) => {
  const n = nome.toLowerCase();
  return (
    n.includes(cfg.compendium.toLowerCase()) ||
    (cfg.compendiumNome !== '' && n.includes(cfg.compendiumNome.toLowerCase()))
  );
};

/** Compendium o borsa: non fanno parte dei set. */
export const isStorage = (nome: string, cfg: EqsetConfig) =>
  isContainer(nome, cfg) || isBag(nome, cfg);

export function parseEqsetConfig(json: unknown): EqsetConfig {
  const base = defaultConfig();
  if (!json || typeof json !== 'object') return base;
  const d = json as Partial<EqsetConfig>;
  const str = (v: unknown, f: string) => (typeof v === 'string' && v ? v : f);
  const rec = <T>(v: unknown, f: Record<string, T>) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : f;
  const sets: Record<string, EqsetPiece[]> = {};
  for (const [k, v] of Object.entries(rec<unknown>(d.sets, {}))) {
    if (Array.isArray(v))
      sets[k] = v
        .filter((p) => p && typeof p.nome === 'string')
        .map((p) =>
          typeof p.slot === 'string' ? { nome: p.nome, slot: p.slot } : { nome: p.nome },
        );
  }
  return {
    compendium: str(d.compendium, base.compendium),
    compendiumNome: typeof d.compendiumNome === 'string' ? d.compendiumNome : base.compendiumNome,
    borsa: str(d.borsa, base.borsa),
    sets,
    chiavi: rec(d.chiavi, base.chiavi),
    usa: rec(d.usa, base.usa),
    posti: rec(d.posti, base.posti),
    errori: Array.isArray(d.errori) ? d.errori.filter((e) => typeof e === 'string') : base.errori,
  };
}
