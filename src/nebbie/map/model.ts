import formati from '../parser/formati.json';
import type { Dir, RoomEvent } from '../parser/types';

/**
 * Modello della mappa (SPECIFICA 4.1): zone e stanze, salvate in mappa.json. Coordinate come
 * su un foglio: nord = y+1, est = x+1, su = z+1.
 */
export interface MapArea {
  id: number;
  nome: string;
  tipo: 'mondo' | 'isola';
}

export interface MapDoor {
  /** Comando che l'ha aperta (`open porta`, `open n`). */
  apri?: string;
  chiave?: string;
}

export interface MapRoom {
  id: number;
  zona: number;
  x: number;
  y: number;
  z: number;
  titolo: string;
  desc: string;
  firma: string;
  /** Uscite collegate: direzione → stanza. */
  uscite: Partial<Record<Dir, number>>;
  /** Uscite viste nella riga `Uscite:` o in "Uscite visibili" (anche non ancora esplorate). */
  viste: Dir[];
  /** Nomi delle stanze di "Uscite visibili" (normalizzati). */
  vicini: Partial<Record<Dir, string>>;
  /** Uscite speciali: comando → stanza (`enter portale`). */
  speciali?: Record<string, number>;
  porte?: Partial<Record<Dir, MapDoor>>;
  note?: string;
  mob?: string[];
  colore?: string;
  /** Monete lasciate per terra per riconoscerla tra stanze identiche (1, 2, 3…). */
  marca?: number;
  /** Le monete della marca sono state posate davvero (o trovate per terra). */
  posate?: boolean;
  visita?: number;
}

export interface MapData {
  versione: 1;
  /** Marcatura delle stanze identiche con le monete spenta. */
  noMonete?: boolean;
  prossima: number;
  zone: MapArea[];
  stanze: Record<number, MapRoom>;
}

export const DIRS: Dir[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'u', 'd'];

export const OPP: Record<Dir, Dir> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
  u: 'd',
  d: 'u',
};

export const DELTA: Record<Dir, [number, number, number]> = {
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
  ne: [1, 1, 0],
  nw: [-1, 1, 0],
  se: [1, -1, 0],
  sw: [-1, -1, 0],
  u: [0, 0, 1],
  d: [0, 0, -1],
};

export function emptyMap(): MapData {
  return { versione: 1, prossima: 1, zone: [], stanze: {} };
}

/** Titolo normalizzato: minuscolo, senza punto finale né "(...)" in fondo. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE = formati.rumore.map((r) => new RegExp(r, 'u'));
const isNoise = (l: string) => {
  const t = l.trim();
  return t === '' || NOISE.some((r) => r.test(t));
};

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 2147483647;
  return h.toString(16);
}

/** Dati utili di una stanza vista: descrizione pulita, firma, vicini. */
export interface Seen {
  titolo: string;
  desc: string;
  firma: string;
  viste: Dir[];
  vicini: Partial<Record<Dir, string>>;
  /** Monete per terra (righe "One miserable gold coin.[N]"); `mucchio`: monete non contabili. */
  monete: number;
  mucchio: boolean;
}

/**
 * Monete per terra (testo reale del 2026-11-14): una moneta = "One miserable gold coin.",
 * più monete posate una alla volta = "[ 1] One miserable gold coin.[N]". Un drop di più monete
 * insieme diventa "A pile of gold coins." e il numero non si legge più.
 */
export function coinsOf(contenuti: string[]): { monete: number; mucchio: boolean } {
  let monete = 0;
  let mucchio = false;
  for (const l of contenuti) {
    const m = /^(?:\[\s*\d+\]\s*)?One miserable gold coin\.(?:\[(\d+)\])?\s*$/i.exec(l.trim());
    if (m) monete += Number(m[1] ?? 1);
    else if (/gold coins\.?/i.test(l)) mucchio = true;
  }
  return { monete, mucchio };
}

/** Righe che cambiano da una visita all'altra (sangue, oggetti per terra…). */
const VOLATILE = /sangue|^c'e' |^ci sono |^a pile of|^an? \w+ (is|lies) /i;

export function seenOf(ev: RoomEvent): Seen {
  const righe = ev.righeDescrizione.filter((l) => !isNoise(l) && !VOLATILE.test(l.trim()));
  const desc = righe.join(' ').replace(/\s+/g, ' ').trim();
  // La firma usa solo le prime due righe: in fondo alla descrizione il MUD aggiunge messaggi
  // che cambiano (log reali: "C'e' del sangue ai tuoi piedi.").
  const testa = righe.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const vicini: Partial<Record<Dir, string>> = {};
  for (const v of ev.visibili) vicini[v.dir] = normName(v.nome);
  const viste = [...new Set<Dir>([...ev.uscite, ...ev.visibili.map((v) => v.dir)])];
  return {
    titolo: ev.titolo.trim(),
    desc,
    firma: `${normName(ev.titolo)}|${hash(testa)}`,
    viste,
    vicini,
    ...coinsOf(ev.contenuti),
  };
}

/** Lettura tollerante di mappa.json. */
export function parseMap(json: string | null): MapData {
  if (!json) return emptyMap();
  let d: Partial<MapData>;
  try {
    d = JSON.parse(json) as Partial<MapData>;
  } catch (e) {
    throw new Error('Il file della mappa è danneggiato (JSON non valido).', { cause: e });
  }
  const stanze: Record<number, MapRoom> = {};
  for (const r of Object.values(d.stanze ?? {})) {
    if (r && typeof r.id === 'number' && typeof r.titolo === 'string') stanze[r.id] = r;
  }
  const ids = Object.keys(stanze).map(Number);
  return {
    versione: 1,
    ...(d.noMonete === true ? { noMonete: true } : {}),
    prossima: Math.max(
      typeof d.prossima === 'number' ? d.prossima : 1,
      ...ids.map((i) => i + 1),
      1,
    ),
    zone: Array.isArray(d.zone) ? d.zone.filter((z) => z && typeof z.id === 'number') : [],
    stanze,
  };
}
