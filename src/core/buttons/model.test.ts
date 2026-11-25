import { describe, expect, it } from 'vitest';
import { GLOBAL } from '../automation/model';
import { buttonsFor, newButton, parseButtons, shortcutOf, validateButton } from './model';

const key = (k: Partial<KeyboardEvent>) =>
  shortcutOf({
    key: '',
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...k,
  });

describe('pulsanti', () => {
  it('scorciatoie: F1-F12 e ⌥ con le cifre (anche se ⌥ cambia il carattere)', () => {
    expect(key({ key: 'F5' })).toBe('F5');
    expect(key({ key: '¡', code: 'Digit1', altKey: true })).toBe('Alt+1');
    expect(key({ key: 'a', code: 'KeyA' })).toBeNull();
    expect(key({ key: 'F5', metaKey: true })).toBeNull();
    expect(key({ key: '1', code: 'Digit1' })).toBeNull();
  });

  it('pulsanti visibili: globali e del profilo', () => {
    const a = { ...newButton(GLOBAL), etichetta: 'A' };
    const b = { ...newButton('p1'), etichetta: 'B' };
    const c = { ...newButton('p2'), etichetta: 'C' };
    const f = { versione: 1 as const, pulsanti: [a, b, c] };
    expect(buttonsFor(f, 'p1').map((x) => x.etichetta)).toEqual(['A', 'B']);
  });

  it('validazione: etichetta, comando, scorciatoie in conflitto', () => {
    const a = { ...newButton(), etichetta: 'Loot', comando: 'get all corp', tasto: 'F2' };
    const b = { ...newButton('p1'), etichetta: 'Altro', comando: 'look', tasto: 'F2' };
    const c = { ...newButton('p2'), etichetta: 'Terzo', comando: 'look', tasto: 'F3' };
    expect(validateButton(a, [a, c])).toEqual([]);
    expect(validateButton(b, [a, b])[0]).toMatch(/F2 è già usato da "Loot"/);
    expect(validateButton({ ...newButton(), etichetta: ' ', comando: '' }, [])).toHaveLength(2);
  });

  it('lettura tollerante', () => {
    const f = parseButtons(
      '{"pulsanti":[{"id":"x","etichetta":"A","comando":"n","tasto":"F99"},3]}',
    );
    expect(f.pulsanti).toEqual([
      { id: 'x', etichetta: 'A', comando: 'n', colore: '', tasto: '', ambito: GLOBAL },
    ]);
    expect(() => parseButtons('{')).toThrow(/danneggiato/);
  });
});
