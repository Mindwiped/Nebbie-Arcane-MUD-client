import { describe, expect, it } from 'vitest';
import { formatDuration, formatNumber, SessionStats, xpPerHour } from './sessionStats';

describe('statistiche di sessione', () => {
  it('esperienza dalla X del prompt (valori reali: X scende quando l esperienza sale)', () => {
    const s = new SessionStats(() => 0);
    s.onPromptX(-132_811_939);
    s.onPromptX(-132_817_037); // +5.098 (chain lightning)
    s.onXpMessage(10_200); // ignorato: c'è già la X del prompt
    s.onPromptX(-132_817_037);
    expect(s.snapshot.xp).toBe(5_098);
  });

  it('senza X nel prompt usa i messaggi del MUD', () => {
    const s = new SessionStats(() => 0);
    s.onXpMessage(225_000);
    s.onXpMessage(10_200);
    expect(s.snapshot.xp).toBe(235_200);
  });

  it('esperienza persa separata', () => {
    const s = new SessionStats(() => 0);
    s.onPromptX(-100);
    s.onPromptX(50);
    expect(s.snapshot).toMatchObject({ xp: 0, xpPersa: 150 });
  });

  it('uccisioni con ripetizioni, per mob, e monete', () => {
    const s = new SessionStats(() => 0);
    s.onKill('una guardia scelta', 6);
    s.onKill('la Ronda', 1);
    s.onKill('una guardia scelta', 1);
    s.onGold(100_000);
    expect(s.snapshot).toMatchObject({
      uccisi: 8,
      monete: 100_000,
      perMob: { 'una guardia scelta': 7, 'la Ronda': 1 },
    });
  });

  it('reset azzera i contatori ma continua a contare dalla X attuale', () => {
    let now = 0;
    const s = new SessionStats(() => now);
    s.onPromptX(-10);
    s.onPromptX(-20);
    now = 5000;
    s.reset();
    expect(s.snapshot).toMatchObject({ inizio: 5000, xp: 0 });
    s.onPromptX(-25);
    expect(s.snapshot.xp).toBe(5);
  });

  it('oro in tasca dal prompt e variazione dall inizio (anche dopo il reset)', () => {
    const s = new SessionStats(() => 0);
    s.onPromptGold(29_640_568);
    s.onPromptGold(29_740_568);
    expect(s.snapshot).toMatchObject({ oro: 29_740_568, oroIniziale: 29_640_568 });
    s.reset();
    expect(s.snapshot).toMatchObject({ oro: 29_740_568, oroIniziale: 29_740_568 });
  });

  it('XP/h, durata e numeri', () => {
    const snap = { ...SessionStats.empty(0), xp: 1_000_000 };
    expect(xpPerHour(snap, 30 * 60_000)).toBe(2_000_000);
    expect(xpPerHour(snap, 1000)).toBe(0);
    expect(formatDuration(3_909_000)).toBe('1:05:09');
    expect(formatDuration(309_000)).toBe('5:09');
    expect(formatNumber(7868571)).toBe('7.868.571');
  });
});
