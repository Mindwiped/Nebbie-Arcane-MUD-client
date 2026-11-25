import type { Span } from './types';

export type LineKind = 'mud' | 'prompt' | 'echo' | 'system' | 'error' | 'alarm';

export interface OutLine {
  id: number;
  kind: LineKind;
  spans: Span[];
  /** Comando inviato mostrato in coda al prompt (come in Mudlet). */
  echo?: string;
  /** Colore imposto da un trigger dell'utente (CSS). */
  colore?: string;
  /** Sfondo di un evento: rosso = finito a terra, verde = di nuovo in piedi. */
  sfondo?: 'rosso' | 'verde';
  /** Lunghezza del testo visibile (per l'impaginazione dell'output virtualizzato). */
  length: number;
}

/**
 * Righe dell'output principale. Tiene al massimo `max` righe: le più vecchie si perdono
 * (restano nel log di sessione su disco).
 */
export class OutputBuffer {
  lines: OutLine[] = [];
  /** Righe tolte dall'inizio da quando esiste il buffer (serve all'output per restare fermo). */
  dropped = 0;
  private nextId = 1;
  private listeners = new Set<() => void>();

  constructor(private readonly max = 50_000) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  push(kind: LineKind, spans: Span[], echo?: string): OutLine {
    const line: OutLine = { id: this.nextId++, kind, spans, echo, length: 0 };
    line.length = measure(line);
    this.lines.push(line);
    if (this.lines.length > this.max) {
      const n = this.lines.length - this.max;
      this.lines.splice(0, n);
      this.dropped += n;
    }
    this.changed();
    return line;
  }

  get last(): OutLine | undefined {
    return this.lines[this.lines.length - 1];
  }

  /** Toglie l'ultima riga (serve a riunire una riga parziale con il suo seguito). */
  popLast(): OutLine | undefined {
    const line = this.lines.pop();
    if (line) this.changed();
    return line;
  }

  /**
   * Mostra un comando inviato: in coda a `attachTo` (di solito il prompt) se è ancora
   * l'ultima riga e non ha già un'eco, altrimenti su una riga propria.
   */
  echo(text: string, attachTo?: OutLine): OutLine {
    const target = attachTo;
    if (target && target === this.last && target.echo === undefined) {
      target.echo = text;
      target.length = measure(target);
      this.changed();
      return target;
    }
    return this.push('echo', [], text);
  }

  /** Sfondo di un evento (caduta, di nuovo in piedi). */
  setBackground(line: OutLine, sfondo: OutLine['sfondo']): void {
    line.sfondo = sfondo;
    this.changed();
  }

  /** Colora una riga (trigger dell'utente). */
  recolor(line: OutLine, colore: string): void {
    line.colore = colore;
    this.changed();
  }

  /** Toglie una riga dall'output (trigger "nascondi"); resta nel log di sessione. */
  remove(line: OutLine): void {
    const i = this.lines.lastIndexOf(line);
    if (i < 0) return;
    this.lines.splice(i, 1);
    this.changed();
  }

  clear(): void {
    this.dropped += this.lines.length;
    this.lines = [];
    this.changed();
  }
}

function measure(line: OutLine): number {
  let n = 0;
  for (const s of line.spans) n += s.text.length;
  if (line.echo !== undefined) n += line.echo.length + 1;
  return n;
}
