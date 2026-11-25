import { describe, expect, it } from 'vitest';
import { MAX_REPEAT, parseInput } from './commandParser';

describe('parseInput', () => {
  it('comando singolo', () => {
    expect(parseInput('look')).toEqual(['look']);
  });

  it('riga vuota manda un invio vuoto', () => {
    expect(parseInput('')).toEqual(['']);
  });

  it('separatore ; e spazi', () => {
    expect(parseInput('n; e ;look')).toEqual(['n', 'e', 'look']);
  });

  it('pezzi vuoti tra separatori ignorati', () => {
    expect(parseInput('n;;e;')).toEqual(['n', 'e']);
  });

  it('punto e virgola protetto', () => {
    expect(parseInput('say ciao\\; come va')).toEqual(['say ciao; come va']);
  });

  it('ripetizione #n', () => {
    expect(parseInput('#3 nord;look')).toEqual(['nord', 'nord', 'nord', 'look']);
  });

  it('ripetizione limitata', () => {
    expect(parseInput('#1000 n')).toHaveLength(MAX_REPEAT);
  });
});
