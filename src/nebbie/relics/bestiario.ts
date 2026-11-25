/**
 * Bestiario (richiesta dell'utente del 2026-11-23): il database dei mob in `mob.js`
 * (`window.MUD_MOB = {…};`) nella cartella del Reliquiario, generato dai file d'area con
 * `tools/mudder`. Solo lettura: il client lo consulta, non lo modifica.
 */

export interface MobSpawn {
  stanza: number;
  titolo?: string;
  zona?: string;
  max?: number;
  /** Percorso a piedi dalla partenza (di solito la piazza delle Nebbie di Myst). */
  percorso?: string;
  porte?: boolean;
  passi?: number;
}

export interface MobItem {
  vnum: number;
  nome?: string;
  slot?: string;
  contiene?: { vnum: number; nome?: string }[];
}

export interface Mob {
  vnum: number;
  chiave: string;
  nome: string;
  descrizione?: string;
  livello?: number;
  allineamento?: number;
  razza?: string | number;
  sesso?: string;
  classi?: string[];
  flag?: string[];
  incantesimi?: string[];
  resistenze?: string[];
  immunita?: string[];
  suscettibilita?: string[];
  attacchi?: number;
  ac?: number;
  hitroll?: number;
  pf?: string;
  danno?: string;
  oro?: number;
  zona?: string;
  spawn?: MobSpawn[];
  equip?: MobItem[];
  inventario?: MobItem[];
  file?: string;
}

export interface MobDb {
  versione: number;
  aggiornato?: string;
  partenza?: { stanza: number; titolo?: string };
  zone?: { num: number; nome: string; da: number; a: number }[];
  mob: Record<string, Mob>;
}

export const emptyMobDb = (): MobDb => ({ versione: 1, mob: {} });

/** Legge `mob.js` (o il JSON puro). */
export function parseMobDb(text: string): MobDb {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('mob.js non contiene il database dei mob');
  const d = JSON.parse(text.slice(i, j + 1)) as Partial<MobDb>;
  return { ...emptyMobDb(), ...d, mob: d.mob && typeof d.mob === 'object' ? d.mob : {} };
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Testo in cui si cerca: nomi, zona, flag, incantesimi, immunità, oggetti portati. */
function haystack(m: Mob): string {
  return fold(
    [
      m.nome,
      m.chiave,
      m.zona,
      m.razza,
      ...(m.flag ?? []),
      ...(m.classi ?? []),
      ...(m.incantesimi ?? []),
      ...(m.resistenze ?? []),
      ...(m.immunita ?? []),
      ...(m.suscettibilita ?? []),
      ...(m.equip ?? []).map((e) => e.nome),
      ...(m.inventario ?? []).map((e) => e.nome),
      ...(m.spawn ?? []).map((s) => s.titolo),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Cerca i mob: tutte le parole devono comparire; `lvl>30`, `lvl<10`, `lvl=20` filtrano il
 * livello. Ordine: livello decrescente.
 */
export function searchMobs(db: MobDb, q: string, max = 200): Mob[] {
  const words: string[] = [];
  const tests: ((m: Mob) => boolean)[] = [];
  for (const w of fold(q).split(/\s+/).filter(Boolean)) {
    const lv = /^(?:lvl|liv|livello)([<>=])(\d+)$/.exec(w);
    if (lv) {
      const n = Number(lv[2]);
      const op = lv[1];
      tests.push((m) => {
        const l = m.livello ?? 0;
        return op === '<' ? l < n : op === '>' ? l > n : l === n;
      });
    } else words.push(w);
  }
  const out: Mob[] = [];
  for (const m of Object.values(db.mob)) {
    if (!tests.every((t) => t(m))) continue;
    if (words.length) {
      const h = haystack(m);
      if (!words.every((w) => h.includes(w))) continue;
    }
    out.push(m);
  }
  out.sort((a, b) => (b.livello ?? 0) - (a.livello ?? 0) || a.nome.localeCompare(b.nome));
  return out.slice(0, max);
}

/** Riga breve per l'elenco. */
export function mobLine(m: Mob): string {
  const p: string[] = [];
  if (m.incantesimi?.includes('SANCTUARY')) p.push('sanct');
  if (m.flag?.includes('AGGRESSIVE')) p.push('aggressivo');
  if (m.immunita?.length) p.push(`imm ${m.immunita.join(' ').toLowerCase()}`);
  if (m.suscettibilita?.length) p.push(`susc ${m.suscettibilita.join(' ').toLowerCase()}`);
  if (m.equip?.length) p.push(`${m.equip.length} pezzi`);
  return p.join(' · ');
}
