import { describe, expect, it } from 'vitest';
import { TRUECOLOR } from '../core/types';
import { BASE16, cssColor, spanStyle } from './ansiColors';

/** I 16 colori base vengono dalle variabili del tema (--ansi-N), con il colore scuro di riserva. */
const base = (i: number) => `var(--ansi-${i}, ${BASE16[i]})`;

describe('colori ANSI', () => {
  it('indici base, cubo xterm, grigi e truecolor', () => {
    expect(cssColor(1)).toBe(base(1));
    expect(cssColor(196)).toBe('#ff0000');
    expect(cssColor(232)).toBe('#080808');
    expect(cssColor(TRUECOLOR | 0x102030)).toBe('#102030');
  });

  it('grassetto su colore base usa la variante chiara', () => {
    expect(spanStyle({ text: 'x', fg: 1, bold: true })).toContain(`color:${base(9)}`);
  });

  it('inverso scambia i colori', () => {
    expect(spanStyle({ text: 'x', fg: 2, inverse: true })).toBe(
      `color:var(--bg);background:${base(2)};`,
    );
  });

  it('lo sfondo nero ANSI resta il fondo della finestra (come lo manda Nebbie)', () => {
    expect(spanStyle({ text: 'x', fg: 7, bg: 0 })).toBe(`color:${base(7)};`);
    expect(spanStyle({ text: 'x', bg: 4 })).toBe(`background:${base(4)};`);
  });

  it('span senza stile', () => {
    expect(spanStyle({ text: 'x' })).toBe('');
  });
});
