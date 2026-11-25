import { describe, expect, it } from 'vitest';
import { newAccount } from '../profiles/profiles';
import { AutoLogin } from './autoLogin';

// Testi presi dal log reale del 2026-11-13 (nomi degli altri pg dell'account sostituiti).
const USER_PROMPT = 'Email o nome del personaggio su Nebbie Arcane? ';
const MENU = [
  '',
  'Scegli un personagggio',
  ' q. Quit',
  " 0. Crea un nuovo pg o usane uno non ancora connesso all'account",
  '1. Primo Il Titolo',
  '2. Secondo the Elf',
  '4. Rigel The NecroMonger',
  '12. Ultimo the Trollish',
];

function run(login: AutoLogin, texts: string[]) {
  return texts.flatMap((t) => login.onText(t));
}

describe('AutoLogin', () => {
  const account = { ...newAccount(), utente: 'account', accessoAutomatico: true };

  it('accesso completo: utente, password, scelta del pg', () => {
    const login = new AutoLogin(account, 'Rigel', true).start();
    expect(run(login, ['Benvenuto', USER_PROMPT])).toEqual([{ type: 'sendUser' }]);
    expect(login.onServerEcho(true)).toEqual([{ type: 'sendPassword' }]);
    expect(run(login, [...MENU, '>'])).toEqual([{ type: 'send', text: '4' }]);
    expect(login.active).toBe(false);
  });

  it('errore di battitura nel profilo (Rigle): mostra i nomi del menu', () => {
    const login = new AutoLogin(account, 'Rigle', true).start();
    run(login, [USER_PROMPT]);
    login.onServerEcho(true);
    const [action] = run(login, [...MENU, '>']);
    expect(action).toMatchObject({ type: 'info' });
    expect((action as { message: string }).message).toMatch(/"Rigle".*Rigel/);
  });

  it('il nome del profilo non distingue maiuscole', () => {
    const login = new AutoLogin(account, 'rigel', true).start();
    run(login, [USER_PROMPT]);
    login.onServerEcho(true);
    expect(run(login, [...MENU, ''])).toEqual([{ type: 'send', text: '4' }]);
  });

  it('pg non presente nel menu: lo dice e lascia scegliere', () => {
    const login = new AutoLogin(account, 'Sconosciuto', true).start();
    run(login, [USER_PROMPT]);
    login.onServerEcho(true);
    const actions = run(login, [...MENU, '>']);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'info' });
    const message = (actions[0] as { message: string }).message;
    expect(message).toContain('Rigel');
    expect(message).not.toContain('Crea');
  });

  it('senza password salvata: chiede di scriverla e poi sceglie comunque il pg', () => {
    const login = new AutoLogin(account, 'Rigel', false).start();
    run(login, [USER_PROMPT]);
    expect(login.onServerEcho(true)[0]).toMatchObject({ type: 'info' });
    expect(run(login, [...MENU, '>'])).toEqual([{ type: 'send', text: '4' }]);
  });

  it('accesso fallito: non riprova all infinito', () => {
    const login = new AutoLogin(account, 'Rigel', true).start();
    run(login, [USER_PROMPT]);
    login.onServerEcho(true);
    const actions = run(login, ['Codice errato.', USER_PROMPT]);
    expect(actions).toEqual([expect.objectContaining({ type: 'info' })]);
    expect(run(login, [USER_PROMPT])).toEqual([]);
    expect(login.onServerEcho(true)).toEqual([]);
  });

  it('la richiesta ripetuta subito dopo l invio del nome viene ignorata', () => {
    // La riga parziale del prompt viene riunita al suo seguito e ripassa dall'automa.
    const login = new AutoLogin(account, 'Rigel', true).start();
    run(login, [USER_PROMPT]);
    expect(run(login, [USER_PROMPT])).toEqual([]);
    expect(login.onServerEcho(true)).toEqual([{ type: 'sendPassword' }]);
  });

  it('spento: non fa nulla', () => {
    const login = new AutoLogin(account, 'Rigel', true);
    expect(run(login, [USER_PROMPT])).toEqual([]);
  });
});
