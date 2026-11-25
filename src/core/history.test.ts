import { describe, expect, it } from 'vitest';
import { History } from './history';

function make(...cmds: string[]) {
  const h = new History();
  cmds.forEach((c) => h.add(c));
  return h;
}

describe('History', () => {
  it('su e giù con la riga vuota', () => {
    const h = make('n', 'e', 'look');
    expect(h.prev('')).toBe('look');
    expect(h.prev('')).toBe('e');
    expect(h.prev('')).toBe('n');
    expect(h.prev('')).toBeUndefined();
    expect(h.next()).toBe('e');
    expect(h.next()).toBe('look');
    expect(h.next()).toBe('');
  });

  it('comando appena inviato ancora nella riga: freccia su va subito al precedente', () => {
    // Dopo Invio il client lascia "look" selezionato nella riga di comando.
    const h = make('n', 'e', 'look');
    expect(h.prev('look')).toBe('e');
    expect(h.prev('look')).toBe('n');
    expect(h.next()).toBe('e');
    expect(h.next()).toBe('look');
    // In fondo la riga contiene già "look": niente da cambiare.
    expect(h.next()).toBeUndefined();
  });

  it('ricerca per prefisso solo quando richiesta, e ritorno alla bozza', () => {
    const h = make('cast stone', 'n', 'cast armor', 'look');
    expect(h.prev('cast', 'cast')).toBe('cast armor');
    expect(h.prev('cast', 'cast')).toBe('cast stone');
    expect(h.next()).toBe('cast armor');
    expect(h.next()).toBe('cast');
  });

  it('niente duplicati consecutivi né righe vuote', () => {
    const h = make('n', 'n', '', '  ', 'e');
    expect(h.all).toEqual(['n', 'e']);
  });

  it('salta le voci uguali a quella visibile', () => {
    const h = make('kill orco', 'n', 'kill orco');
    expect(h.prev('kill', 'kill')).toBe('kill orco');
    expect(h.prev('kill', 'kill')).toBeUndefined();
    const h2 = make('a', 'b', 'a');
    expect(h2.prev('a')).toBe('b');
    expect(h2.prev('a')).toBe('a');
  });

  it('dopo un nuovo invio si riparte dal comando più recente', () => {
    const h = make('n', 'e');
    h.prev('');
    h.prev('');
    h.add('look');
    expect(h.prev('')).toBe('look');
  });

  it('limite di voci', () => {
    const h = new History(2);
    ['a', 'b', 'c'].forEach((c) => h.add(c));
    expect(h.all).toEqual(['b', 'c']);
  });
});
