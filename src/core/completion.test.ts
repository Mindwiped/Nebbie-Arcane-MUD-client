import { describe, expect, it } from 'vitest';
import { WordCompleter } from './completion';

describe('WordCompleter', () => {
  it('completa con la parola vista più di recente e cicla con Tab', () => {
    const c = new WordCompleter();
    c.learn('Uno scheletro chierico arriva volando da est.');
    c.learn('Lo scheggia di pietra cade.');
    expect(c.complete('kill sche')).toBe('kill scheggia');
    expect(c.complete('kill scheggia')).toBe('kill scheletro');
    expect(c.complete('kill scheletro')).toBe('kill scheggia');
  });

  it('ignora maiuscole nel prefisso', () => {
    const c = new WordCompleter();
    c.learn('Il Drago dorme.');
    expect(c.complete('look dr')).toBe('look Drago');
  });

  it('nessun candidato', () => {
    const c = new WordCompleter();
    c.learn('nord sud');
    expect(c.complete('kill xyz')).toBeNull();
    expect(c.complete('')).toBeNull();
  });

  it('parole troppo corte non vengono imparate', () => {
    const c = new WordCompleter();
    c.learn('a di un');
    expect(c.complete('d')).toBeNull();
  });
});
