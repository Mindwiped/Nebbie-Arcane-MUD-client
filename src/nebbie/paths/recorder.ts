import type { NebbieEvents } from '../parser/types';
import { isNeverStep, runDir } from './moves';

/**
 * Registratore dei percorsi (`rec`, SPECIFICA 5.2). Guarda i comandi mandati e tiene solo
 * quelli che hanno davvero portato in un'altra stanza, più le porte aperte con successo
 * (`open`/`unlock`), che dalle sole direzioni non si ricostruiscono.
 *
 * Ogni comando aspetta il suo prompt: le stanze e gli errori che arrivano prima del prompt
 * sono la sua risposta (i comandi scritti di fila si mettono in coda, in ordine).
 */
export interface RecordingState {
  passi: string[];
  partenza?: string;
  pausa: boolean;
  /** Cose da controllare prima di salvare (es. spostamenti senza comando). */
  avvisi: string[];
}

interface Pending {
  cmd: string;
  moved: boolean;
  failed: boolean;
  opened: boolean;
  unlockOk: boolean;
}

const DOOR_OPEN = /^(open|apri)\s+/i;
const DOOR_UNLOCK = /^(unlock|sblocca)\s+/i;

export class PathRecorder {
  private steps: string[] = [];
  private queue: Pending[] = [];
  private paused = false;
  private warnings: string[] = [];
  private start: string | undefined;

  constructor(partenza?: string) {
    this.start = partenza;
  }

  get state(): RecordingState {
    return {
      passi: [...this.steps],
      ...(this.start ? { partenza: this.start } : {}),
      pausa: this.paused,
      avvisi: [...this.warnings],
    };
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.queue = [];
  }

  /** Toglie l'ultimo passo; restituisce quello tolto. */
  undo(): string | undefined {
    return this.steps.pop();
  }

  command(cmd: string): void {
    if (this.paused || isNeverStep(cmd)) return;
    this.queue.push({
      cmd: cmd.trim(),
      moved: false,
      failed: false,
      opened: false,
      unlockOk: false,
    });
  }

  room(room: NebbieEvents['room']): void {
    if (this.paused || room.guardata) return;
    const head = this.queue[0];
    if (head) head.moved = true;
    else
      this.warn(
        `arrivato in "${room.titolo}" senza un comando (un mezzo di trasporto?): ` +
          'il passo va aggiunto a mano.',
      );
  }

  moveFailed(f: NebbieEvents['moveFailed']): void {
    if (f.motivo !== 'fineRun' && this.queue[0]) this.queue[0].failed = true;
  }

  door(d: NebbieEvents['door']): void {
    if (d.azione === 'aperta' && !d.chi && this.queue[0]) this.queue[0].opened = true;
  }

  /** Riga del MUD: serve solo per capire se un `unlock` è riuscito. */
  line(text: string): void {
    const head = this.queue[0];
    if (head && DOOR_UNLOCK.test(head.cmd) && /(click|sblocc|unlock)/i.test(text))
      head.unlockOk = true;
  }

  /** Il prompt chiude il comando più vecchio in attesa. */
  prompt(): void {
    const p = this.queue.shift();
    if (!p || this.paused) return;
    const runOk = runDir(p.cmd) !== undefined && p.moved; // un run fermato da una porta vale
    if ((p.moved && !p.failed) || runOk) this.steps.push(p.cmd);
    else if (DOOR_OPEN.test(p.cmd) && p.opened) this.steps.push(p.cmd);
    else if (DOOR_UNLOCK.test(p.cmd) && p.unlockOk) this.steps.push(p.cmd);
  }

  private warn(text: string): void {
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }
}
