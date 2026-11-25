import table from './flagPrompt.json';

/** Lettera del prompt → incantesimo (dato modificabile in `flagPrompt.json`). */
export const DEFAULT_FLAGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(table).filter(([k]) => !k.startsWith('_')),
);

export interface AffectFlag {
  /** Lettera maiuscola (es. `F`), uguale per attivo e in scadenza. */
  lettera: string;
  /** Nome dell'incantesimo, se la lettera è conosciuta. */
  incantesimo?: string;
  /** Lettera minuscola nel prompt: l'effetto sta per finire. */
  inScadenza: boolean;
}

/**
 * Legge le lettere tra parentesi quadre del prompt (`[FsTM]`): maiuscola = attivo,
 * minuscola = in scadenza.
 */
export function parseAffectFlags(
  affetti: string,
  flags: Readonly<Record<string, string>> = DEFAULT_FLAGS,
): AffectFlag[] {
  const out: AffectFlag[] = [];
  for (const ch of affetti) {
    if (!/\p{L}/u.test(ch)) continue;
    const lettera = ch.toUpperCase();
    const flag: AffectFlag = { lettera, inScadenza: ch !== lettera };
    if (Object.hasOwn(flags, lettera)) flag.incantesimo = flags[lettera];
    out.push(flag);
  }
  return out;
}
