import { readData, writeData } from './backend';

/**
 * Impostazioni dell'aspetto e degli avvisi (impostazioni.json nella cartella dati), uguali per
 * tutti i personaggi. Fase 6, richiesta dell'utente del 2026-11-15.
 */
export type Tema = 'scuro' | 'nero' | 'chiaro';

/** Eventi che possono avvisare con un suono e/o una notifica di sistema. */
export type AlertKind = 'furto' | 'terra' | 'tell' | 'gruppo' | 'hp' | 'disconnesso';

export interface AlertChoice {
  suono: boolean;
  notifica: boolean;
}

export interface Settings {
  versione: 1;
  tema: Tema;
  /** Dimensione del testo dell'output, in pixel. */
  testo: number;
  /** Scala dell'interfaccia, in percento. */
  scala: number;
  /** Interruttore generale dei suoni. */
  suoni: boolean;
  /** Notifiche di sistema solo quando la finestra non è in primo piano. */
  notifiche: boolean;
  avvisi: Record<AlertKind, AlertChoice>;
  /** HP sotto questa percentuale del massimo: avviso "hp". */
  sogliaHp: number;
  /** Cartella del Reliquiario (identi.js); vuota = spento. */
  reliquiario: string;
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  furto: 'Furto (monete sparite di tasca)',
  terra: 'Finito a terra',
  tell: 'Messaggio privato ("ti dice")',
  gruppo: 'Messaggio al gruppo',
  hp: 'HP bassi',
  disconnesso: 'Collegamento perso',
};

export const TEMI: Record<Tema, string> = {
  scuro: 'Scuro',
  nero: 'Nero (contrasto alto)',
  chiaro: 'Chiaro',
};

export function defaultSettings(): Settings {
  return {
    versione: 1,
    tema: 'scuro',
    testo: 14,
    scala: 100,
    suoni: true,
    notifiche: true,
    avvisi: {
      furto: { suono: true, notifica: true },
      terra: { suono: true, notifica: false },
      tell: { suono: true, notifica: true },
      gruppo: { suono: false, notifica: false },
      hp: { suono: true, notifica: true },
      disconnesso: { suono: true, notifica: true },
    },
    sogliaHp: 30,
    reliquiario: '',
  };
}

const clamp = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;

/** Lettura tollerante: i valori mancanti o sbagliati prendono quelli predefiniti. */
export function parseSettings(json: string | null): Settings {
  const def = defaultSettings();
  if (!json) return def;
  let d: Partial<Settings>;
  try {
    d = JSON.parse(json) as Partial<Settings>;
  } catch {
    return def;
  }
  const avvisi = { ...def.avvisi };
  for (const k of Object.keys(avvisi) as AlertKind[]) {
    const a = d.avvisi?.[k];
    if (a && typeof a === 'object')
      avvisi[k] = {
        suono: typeof a.suono === 'boolean' ? a.suono : def.avvisi[k].suono,
        notifica: typeof a.notifica === 'boolean' ? a.notifica : def.avvisi[k].notifica,
      };
  }
  return {
    versione: 1,
    tema: d.tema && d.tema in TEMI ? d.tema : def.tema,
    testo: clamp(d.testo, 10, 28, def.testo),
    scala: clamp(d.scala, 70, 160, def.scala),
    suoni: typeof d.suoni === 'boolean' ? d.suoni : def.suoni,
    notifiche: typeof d.notifiche === 'boolean' ? d.notifiche : def.notifiche,
    avvisi,
    sogliaHp: clamp(d.sogliaHp, 5, 90, def.sogliaHp),
    reliquiario: typeof d.reliquiario === 'string' ? d.reliquiario.trim() : '',
  };
}

const STORAGE_NAME = 'impostazioni';

export async function loadSettings(): Promise<Settings> {
  try {
    return parseSettings(await readData(STORAGE_NAME));
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await writeData(STORAGE_NAME, JSON.stringify(s));
}
