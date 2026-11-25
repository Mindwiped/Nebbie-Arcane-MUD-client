import { describe, expect, it, vi } from 'vitest';
import { OutputBuffer } from './outputBuffer';

describe('OutputBuffer', () => {
  it('aggiunge righe e avvisa gli ascoltatori', () => {
    const b = new OutputBuffer();
    const fn = vi.fn();
    b.onChange(fn);
    b.push('mud', [{ text: 'ciao' }]);
    expect(b.lines).toHaveLength(1);
    expect(b.last?.length).toBe(4);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('eco in coda al prompt, poi su riga propria', () => {
    const b = new OutputBuffer();
    const prompt = b.push('prompt', [{ text: 'Pg>>' }]);
    b.echo('nord', prompt);
    expect(b.last?.echo).toBe('nord');
    expect(b.last?.length).toBe(9);
    b.echo('sud', prompt);
    expect(b.lines).toHaveLength(2);
    expect(b.last?.kind).toBe('echo');
  });

  it('limite di righe', () => {
    const b = new OutputBuffer(3);
    for (let i = 0; i < 5; i++) b.push('mud', [{ text: String(i) }]);
    expect(b.lines.map((l) => l.spans[0].text)).toEqual(['2', '3', '4']);
    expect(b.dropped).toBe(2);
  });
});
