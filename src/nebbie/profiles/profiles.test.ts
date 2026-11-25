import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_REGEX, OLD_DEFAULT_PROMPT_REGEXES } from '../prompt/promptParser';
import {
  newAccount,
  newProfile,
  parseProfiles,
  serializeProfiles,
  validateAccount,
  validateProfile,
  type ProfilesFile,
} from './profiles';

describe('profili', () => {
  it('un profilo nuovo è valido e non contiene nomi di personaggi', () => {
    const p = newProfile();
    expect(validateProfile(p)).toEqual([]);
    expect(p.promptRegex).toBe(DEFAULT_PROMPT_REGEX);
    expect(p.promptRegex).not.toMatch(/Rigel/);
  });

  it('segnala gli errori del profilo', () => {
    const p = { ...newProfile(), nome: ' ', promptRegex: '(', max: { hp: -1 } };
    expect(validateProfile(p)).toHaveLength(3);
  });

  it('va e torna dal JSON', () => {
    const a = { ...newProfile('Rigel'), max: { hp: 500 } };
    const file: ProfilesFile = {
      versione: 2,
      account: { ...newAccount(), utente: 'mio-account', accessoAutomatico: true },
      profili: [a],
      ultimo: a.id,
    };
    expect(parseProfiles(serializeProfiles(file))).toEqual({
      ...file,
      profili: [{ ...a, max: { hp: 500, mp: undefined, mv: undefined } }],
    });
  });

  it('il file non contiene mai una password', () => {
    const file = parseProfiles('{"account":{"utente":"x","password":"segreta"}}');
    expect(serializeProfiles(file)).not.toContain('segreta');
  });

  it('converte i file della versione 1 (connessione nei profili)', () => {
    const v1 = JSON.stringify({
      versione: 1,
      profili: [
        { id: 'a', nome: 'Altro', host: 'altro.host', port: 1 },
        { id: 'b', nome: 'Rigel', host: 'nebbie.nebbie.it', port: 4000, encoding: 'latin1' },
      ],
      ultimo: 'b',
    });
    const f = parseProfiles(v1);
    expect(f.versione).toBe(2);
    expect(f.account).toMatchObject({ host: 'nebbie.nebbie.it', port: 4000, encoding: 'latin1' });
    expect(f.profili[1]).not.toHaveProperty('host');
  });

  it('la vecchia regex predefinita del prompt passa alla nuova', () => {
    const old = OLD_DEFAULT_PROMPT_REGEXES[0];
    const custom = '<(?<hp>\\d+)hp>';
    const f = parseProfiles(
      JSON.stringify({
        profili: [
          { nome: 'A', promptRegex: old },
          { nome: 'B', promptRegex: custom },
        ],
      }),
    );
    expect(f.profili[0].promptRegex).toBe(DEFAULT_PROMPT_REGEX);
    expect(f.profili[1].promptRegex).toBe(custom);
  });

  it('file assente o JSON danneggiato', () => {
    expect(parseProfiles(null).profili).toEqual([]);
    expect(() => parseProfiles('{')).toThrow(/danneggiato/);
  });
});

describe('account', () => {
  it('un account nuovo è valido', () => {
    expect(validateAccount(newAccount())).toEqual([]);
  });

  it("l'accesso automatico vuole il nome utente", () => {
    expect(validateAccount({ ...newAccount(), accessoAutomatico: true })).toEqual([
      "Per l'accesso automatico serve il nome utente.",
    ]);
  });

  it('regex del menu senza gruppi o non valide', () => {
    const errors = validateAccount({ ...newAccount(), rigaMenu: '^(\\d+)', menuPg: '(' });
    expect(errors.some((e) => e.includes('(?<num>'))).toBe(true);
    expect(errors.some((e) => e.startsWith('Intestazione del menu'))).toBe(true);
  });
});
