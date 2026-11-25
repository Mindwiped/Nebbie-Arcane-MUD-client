import type { PromptData } from './events';

export type VitalKey = 'hp' | 'mp' | 'mv';

export interface Vital {
  value?: number;
  /** Massimo usato per la barra. */
  max?: number;
  /** Da dove viene il massimo: prompt, `score`, profilo o il valore più alto visto. */
  maxSource?: 'prompt' | 'score' | 'profilo' | 'stimato';
}

export type Vitals = Record<VitalKey, Vital>;

export function emptyVitals(): Vitals {
  return { hp: {}, mp: {}, mv: {} };
}

/**
 * Aggiorna HP/MP/MV da un prompt. Il massimo viene, in ordine: dal prompt, dall'ultimo
 * `score`, dal profilo, altrimenti dal valore più alto visto finora (stimato, segnalato
 * nell'interfaccia).
 */
export function updateVitals(
  prev: Vitals,
  prompt: Partial<PromptData>,
  profileMax: Partial<Record<VitalKey, number>>,
  scoreMax: Partial<Record<VitalKey, number>> = {},
): Vitals {
  const next = emptyVitals();
  for (const key of ['hp', 'mp', 'mv'] as const) {
    const value = prompt[key] ?? prev[key].value;
    const fromPrompt = prompt[`${key}Max` as const];
    const fromScore = scoreMax[key];
    const fromProfile = profileMax[key];
    if (fromPrompt !== undefined) {
      next[key] = { value, max: fromPrompt, maxSource: 'prompt' };
    } else if (fromScore !== undefined) {
      next[key] = { value, max: fromScore, maxSource: 'score' };
    } else if (fromProfile !== undefined) {
      next[key] = { value, max: fromProfile, maxSource: 'profilo' };
    } else {
      const seen = prev[key].maxSource === 'stimato' ? (prev[key].max ?? 0) : 0;
      const max = value !== undefined ? Math.max(seen, value) : seen || undefined;
      next[key] = { value, max, maxSource: max !== undefined ? 'stimato' : undefined };
    }
  }
  return next;
}

/** Percentuale 0-100 per la barra (limitata: i valori possono superare il massimo). */
export function percent(v: Vital): number {
  if (v.value === undefined || !v.max) return 0;
  return Math.max(0, Math.min(100, (v.value / v.max) * 100));
}
