import table from './incantesimi.json';

/**
 * Abbreviazioni degli incantesimi → nome completo (`mm orco` → `cast 'magic missile' orco`).
 * La tabella predefinita sta in `incantesimi.json`: le 74 dei pacchetti Mudlet più tutti gli
 * incantesimi dell'elenco `ALL` del MUD (2026-11-15). I poteri psionici sono comandi diretti
 * (log reali: `doorway niobe`), quindi la loro abbreviazione manda il nome senza `cast`.
 * L'utente può modificare la tabella (abbreviazioni.json nella cartella dati).
 */
export interface SpellAbbrev {
  nome: string;
  /** Comando diretto (poteri psionici) invece di `cast '…'`. */
  diretto?: boolean;
}

export type SpellTable = Record<string, SpellAbbrev>;

function fromJson(t: { incantesimi: Record<string, string>; psionici: Record<string, string> }) {
  const out: SpellTable = {};
  for (const [k, nome] of Object.entries(t.incantesimi)) out[k] = { nome };
  for (const [k, nome] of Object.entries(t.psionici)) out[k] = { nome, diretto: true };
  return out;
}

export const DEFAULT_TABLE: Readonly<SpellTable> = fromJson(table);

/** Solo i nomi (per chi ha bisogno dell'elenco degli incantesimi, es. Mantieni attivi). */
export function spellNames(t: Readonly<SpellTable> = DEFAULT_TABLE): string[] {
  return [...new Set(Object.values(t).map((v) => v.nome))].sort();
}

/**
 * Espande `mm orco` in `cast 'magic missile' orco` (o `doorway niobe` per i psionici).
 * Restituisce `null` se il comando non è un'abbreviazione (va mandato così com'è).
 */
export function expandSpell(
  command: string,
  spells: Readonly<SpellTable> = DEFAULT_TABLE,
): string | null {
  const m = /^(\S+)(?: (.+))?$/.exec(command);
  if (!m || !Object.hasOwn(spells, m[1])) return null;
  const s = spells[m[1]];
  const arg = m[2] ? ` ${m[2]}` : '';
  return s.diretto ? `${s.nome}${arg}` : `cast '${s.nome}'${arg}`;
}

// ---------- elenco ALL del MUD ----------

/** Una riga dell'elenco `ALL`: `[  1] armor   <  5>  2   5  52   5  52  52  52`. */
export interface AllRow {
  nome: string;
  mana: number;
  /** Livelli per classe: Cl, Mu, Dr, Sc, Pa, Ra, Ps (oltre 50 = non disponibile). */
  livelli: number[];
}

const ROW = /^\[\s*\d+\]\s+(.+?)\s+<\s*(\d+)>\s+((?:\d+\s*){7})$/;

export function parseAllRow(line: string): AllRow | null {
  const m = ROW.exec(line.trim());
  if (!m) return null;
  return {
    nome: m[1].trim().toLowerCase(),
    mana: Number(m[2]),
    livelli: m[3].trim().split(/\s+/).map(Number),
  };
}

/**
 * Cosa è una voce dell'elenco: incantesimo (lo lancia almeno una classe che lancia
 * incantesimi: chierico, mago, druido, stregone), potere psionico (solo lo psionico) o abilità
 * (bash, kick, sneak, parry…: mana 0 o 200, niente abbreviazione).
 */
export function kindOf(r: AllRow): 'incantesimo' | 'psionico' | 'abilita' {
  // mana 0 o 200: abilità (parry, bash, sneak…), anche se qualche classe che lancia la impara
  if (r.mana === 0 || r.mana >= 200) return 'abilita';
  if (Math.min(...r.livelli.slice(0, 4)) <= 50) return 'incantesimo';
  if ((r.livelli[6] ?? 99) <= 50) return 'psionico';
  return 'abilita';
}

/** Parole che sono anche comandi del MUD: l'abbreviazione prende una `c` davanti. */
const RISKY = new Set(['mount', 'turn', 'command', 'spell']);

/** Abbreviazione proposta per un nome (poi resa unica). */
export function suggestAbbrev(nome: string): string {
  const w = nome.toLowerCase().split(/\s+/).filter(Boolean);
  let a: string;
  if (w.length === 1) a = w[0].length <= 6 ? w[0] : w[0].slice(0, 5);
  else if (w.length === 2) a = w[0].slice(0, 2) + w[1].slice(0, 2);
  else a = w.map((x) => x[0]).join('');
  if (RISKY.has(a)) a = `c${a}`;
  return a;
}

/**
 * Aggiunge alla tabella gli incantesimi e i poteri psionici dell'elenco che non ci sono ancora
 * (per nome), con un'abbreviazione unica. Le voci già presenti non cambiano. Restituisce la
 * tabella nuova e le voci aggiunte.
 */
export function importAll(
  t: Readonly<SpellTable>,
  rows: readonly AllRow[],
): { table: SpellTable; aggiunte: [string, SpellAbbrev][] } {
  const out: SpellTable = { ...t };
  const have = new Set(Object.values(out).map((v) => v.nome.toLowerCase()));
  const aggiunte: [string, SpellAbbrev][] = [];
  for (const r of rows) {
    const kind = kindOf(r);
    if (kind === 'abilita' || have.has(r.nome)) continue;
    const base = suggestAbbrev(r.nome);
    let a = base;
    for (let i = 2; Object.hasOwn(out, a); i++) a = `${base}${i}`;
    const v: SpellAbbrev = kind === 'psionico' ? { nome: r.nome, diretto: true } : { nome: r.nome };
    out[a] = v;
    have.add(r.nome);
    aggiunte.push([a, v]);
  }
  return { table: out, aggiunte };
}

// ---------- file dell'utente ----------

export interface SpellFile {
  versione: 1;
  voci: SpellTable;
}

/** Lettura tollerante di abbreviazioni.json; senza file vale la tabella predefinita. */
export function parseSpellFile(json: string | null): SpellTable {
  if (!json) return { ...DEFAULT_TABLE };
  const d = JSON.parse(json) as Partial<SpellFile>;
  const out: SpellTable = {};
  for (const [k, v] of Object.entries(d.voci ?? {})) {
    const key = k.trim().toLowerCase();
    if (!key || /\s/.test(key) || !v || typeof v.nome !== 'string' || !v.nome.trim()) continue;
    out[key] = {
      nome: v.nome.trim().toLowerCase(),
      ...(v.diretto === true ? { diretto: true } : {}),
    };
  }
  return out;
}

export function serializeSpellFile(t: Readonly<SpellTable>): string {
  return JSON.stringify({ versione: 1, voci: t } satisfies SpellFile);
}
