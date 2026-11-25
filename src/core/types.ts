/**
 * Tipi condivisi con il backend Rust (vedi src-tauri/src/pipeline.rs e ansi.rs).
 * Colori: 0-255 indice di tavolozza; TRUECOLOR | 0xRRGGBB colore a 24 bit.
 */
export const TRUECOLOR = 0x1000000;

export interface Span {
  text: string;
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface WireLine {
  spans: Span[];
  partial: boolean;
}

export type ConnState = 'connecting' | 'connected' | 'disconnected' | 'replay' | 'replayEnded';

export type ServerEvent =
  | { type: 'lines'; lines: WireLine[] }
  | { type: 'serverEcho'; on: boolean }
  | { type: 'status'; state: ConnState; message: string }
  | { type: 'echo'; text: string }
  | { type: 'error'; message: string };

export type Encoding = 'utf8' | 'latin1';
