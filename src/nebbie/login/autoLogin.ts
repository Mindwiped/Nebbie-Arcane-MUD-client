import type { Account } from '../profiles/profiles';

/**
 * Accesso automatico a Nebbie (docs/PROTOCOLLO_NEBBIE.md, "Accesso"):
 * 1. alla richiesta del nome utente manda l'utente dell'account;
 * 2. quando il server nasconde l'input (eco lato server) manda la password, che il
 *    backend prende dal portachiavi;
 * 3. nel menu dei personaggi sceglie il numero del pg del profilo.
 * Ogni passo avviene una sola volta per connessione: se il server richiede di nuovo il
 * nome utente (accesso fallito) l'automa si ferma invece di riprovare all'infinito.
 * È puro: dice cosa fare, la sessione lo fa e lo scrive nell'output.
 */
export type LoginAction =
  | { type: 'sendUser' }
  | { type: 'sendPassword' }
  | { type: 'send'; text: string }
  | { type: 'info'; message: string };

type Stage = 'off' | 'user' | 'password' | 'menu' | 'done';

export class AutoLogin {
  private stage: Stage = 'off';
  private userPrompt: RegExp;
  private menuHeader: RegExp;
  private menuLine: RegExp;
  private inMenu = false;
  private entries = new Map<string, { num: string; nome: string }>();

  constructor(
    account: Account,
    private readonly characterName: string,
    private readonly hasPassword: boolean,
  ) {
    this.userPrompt = new RegExp(account.promptUtente, 'u');
    this.menuHeader = new RegExp(account.menuPg, 'u');
    this.menuLine = new RegExp(account.rigaMenu, 'u');
  }

  get active(): boolean {
    return this.stage !== 'off' && this.stage !== 'done';
  }

  start(): this {
    this.stage = 'user';
    this.inMenu = false;
    this.entries.clear();
    return this;
  }

  stop(): void {
    this.stage = 'off';
  }

  /** Testo arrivato dal MUD (riga completa o parziale, senza colori, prompt esclusi). */
  onText(text: string): LoginAction[] {
    switch (this.stage) {
      case 'user':
        if (this.userPrompt.test(text)) {
          this.stage = 'password';
          return [{ type: 'sendUser' }];
        }
        return [];
      case 'menu':
        return this.onMenuText(text);
      default:
        return [];
    }
  }

  /** Il server ha attivato (true) o tolto (false) l'eco lato server. */
  onServerEcho(on: boolean): LoginAction[] {
    if (!on || this.stage !== 'password') return [];
    this.stage = 'menu';
    if (!this.hasPassword) {
      return [{ type: 'info', message: 'Nessuna password salvata nel portachiavi: scrivila tu.' }];
    }
    return [{ type: 'sendPassword' }];
  }

  private onMenuText(text: string): LoginAction[] {
    if (this.userPrompt.test(text)) {
      this.stage = 'done';
      return [
        {
          type: 'info',
          message:
            'Il server ha chiesto di nuovo il nome utente: accesso automatico interrotto ' +
            '(controlla utente e password nei profili).',
        },
      ];
    }
    if (this.menuHeader.test(text)) {
      this.inMenu = true;
      this.entries.clear();
      return [];
    }
    if (!this.inMenu) return [];
    const m = this.menuLine.exec(text);
    if (m?.groups?.num && m.groups.nome) {
      this.entries.set(m.groups.nome.toLowerCase(), { num: m.groups.num, nome: m.groups.nome });
      return [];
    }
    // Prima riga dopo l'elenco (riga vuota o il prompt `>`): il menu è completo.
    if (this.entries.size === 0) return [];
    this.stage = 'done';
    const found = this.entries.get(this.characterName.trim().toLowerCase());
    if (found === undefined) {
      // Elenco dei nomi nel menu: un errore di battitura nel profilo si vede subito.
      const names = [...this.entries.values()]
        .filter((e) => e.num !== '0')
        .map((e) => e.nome)
        .join(', ');
      return [
        {
          type: 'info',
          message:
            `Non trovo "${this.characterName}" nel menu dei personaggi (ci sono: ${names}). ` +
            'Sceglilo tu e correggi il nome nel profilo.',
        },
      ];
    }
    return [{ type: 'send', text: found.num }];
  }
}
