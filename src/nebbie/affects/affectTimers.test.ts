import { describe, expect, it, vi } from 'vitest';
import { AffectTimers, formatRemaining, TICK_MS } from './affectTimers';

describe('timer degli incantesimi', () => {
  it('att: durata in tick dal momento della lettura (valori reali)', () => {
    const t = new AffectTimers({}, () => 1000);
    t.onAtt([
      { nome: 'detect invisibility', durata: 99 },
      { nome: 'armor', durata: 4 },
    ]);
    // Fase del tick sconosciuta: N+1 scatti, il primo in media a mezzo tick.
    expect(t.list).toEqual([
      { nome: 'armor', fine: 1000 + 4.5 * TICK_MS, fonte: 'att', avviso: false },
      { nome: 'detect invisibility', fine: 1000 + 99.5 * TICK_MS, fonte: 'att', avviso: false },
    ]);
  });

  it('att con la fase del tick nota: finisce al (N+1)-esimo scatto (stone skin reale)', () => {
    // Log reale: att stone skin = 2 letto a 862,1 s, scaduto a 1043,4 s (181,3 s dopo).
    // Con il primo scatto a +31,3 s la fine prevista è 31,3 + 2 x 75 = 181,3 s.
    const t = new AffectTimers({}, () => 862_100);
    t.onAtt([{ nome: 'stone skin', durata: 2 }], { prossimo: 893_400, periodo: 75_000 });
    expect(t.list[0].fine).toBe(1_043_400);
  });

  it('impara la durata da lancio e fine, poi la usa al lancio successivo', () => {
    let now = 0;
    const onLearn = vi.fn();
    const t = new AffectTimers({}, () => now, TICK_MS, onLearn);
    t.onCast('stone skin');
    expect(t.list).toEqual([]); // durata ancora sconosciuta
    now = 600_000;
    t.onEnd('stone skin', false);
    expect(onLearn).toHaveBeenCalledWith({ 'stone skin': 600_000 });
    now = 700_000;
    t.onCast('stone skin');
    expect(t.list).toEqual([
      { nome: 'stone skin', fine: 1_300_000, fonte: 'lancio', avviso: false },
    ]);
  });

  it("l'avviso segna il timer, la fine lo toglie", () => {
    const t = new AffectTimers({}, () => 0);
    t.onAtt([{ nome: 'armor', durata: 4 }]);
    t.onEnd('armor', true);
    expect(t.list[0].avviso).toBe(true);
    t.onEnd('armor', false);
    expect(t.list).toEqual([]);
  });

  it('non impara durate troppo brevi (lancio fallito o recast)', () => {
    let now = 0;
    const t = new AffectTimers({}, () => now);
    t.onCast('armor');
    now = 5_000;
    t.onEnd('armor', false);
    expect(t.durations).toEqual({});
  });

  it('pozione: la lettera che compare nel prompt avvia il timer con la durata imparata', () => {
    let now = 0;
    const t = new AffectTimers({ sanctuary: 300_000 }, () => now);
    now = 1_000;
    t.onFlagAppear('sanctuary');
    expect(t.list).toEqual([{ nome: 'sanctuary', fine: 301_000, fonte: 'prompt', avviso: false }]);
  });

  it('impara la durata dalla lettera che compare e poi sparisce sul tick', () => {
    let now = 0;
    const t = new AffectTimers({}, () => now);
    t.onFlagAppear('fireshield');
    now = 450_000;
    t.onEnd('fireshield', false, false, true);
    expect(t.durations).toEqual({ fireshield: 450_000 });
  });

  it('dispel (fine fuori tempo): toglie il timer ma non impara la durata', () => {
    let now = 0;
    const t = new AffectTimers({}, () => now);
    t.onAtt([{ nome: 'stone skin', durata: 10 }]);
    t.onCast('stone skin');
    now = 100_000;
    t.onEnd('stone skin', false, false, false);
    expect(t.list).toEqual([]);
    expect(t.durations).toEqual({});
  });

  it('lettera comparsa con un timer già attivo (da att): il timer resta', () => {
    const t = new AffectTimers({ sanctuary: 1 }, () => 0);
    t.onAtt([{ nome: 'sanctuary', durata: 3 }]);
    t.onFlagAppear('sanctuary');
    expect(t.list[0].fonte).toBe('att');
  });

  it('tempo residuo leggibile', () => {
    expect(formatRemaining(266_000)).toBe('4:26');
    expect(formatRemaining(500)).toBe('0:01');
    expect(formatRemaining(0)).toBe('a breve');
  });

  it('durata in scatti del tick: anti magic shell finisce sempre al 2° tick (log reale)', () => {
    // Log del 2026-11-18: lanci a 118,0 / 225,0 / 365,8 s, fini a 209,3 / 359,3 / 509,3 s,
    // tick ogni 75 s con uno scatto a 209,3 s. In secondi: 91, 134, 143,5 s.
    let now = 118_028;
    const tickAt = (t: number) => {
      const k = Math.ceil((t - 209_293) / 75_000);
      return { prossimo: 209_293 + k * 75_000, periodo: 75_000 };
    };
    const onLearn = vi.fn();
    const t = new AffectTimers({}, () => now, TICK_MS, onLearn);
    t.tickInfo = () => tickAt(now);
    t.onCast('anti magic shell');
    now = 209_293;
    t.onEnd('anti magic shell', false);
    expect(onLearn).toHaveBeenLastCalledWith({
      'anti magic shell': 91_265,
      'anti magic shell#tick': 2,
    });
    now = 225_021;
    t.onCast('anti magic shell');
    expect(t.list[0].fine).toBe(359_293); // non 225 + 91 = 316 s
    now = 365_768;
    t.onCast('anti magic shell');
    expect(t.list[0].fine).toBe(509_293);
    // tick sconosciuto: a metà del primo tick
    t.tickInfo = () => undefined;
    t.onCast('anti magic shell');
    expect(t.list[0].fine).toBe(365_768 + 1.5 * TICK_MS);
  });
});
