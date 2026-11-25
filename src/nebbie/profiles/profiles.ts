import type { Encoding } from '../../core/types';
import {
  compilePromptRegex,
  DEFAULT_PROMPT_REGEX,
  OLD_DEFAULT_PROMPT_REGEXES,
} from '../prompt/promptParser';

/**
 * Account di gioco: uguale per tutti i personaggi (su Nebbie si entra con email o nome e
 * codice di accesso, poi si sceglie il pg da un menu). La password NON sta qui: è nel
 * portachiavi del sistema, gestita dal backend.
 */
export interface Account {
  host: string;
  port: number;
  encoding: Encoding;
  /** Email o nome usato per entrare. */
  utente: string;
  /** Manda utente e password e sceglie il personaggio del profilo dal menu. */
  accessoAutomatico: boolean;
  /** Regex della richiesta del nome utente (formato del MUD: è un dato, modificabile). */
  promptUtente: string;
  /** Regex dell'intestazione del menu dei personaggi. */
  menuPg: string;
  /** Regex di una riga del menu: gruppo `num` (numero da mandare) e `nome` (nome del pg). */
  rigaMenu: string;
}

/**
 * Profilo di un personaggio (docs/SPECIFICA.md, 2.2). Nessun personaggio è speciale:
 * tutto ciò che cambia da un pg all'altro sta qui; la connessione sta nell'account.
 */
export interface Profile {
  id: string;
  /** Nome del personaggio: usato per sceglierlo dal menu e per i file di log. */
  nome: string;
  promptRegex: string;
  /** Massimi impostati a mano, finché il prompt non li mostra. */
  max: { hp?: number; mp?: number; mv?: number };
  /** Registra la sessione su disco. */
  log: boolean;
  /** Abbreviazioni degli incantesimi (`mm orco` → `cast 'magic missile' orco`). */
  abbreviazioni: boolean;
}

export interface ProfilesFile {
  versione: 2;
  account: Account;
  profili: Profile[];
  ultimo?: string;
}

export const STORAGE_NAME = 'profili';

/** Dal log reale del 2026-11-13 (vedi docs/PROTOCOLLO_NEBBIE.md, "Accesso"). */
export const DEFAULT_LOGIN_PROMPT = String.raw`Email o nome del personaggio su Nebbie Arcane\?`;
/** Il MUD scrive "personagggio" con tre g: la regex accetta entrambe le forme. */
export const DEFAULT_MENU_HEADER = String.raw`^Scegli un personag+io`;
export const DEFAULT_MENU_LINE = String.raw`^\s*(?<num>\d+)\.\s+(?<nome>\S+)`;

export function newAccount(): Account {
  return {
    host: 'nebbie.nebbie.it',
    port: 4000,
    encoding: 'utf8',
    utente: '',
    accessoAutomatico: false,
    promptUtente: DEFAULT_LOGIN_PROMPT,
    menuPg: DEFAULT_MENU_HEADER,
    rigaMenu: DEFAULT_MENU_LINE,
  };
}

export function newId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newProfile(nome = 'Nuovo personaggio'): Profile {
  return {
    id: newId(),
    nome,
    promptRegex: DEFAULT_PROMPT_REGEX,
    max: {},
    log: true,
    abbreviazioni: true,
  };
}

export function emptyFile(): ProfilesFile {
  return { versione: 2, account: newAccount(), profili: [] };
}

function checkRegex(source: string, label: string, errors: string[]): void {
  try {
    if (new RegExp(source, 'u').test('')) errors.push(`${label}: riconosce anche il testo vuoto.`);
  } catch (e) {
    errors.push(`${label}: regex non valida (${(e as Error).message}).`);
  }
}

export function validateAccount(a: Account): string[] {
  const errors: string[] = [];
  if (!a.host.trim()) errors.push("L'indirizzo del server è obbligatorio.");
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535)
    errors.push('La porta deve essere un numero tra 1 e 65535.');
  if (a.accessoAutomatico && !a.utente.trim())
    errors.push("Per l'accesso automatico serve il nome utente.");
  checkRegex(a.promptUtente, 'Richiesta del nome utente', errors);
  checkRegex(a.menuPg, 'Intestazione del menu', errors);
  checkRegex(a.rigaMenu, 'Riga del menu', errors);
  if (!/\(\?<num>/.test(a.rigaMenu) || !/\(\?<nome>/.test(a.rigaMenu))
    errors.push('Riga del menu: servono i gruppi (?<num>…) e (?<nome>…).');
  return errors;
}

/** Controlla un profilo; restituisce gli errori in italiano (vuoto se va bene). */
export function validateProfile(p: Profile): string[] {
  const errors: string[] = [];
  if (!p.nome.trim()) errors.push('Il nome del personaggio è obbligatorio.');
  try {
    compilePromptRegex(p.promptRegex);
  } catch (e) {
    errors.push((e as Error).message);
  }
  for (const [k, v] of Object.entries(p.max)) {
    if (v !== undefined && (!Number.isFinite(v) || v <= 0))
      errors.push(`Il massimo ${k.toUpperCase()} deve essere un numero positivo.`);
  }
  return errors;
}

const positive = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);

type RawProfile = Partial<Profile> & { host?: unknown; port?: unknown; encoding?: unknown };

function parseAccount(r: Partial<Account> | undefined, legacy?: RawProfile): Account {
  const base = newAccount();
  const src: Record<string, unknown> = { ...(legacy ?? {}), ...(r ?? {}) };
  return {
    host: str(src.host, base.host),
    port: typeof src.port === 'number' ? src.port : base.port,
    encoding: src.encoding === 'latin1' ? 'latin1' : 'utf8',
    utente: typeof src.utente === 'string' ? src.utente : '',
    accessoAutomatico: src.accessoAutomatico === true,
    promptUtente: str(src.promptUtente, base.promptUtente),
    menuPg: str(src.menuPg, base.menuPg),
    rigaMenu: str(src.rigaMenu, base.rigaMenu),
  };
}

/**
 * Legge il file dei profili in modo tollerante: campi mancanti presi dai valori predefiniti.
 * I file della versione 1 (connessione dentro ogni profilo) vengono convertiti: l'account
 * prende server, porta e codifica dal profilo usato per ultimo.
 */
export function parseProfiles(json: string | null): ProfilesFile {
  if (!json) return emptyFile();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Il file dei profili è danneggiato (JSON non valido).');
  }
  const raw: RawProfile[] = Array.isArray(data.profili) ? data.profili : [];
  const ultimo = typeof data.ultimo === 'string' ? data.ultimo : undefined;
  const legacy = data.account ? undefined : (raw.find((p) => p.id === ultimo) ?? raw[0]);
  const profili: Profile[] = raw.map((r) => {
    const base = newProfile();
    return {
      id: str(r.id, base.id),
      nome: typeof r.nome === 'string' ? r.nome : base.nome,
      // Chi usava la regex predefinita di una versione precedente passa alla nuova.
      promptRegex: OLD_DEFAULT_PROMPT_REGEXES.includes(r.promptRegex ?? '')
        ? DEFAULT_PROMPT_REGEX
        : str(r.promptRegex, base.promptRegex),
      max: { hp: positive(r.max?.hp), mp: positive(r.max?.mp), mv: positive(r.max?.mv) },
      log: typeof r.log === 'boolean' ? r.log : true,
      abbreviazioni: typeof r.abbreviazioni === 'boolean' ? r.abbreviazioni : true,
    };
  });
  return {
    versione: 2,
    account: parseAccount(data.account as Partial<Account> | undefined, legacy),
    profili,
    ultimo,
  };
}

export function serializeProfiles(file: ProfilesFile): string {
  return JSON.stringify(file, null, 2);
}
