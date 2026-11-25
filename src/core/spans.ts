import type { Span } from './types';

export function spansText(spans: readonly Span[]): string {
  let s = '';
  for (const span of spans) s += span.text;
  return s;
}

/** Ritaglia gli span tra due posizioni del testo (in unità UTF-16, come `String.slice`). */
export function sliceSpans(spans: readonly Span[], start: number, end = Infinity): Span[] {
  const out: Span[] = [];
  let pos = 0;
  for (const span of spans) {
    const from = pos;
    const to = pos + span.text.length;
    pos = to;
    if (to <= start || from >= end) continue;
    const a = Math.max(start, from) - from;
    const b = Math.min(end, to) - from;
    out.push({ ...span, text: span.text.slice(a, b) });
  }
  return out;
}

export function concatSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  return [...a, ...b];
}

export function plainSpans(text: string): Span[] {
  return text ? [{ text }] : [];
}
