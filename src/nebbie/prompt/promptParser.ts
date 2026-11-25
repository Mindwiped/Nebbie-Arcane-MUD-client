import type { PromptData } from '../../core/events';
import { sliceSpans, spansText } from '../../core/spans';
import type { Span } from '../../core/types';

/**
 * Regex predefinita per il prompt di Nebbie:
 * `<Nome> H481 M493 V247 X-28602993 G29.640.568 [STM] eccellente/graffiato`
 * (massimi `H481/500`, oro `G…` e `>>` finale facoltativi). Tra parentesi quadre le iniziali
 * degli incantesimi attivi, poi la condizione di tank e bersaglio (`*` = nessuno). Non contiene nessun nome di
 * personaggio: il nome viene catturato nel gruppo `nome`. Ogni profilo può sostituirla.
 */
export const DEFAULT_PROMPT_REGEX = String.raw`(?<nome>[\p{L}]+) H(?<hp>-?\d+)(?:\/(?<hpMax>\d+))? M(?<mp>-?\d+)(?:\/(?<mpMax>\d+))? V(?<mv>-?\d+)(?:\/(?<mvMax>\d+))? X(?<xp>-?[\d.]+)(?: G(?<oro>[\d.]+))?(?: \[(?<affetti>[^\]\n]*)\])?(?: (?<tank>[^\s/>]+)\/(?<target>[^\s/>]+))?(?:[^\n>]*>>)?`;

/** Regex predefinite delle versioni precedenti: i profili che le usano vengono aggiornati. */
export const OLD_DEFAULT_PROMPT_REGEXES = [
  String.raw`(?<nome>[\p{L}]+) H(?<hp>-?\d+)(?:\/(?<hpMax>\d+))? M(?<mp>-?\d+)(?:\/(?<mpMax>\d+))? V(?<mv>-?\d+)(?:\/(?<mvMax>\d+))? X(?<xp>-?[\d.]+)(?: \[(?<affetti>[^\]\n]*)\])?(?: (?<tank>[^\s/>]+)\/(?<target>[^\s>]+))?[^\n>]*>>`,
  String.raw`(?<nome>[\p{L}]+) H(?<hp>-?\d+)(?:\/(?<hpMax>\d+))? M(?<mp>-?\d+)(?:\/(?<mpMax>\d+))? V(?<mv>-?\d+)(?:\/(?<mvMax>\d+))? X(?<xp>-?[\d.]+)[^\n>]*>>`,
];

const NUMERIC_FIELDS = ['hp', 'hpMax', 'mp', 'mpMax', 'mv', 'mvMax', 'xp', 'oro', 'banca'] as const;

/** Compila la regex di un profilo. Lancia un errore in italiano se non è valida. */
export function compilePromptRegex(source: string): RegExp {
  if (!source.trim()) throw new Error('La regex del prompt è vuota.');
  let re: RegExp;
  try {
    re = new RegExp(source, 'u');
  } catch (e) {
    throw new Error(`Regex del prompt non valida: ${(e as Error).message}`, { cause: e });
  }
  if (re.test('')) throw new Error('La regex del prompt riconosce anche il testo vuoto.');
  return re;
}

/** Numeri del MUD: possono avere i punti delle migliaia (`24.775.191`). */
export function parseMudNumber(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s.replace(/\./g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export interface PromptMatch {
  start: number;
  end: number;
  data: PromptData;
}

export function findPrompt(text: string, re: RegExp): PromptMatch | null {
  const m = re.exec(text);
  if (!m || m[0].length === 0) return null;
  const groups = m.groups ?? {};
  const data: PromptData = { raw: m[0] };
  if (groups.nome) data.nome = groups.nome;
  if (groups.affetti !== undefined) data.affetti = groups.affetti;
  // `*` nel prompt significa "nessuno".
  if (groups.tank && groups.tank !== '*') data.tank = groups.tank;
  if (groups.target && groups.target !== '*') data.target = groups.target;
  for (const field of NUMERIC_FIELDS) {
    const v = parseMudNumber(groups[field]);
    if (v !== undefined) data[field] = v;
  }
  return { start: m.index, end: m.index + m[0].length, data };
}

export type LinePart =
  | { kind: 'text'; spans: Span[]; text: string }
  | { kind: 'prompt'; spans: Span[]; text: string; data: PromptData };

/**
 * Divide una riga in prompt e testo. Gestisce il testo attaccato dopo il prompt
 * (`…>> Stai trasportando:`) e più prompt sulla stessa riga. Una riga vuota resta
 * una riga di testo vuota.
 */
export function splitPrompts(spans: Span[], re: RegExp): LinePart[] {
  const parts: LinePart[] = [];
  let rest = spans;
  let text = spansText(rest);
  for (;;) {
    const m = findPrompt(text, re);
    if (!m) {
      if (text.length > 0 || parts.length === 0) parts.push({ kind: 'text', spans: rest, text });
      break;
    }
    const before = text.slice(0, m.start);
    if (before.trim()) {
      parts.push({ kind: 'text', spans: sliceSpans(rest, 0, m.start), text: before });
    }
    parts.push({
      kind: 'prompt',
      spans: sliceSpans(rest, m.start, m.end),
      text: text.slice(m.start, m.end),
      data: m.data,
    });
    // Lo spazio subito dopo il prompt appartiene al prompt, non al testo attaccato.
    let cut = m.end;
    if (text[cut] === ' ') cut++;
    rest = sliceSpans(rest, cut);
    text = text.slice(cut);
    if (!text) break;
  }
  return parts;
}
