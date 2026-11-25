import type { Outcome, Step, StepJudge } from '../../core/sequence/executor';

/** Passo che riesce solo se arriva una certa lista (`eq` → equipmentList…). */
export function listStep(cmd: string, event: string): Step {
  return {
    cmd,
    judge: (): StepJudge => {
      let seen = false;
      let first = '';
      return {
        on(ev, data) {
          if (ev === event) seen = true;
          if (ev === 'line' && !first && typeof data === 'string' && data.trim())
            first = data.trim();
        },
        prompt: (): Outcome =>
          seen ? { ok: true } : { ok: false, motivo: first || "la lista non e' arrivata" },
      };
    },
  };
}

/** Passo che fallisce se la prima riga della risposta contiene uno degli errori. */
export function checkedStep(
  cmd: string,
  errori: string[],
  opts: { alt?: string; salta?: boolean } = {},
): Step {
  return {
    cmd,
    ...(opts.alt ? { alt: opts.alt } : {}),
    ...(opts.salta ? { seFallisce: 'salta' as const } : {}),
    judge: (): StepJudge => {
      let first = '';
      return {
        on(ev, data) {
          if (ev === 'line' && !first && typeof data === 'string' && data.trim())
            first = data.trim();
        },
        prompt(): Outcome {
          const low = first.toLowerCase();
          return errori.some((e) => low.includes(e)) ? { ok: false, motivo: first } : { ok: true };
        },
      };
    },
  };
}
