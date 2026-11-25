import { describe, expect, it } from 'vitest';
import { TheftAlarm } from './theftAlarm';

describe('allarme furto', () => {
  it("l'oro cala senza comandi recenti: allarme", () => {
    let now = 0;
    const a = new TheftAlarm(() => now);
    expect(a.onGold(50_000)).toBeNull();
    now = 60_000;
    expect(a.onGold(20_000)).toEqual({ da: 50_000, a: 20_000, mancano: 30_000 });
  });

  it('dopo un comando (comprare, dare…) nessun allarme', () => {
    let now = 0;
    const a = new TheftAlarm(() => now);
    a.onGold(1000);
    now = 10_000;
    a.onCommand();
    now = 11_000;
    expect(a.onGold(500)).toBeNull();
  });

  it("l'oro che sale o resta uguale non fa scattare nulla", () => {
    const a = new TheftAlarm(() => 100_000);
    a.onGold(100);
    expect(a.onGold(100)).toBeNull();
    expect(a.onGold(300)).toBeNull();
  });
});
