import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from './settings';

describe('impostazioni', () => {
  it('lettura tollerante: valori mancanti, sbagliati o fuori scala', () => {
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings('non json')).toEqual(defaultSettings());
    const s = parseSettings(
      JSON.stringify({
        tema: 'arcobaleno',
        testo: 99,
        scala: 40,
        suoni: false,
        avvisi: { tell: { suono: false }, gruppo: 'sì' },
        sogliaHp: 25,
      }),
    );
    expect(s).toMatchObject({ tema: 'scuro', testo: 28, scala: 70, suoni: false, sogliaHp: 25 });
    expect(s.avvisi.tell).toEqual({ suono: false, notifica: true });
    expect(s.avvisi.gruppo).toEqual(defaultSettings().avvisi.gruppo);
  });
});
