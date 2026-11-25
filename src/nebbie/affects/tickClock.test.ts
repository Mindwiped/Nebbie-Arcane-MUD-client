import { describe, expect, it } from 'vitest';
import { msToNextTick, TickClock } from './tickClock';

describe('orologio del tick', () => {
  it('nessun tick visto: niente conto alla rovescia', () => {
    expect(msToNextTick(new TickClock(() => 0).snapshot, 1000)).toBeUndefined();
  });

  it('conto alla rovescia dall ultima scadenza, anche dopo più tick', () => {
    let now = 10_000;
    const c = new TickClock(() => now);
    c.onTick();
    expect(msToNextTick(c.snapshot, 10_000 + 34_000)).toBe(41_000);
    expect(msToNextTick(c.snapshot, 10_000 + 75_000 + 1_000)).toBe(74_000);
    now += 1;
    expect(c.snapshot.ultimo).toBe(10_000);
  });

  it('affina la durata con le scadenze reali (374,9 s = 5 tick, 150,0 s = 2 tick)', () => {
    let now = 0;
    const c = new TickClock(() => now);
    c.onTick();
    now = 374_900;
    c.onTick();
    now += 150_000;
    c.onTick();
    const s = c.snapshot;
    expect(s.misure).toBe(2);
    expect(s.periodo).toBeGreaterThan(74_900);
    expect(s.periodo).toBeLessThan(75_000);
  });

  it('più scadenze nello stesso tick contano una volta', () => {
    let now = 0;
    const c = new TickClock(() => now);
    c.onTick();
    now = 1_500;
    c.onTick();
    expect(c.snapshot).toMatchObject({ ultimo: 0, misure: 0 });
  });

  it('misure assurde (troppo lontane o fuori scala) ignorate', () => {
    let now = 0;
    const c = new TickClock(() => now);
    c.onTick();
    now = 60 * 75_000; // 60 tick: troppo incerto
    c.onTick();
    expect(c.snapshot.misure).toBe(0);
    expect(c.snapshot.ultimo).toBe(now);
  });
});

describe('orologio del tick: dispel', () => {
  /** Orologio con fase stabile: tick a 0, 75 s, 150 s. */
  function stableClock() {
    let now = 0;
    const c = new TickClock(() => now);
    const at = (t: number) => {
      now = t;
      return c.onTick();
    };
    at(0);
    at(75_000);
    at(150_000);
    return { c, at };
  }

  it('una fine fuori tempo (dispel) viene scartata e la fase non cambia', () => {
    const { c, at } = stableClock();
    expect(c.stable).toBe(true);
    expect(at(150_000 + 31_000)).toBe(false);
    expect(c.snapshot.ultimo).toBe(150_000);
    // la prossima scadenza naturale è accettata
    expect(at(300_000 + 1_000)).toBe(true);
  });

  it('due segnali fuori fase ma coerenti tra loro riallineano la fase', () => {
    const { c, at } = stableClock();
    expect(at(150_000 + 30_000)).toBe(false);
    expect(at(150_000 + 30_000 + 75_000)).toBe(true);
    expect(c.snapshot.ultimo).toBe(255_000);
  });

  it('finché la fase non è stabile ogni segnale viene accettato', () => {
    let now = 0;
    const c = new TickClock(() => now);
    c.onTick();
    now = 31_000;
    expect(c.onTick()).toBe(true);
  });
});

describe('orologio del tick: tick stimato in un istante passato', () => {
  it('onTick(at) usa l istante indicato', () => {
    const c = new TickClock(() => 900_000);
    c.onTick(882_350, false);
    expect(c.snapshot.ultimo).toBe(882_350);
  });

  it('una stima tra due att non cambia la durata e cede alla prima scadenza vera', () => {
    let now = 0;
    const c = new TickClock(() => now);
    c.onTick(10_000, false);
    now = 100_000;
    c.onTick(); // scadenza vera: sostituisce la stima, nessuna misura della durata
    expect(c.snapshot).toMatchObject({ ultimo: 100_000, misure: 0, periodo: 75_000 });
    c.onTick(130_000, false); // stima successiva: ignorata, c'è già una fase precisa
    expect(c.snapshot.ultimo).toBe(100_000);
  });
});
