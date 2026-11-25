import { Channel, invoke } from '@tauri-apps/api/core';
import type { Encoding, ServerEvent } from './types';

/** Funzioni del backend usate dalla sessione (sostituibili nei test). */
export interface Backend {
  connect(params: ConnectParams, onEvent: (ev: ServerEvent) => void): Promise<void>;
  /** `log: false` = il testo non finisce nel log di sessione (es. nome utente). */
  send(text: string, log?: boolean): Promise<void>;
  /** Manda la password presa dal portachiavi (il frontend non la vede mai). */
  sendPassword(host: string, user: string): Promise<void>;
  disconnect(): Promise<void>;
  startReplay(path: string, speed: number, onEvent: (ev: ServerEvent) => void): Promise<void>;
  stopReplay(): Promise<void>;
}

export interface ConnectParams {
  host: string;
  port: number;
  encoding: Encoding;
  profile: string;
  log: boolean;
}

function channel(onEvent: (ev: ServerEvent) => void): Channel<ServerEvent> {
  const ch = new Channel<ServerEvent>();
  ch.onmessage = onEvent;
  return ch;
}

export const tauriBackend: Backend = {
  connect: (p, onEvent) =>
    invoke('connetti', {
      host: p.host,
      porta: p.port,
      codifica: p.encoding,
      profilo: p.profile,
      registra: p.log,
      canale: channel(onEvent),
    }),
  send: (testo, log = true) => invoke('invia', { testo, registra: log }),
  sendPassword: (host, utente) => invoke('invia_password', { host, utente }),
  disconnect: () => invoke('disconnetti'),
  startReplay: (percorso, velocita, onEvent) =>
    invoke('avvia_replay', { percorso, velocita, canale: channel(onEvent) }),
  stopReplay: () => invoke('ferma_replay'),
};

export const readData = (nome: string) => invoke<string | null>('leggi_dati', { nome });
export const writeData = (nome: string, contenuto: string) =>
  invoke<void>('scrivi_dati', { nome, contenuto });
/** Reliquiario: identi.js nella cartella scelta dall'utente. */
export const readRelics = (cartella: string) =>
  invoke<string | null>('leggi_reliquiario', { cartella });
export const writeRelics = (cartella: string, contenuto: string) =>
  invoke<void>('scrivi_reliquiario', { cartella, contenuto });
/** Database dei mob (`mob.js`) nella cartella del Reliquiario. */
export const readMobs = (cartella: string) =>
  invoke<string | null>('leggi_bestiario', { cartella });
/** Password dell'account nel portachiavi del sistema. */
export const savePassword = (host: string, utente: string, password: string) =>
  invoke<void>('salva_password', { host, utente, password });
export const deletePassword = (host: string, utente: string) =>
  invoke<void>('elimina_password', { host, utente });
export const hasPassword = (host: string, utente: string) =>
  invoke<boolean>('password_salvata', { host, utente });

export const logsFolder = () => invoke<string>('cartella_log');
export const startupArgs = () =>
  invoke<{ percorso: string; velocita: number } | null>('argomenti_avvio');

/** Messaggio leggibile da un errore di `invoke` (il backend restituisce stringhe). */
export function errorMessage(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}
