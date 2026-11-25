import { describe, expect, it } from 'vitest';
import { parseAffectFlags } from './affectFlags';

describe('lettere degli effetti nel prompt', () => {
  it('maiuscola attiva, minuscola in scadenza (prompt reale [FsTM])', () => {
    expect(parseAffectFlags('FsTM')).toEqual([
      { lettera: 'F', incantesimo: 'fireshield', inScadenza: false },
      { lettera: 'S', incantesimo: 'sanctuary', inScadenza: true },
      { lettera: 'T', incantesimo: 'true sight', inScadenza: false },
      { lettera: 'M', incantesimo: 'mirror images', inScadenza: false },
    ]);
  });

  it('tutte le lettere spiegate dall utente', () => {
    expect(parseAffectFlags('DPI').map((f) => f.incantesimo)).toEqual([
      'protezione/immunità dal drain',
      'polymorph',
      'invisibility',
    ]);
    expect(parseAffectFlags('X')).toEqual([{ lettera: 'X', inScadenza: false }]);
  });

  it('anti magic shell in scadenza e prompt senza effetti', () => {
    expect(parseAffectFlags('a')).toEqual([
      { lettera: 'A', incantesimo: 'anti magic shell', inScadenza: true },
    ]);
    expect(parseAffectFlags('')).toEqual([]);
  });
});
