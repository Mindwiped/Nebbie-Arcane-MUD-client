import { readData, writeData } from '../../core/backend';
import { dirOf, isMove, opposite, runDir } from './moves';
import data from './percorsi.json';

/**
 * Percorsi (SPECIFICA 5.2). Quelli del pacchetto (127, da percorsi_ui.xml) sono fissi: si
 * nascondono o si sostituiscono con una copia. Quelli dell'utente (registrati con `rec` o
 * scritti a mano) stanno in percorsi.json insieme a preferiti, nascosti e ultimo uso.
 *
 * Il path è una lista di comandi separati da virgole; un numero davanti a una direzione la
 * ripete (`2w` = `w,w`).
 */
/** `mud`: calcolato dai file d'area del MUD (strumento tools/mudder, 2026-11-23). */
export type PathOrigin = 'pacchetto' | 'registrato' | 'utente' | 'mud';

export interface PathEntry {
  id: string;
  zona: string;
  nome: string;
  nota: string;
  path: string;
  /** Note lunghe (es. mob del giro). */
  info?: string;
  /** Avvertenze (es. percorso troppo lungo o pericoloso). */
  troppo?: string;
  origine: PathOrigin;
  /** Titolo della stanza di partenza e di arrivo, se noti. */
  partenza?: string;
  arrivo?: string;
  /** Davanti a una porta chiusa prova una volta `open <direzione>`. */
  apriPorte?: boolean;
  /** Copia modificata di un percorso del pacchetto: ne prende il posto. */
  sostituisce?: string;
}

export interface PathsFile {
  versione: 2;
  /** Percorsi dell'utente (registrati, scritti a mano, copie di quelli del pacchetto). */
  percorsi: PathEntry[];
  /** Id dei percorsi del pacchetto nascosti. */
  nascosti: string[];
  preferiti: string[];
  /** Id → ultimo uso (ms). */
  usati: Record<string, number>;
}

export const STORAGE_NAME = 'percorsi';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export const BUILTIN_PATHS: PathEntry[] = data.zone.flatMap((z) =>
  z.voci.map(
    (v) =>
      ({
        ...v,
        zona: z.zona,
        origine: 'pacchetto',
        id: `pkg:${fold(z.zona)}/${fold(v.nome)}`,
      }) as PathEntry,
  ),
);

export function emptyPathsFile(): PathsFile {
  return { versione: 2, percorsi: [], nascosti: [], preferiti: [], usati: {} };
}

export function newPathId(): string {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Elenco completo: pacchetto (senza nascosti e sostituiti) più quelli dell'utente. */
export function allPaths(file: PathsFile): PathEntry[] {
  const hidden = new Set(file.nascosti);
  const replaced = new Set(file.percorsi.map((p) => p.sostituisce).filter(Boolean));
  return [
    ...BUILTIN_PATHS.filter((p) => !hidden.has(p.id) && !replaced.has(p.id)),
    ...file.percorsi,
  ];
}

/** `2w,run e,open frasca` → `['w','w','run e','open frasca']` (come Percorsi.espandi). */
export function expandPath(path: string): string[] {
  const out: string[] = [];
  for (const raw of path.split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = /^(\d+)\s*([A-Za-z]+)$/.exec(tok);
    if (m) for (let i = 0; i < Number(m[1]); i++) out.push(m[2]);
    else out.push(tok);
  }
  return out;
}

/** Il contrario di `expandPath`: le direzioni ripetute si compattano (`n,n,n` → `3n`). */
export function compactPath(steps: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i].trim();
    let n = 1;
    if (dirOf(s) && /^[a-z]+$/i.test(s)) while (steps[i + n]?.trim() === s) n++;
    out.push(n > 1 ? `${n}${s}` : s);
    i += n;
  }
  return out.join(',');
}

const DOOR_CMD = /^(open|unlock|apri)\s+(.+)$/i;

/**
 * Percorso di ritorno: ordine e direzioni invertiti. Le porte da aprire restano davanti allo
 * stesso passaggio. I passi che non si invertono da soli sono segnalati in `dubbi`.
 */
export function invertPath(steps: string[]): { passi: string[]; dubbi: string[] } {
  // Unità = comandi per le porte + il passo che le attraversa.
  const units: { porte: string[]; passo?: string }[] = [];
  let porte: string[] = [];
  for (const s of steps) {
    if (DOOR_CMD.test(s)) porte.push(s);
    else {
      units.push({ porte, passo: s });
      porte = [];
    }
  }
  if (porte.length) units.push({ porte });

  const passi: string[] = [];
  const dubbi: string[] = [];
  for (const u of units.reverse()) {
    for (const p of u.porte) {
      const m = DOOR_CMD.exec(p)!;
      const d = dirOf(m[2]);
      if (d) passi.push(`${m[1]} ${opposite(d)}`);
      else {
        passi.push(p);
        dubbi.push(`"${p}": dall'altra parte la porta potrebbe chiamarsi in un altro modo.`);
      }
    }
    if (!u.passo) continue;
    const d = dirOf(u.passo);
    const r = runDir(u.passo);
    if (d) passi.push(opposite(d)!);
    else if (r) {
      passi.push(`run ${opposite(r)}`);
      dubbi.push(`"${u.passo}": controlla che al ritorno il run si fermi nello stesso punto.`);
    } else {
      passi.push(u.passo);
      dubbi.push(`"${u.passo}": non si inverte da solo, va sistemato a mano.`);
    }
  }
  return { passi, dubbi };
}

/** Raggruppa per zona (senza distinguere maiuscole: "foresta incantata" = "Foresta Incantata"). */
export function groupByZone(list: PathEntry[]): { zona: string; voci: PathEntry[] }[] {
  const zones = new Map<string, { zona: string; voci: PathEntry[] }>();
  for (const p of list) {
    const k = fold(p.zona);
    if (!zones.has(k)) zones.set(k, { zona: p.zona, voci: [] });
    zones.get(k)!.voci.push(p);
  }
  return [...zones.values()].sort((a, b) => a.zona.localeCompare(b.zona, 'it'));
}

/** Cerca per nome: prima il nome esatto, poi i nomi che contengono il testo. */
export function findPaths(list: PathEntry[], query: string): PathEntry[] {
  const q = fold(query);
  if (!q) return [];
  const exact = list.filter((p) => fold(p.nome) === q);
  if (exact.length) return exact;
  return list.filter((p) => fold(p.nome).includes(q));
}

/** Filtro del pannello: nome, nota, zona o info. */
export function filterPaths(list: PathEntry[], query: string): PathEntry[] {
  const q = fold(query);
  if (!q) return list;
  return list.filter((p) =>
    [p.nome, p.nota, p.zona, p.info ?? ''].some((f) => fold(f).includes(q)),
  );
}

/** Numero di comandi e di movimenti di un percorso (per il dettaglio). */
export function pathSize(path: string): { comandi: number; movimenti: number } {
  const c = expandPath(path);
  return { comandi: c.length, movimenti: c.filter(isMove).length };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function readEntry(v: unknown, fallbackOrigin: PathOrigin): PathEntry | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (typeof d.nome !== 'string' || typeof d.path !== 'string') return null;
  const origine =
    d.origine === 'registrato' || d.origine === 'utente' || d.origine === 'mud'
      ? d.origine
      : fallbackOrigin;
  const zona = str(d.zona) ?? 'Registrati';
  const e: PathEntry = {
    // Senza id (file della versione 1): uno stabile, così preferiti e ultimo uso restano.
    id: str(d.id) ?? `u:${fold(zona)}/${fold(d.nome)}`,
    zona,
    nome: d.nome,
    nota: typeof d.nota === 'string' ? d.nota : '',
    path: d.path,
    origine,
  };
  for (const k of ['info', 'troppo', 'partenza', 'arrivo', 'sostituisce'] as const) {
    const s = str(d[k]);
    if (s) e[k] = s;
  }
  if (d.apriPorte === true) e.apriPorte = true;
  return e;
}

/** Legge percorsi.json; la versione 1 (solo `registrati`) si converte da sola. */
export function parsePaths(json: string | null): PathsFile {
  if (!json) return emptyPathsFile();
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    throw new Error('Il file dei percorsi è danneggiato (JSON non valido).', { cause: e });
  }
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const list = (v: unknown, origin: PathOrigin) =>
    (Array.isArray(v) ? v : []).map((x) => readEntry(x, origin)).filter((x) => x !== null);
  if (d.versione !== 2) return { ...emptyPathsFile(), percorsi: list(d.registrati, 'registrato') };
  const usati: Record<string, number> = {};
  if (d.usati && typeof d.usati === 'object')
    for (const [k, v] of Object.entries(d.usati)) if (typeof v === 'number') usati[k] = v;
  return {
    versione: 2,
    percorsi: list(d.percorsi, 'utente'),
    nascosti: strings(d.nascosti),
    preferiti: strings(d.preferiti),
    usati,
  };
}

export async function loadPaths(): Promise<PathsFile> {
  return parsePaths(await readData(STORAGE_NAME));
}

export async function savePaths(file: PathsFile): Promise<void> {
  await writeData(STORAGE_NAME, JSON.stringify(file, null, 2));
}
