import { describe, expect, it } from 'vitest';
import { sliceSpans, spansText } from './spans';

const spans = [{ text: 'Uscite: ' }, { text: 'Nord', fg: 2 }, { text: ' Est', bold: true }];

describe('spans', () => {
  it('testo completo', () => {
    expect(spansText(spans)).toBe('Uscite: Nord Est');
  });

  it('ritaglio che attraversa più span mantiene gli stili', () => {
    expect(sliceSpans(spans, 6, 14)).toEqual([
      { text: ': ' },
      { text: 'Nord', fg: 2 },
      { text: ' E', bold: true },
    ]);
  });

  it('ritaglio fino alla fine', () => {
    expect(spansText(sliceSpans(spans, 12))).toBe(' Est');
  });
});
