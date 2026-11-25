import type { Outcome, StepJudge } from '../../core/sequence/executor';
import type { NebbieEvents } from '../parser/types';

/** Nome di direzione (breve, inglese o italiano) → direzione breve. */
const DIRS: Record<string, string> = {
  n: 'n',
  s: 's',
  e: 'e',
  w: 'w',
  u: 'u',
  d: 'd',
  ne: 'ne',
  nw: 'nw',
  se: 'se',
  sw: 'sw',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  up: 'u',
  down: 'd',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  nord: 'n',
  sud: 's',
  est: 'e',
  ovest: 'w',
  alto: 'u',
  basso: 'd',
};

const OPPOSITE: Record<string, string> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  u: 'd',
  d: 'u',
  ne: 'sw',
  sw: 'ne',
  nw: 'se',
  se: 'nw',
};

/** `nord` → `n`; undefined se non è una direzione. */
export function dirOf(cmd: string): string | undefined {
  return DIRS[cmd.trim().toLowerCase()];
}

/** `run e` → `e`. */
export function runDir(cmd: string): string | undefined {
  const m = /^run\s+(\S+)$/i.exec(cmd.trim());
  return m ? dirOf(m[1]) : undefined;
}

/** Comando che deve portare in un'altra stanza: una direzione o un `run`. */
export function isMove(cmd: string): boolean {
  return dirOf(cmd) !== undefined || runDir(cmd) !== undefined;
}

export function opposite(dir: string): string | undefined {
  return OPPOSITE[dir];
}

/** Comandi che mostrano la stanza senza spostarsi o che spostano a caso: mai nei percorsi. */
export function isNeverStep(cmd: string): boolean {
  const first = cmd.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return ['look', 'l', 'lo', 'loo', 'guarda', 'flee', 'fuggi', 'scan', 'exits', 'uscite'].includes(
    first,
  );
}

/**
 * Giudice di un passo di percorso.
 * - Un movimento riesce se arriva una stanza nuova; un muro o una porta chiusa lo fanno
 *   fallire (con `porte` si prova una volta `open <dir>`). La fine di un `run` non è un errore.
 * - Gli altri comandi (`open frasca`, `enter portale`…) riescono al prompt.
 */
export function pathJudge(cmd: string, opts: { porte?: boolean } = {}): () => StepJudge {
  return () => {
    let moved = false;
    let failed: NebbieEvents['moveFailed'] | undefined;
    const move = isMove(cmd);
    return {
      on(event, data) {
        if (event === 'room' && !(data as NebbieEvents['room']).guardata) moved = true;
        if (event === 'moveFailed') {
          const f = data as NebbieEvents['moveFailed'];
          if (f.motivo !== 'fineRun') failed = f;
        }
      },
      prompt(): Outcome {
        // Un run che si ferma contro una porta dopo qualche stanza è comunque andato avanti.
        if (failed && !(runDir(cmd) && moved)) {
          const dir = dirOf(cmd);
          if (failed.motivo === 'porta' && opts.porte && dir)
            return { ok: false, motivo: failed.testo, prima: [`open ${dir}`] };
          return { ok: false, motivo: failed.testo };
        }
        if (move && !moved) return { ok: false, motivo: 'nessuna stanza nuova' };
        return { ok: true };
      },
    };
  };
}
