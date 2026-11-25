/**
 * Alias e trigger dell'utente (docs/SPECIFICA.md, 2.3 e 2.4). Ogni alias e trigger sta in un
 * gruppo; un gruppo vale per tutti i personaggi (`ambito: 'globale'`) o per un profilo, e si
 * accende o spegne in blocco (anche dagli interruttori nella barra in alto).
 */
export interface AutomationGroup {
  id: string;
  nome: string;
  attivo: boolean;
  /** `globale` oppure l'id del profilo a cui appartiene. */
  ambito: string;
  /** Mostra il gruppo come interruttore nella barra in alto. */
  interruttore: boolean;
}

export interface Alias {
  id: string;
  gruppo: string;
  attivo: boolean;
  nome: string;
  /** Regex sul comando scritto (ancorata dall'inizio alla fine se non lo è già). */
  pattern: string;
  /** Comandi da mandare; `$1`, `$2`… = gruppi della regex, `$0` = tutto; `;` separa. */
  azione: string;
}

export interface Trigger {
  id: string;
  gruppo: string;
  attivo: boolean;
  nome: string;
  /** `testo`: la riga deve contenere il testo; `regex`: espressione regolare. */
  tipo: 'testo' | 'regex';
  pattern: string;
  /** Comandi da mandare (vuoto = nessuno); `$1`… come negli alias. */
  comando: string;
  /** Colore del testo della riga (CSS), vuoto = invariato. */
  colore: string;
  /** Nasconde la riga dall'output (resta nel log). */
  nascondi: boolean;
}

export interface AutomationFile {
  versione: 1;
  gruppi: AutomationGroup[];
  alias: Alias[];
  trigger: Trigger[];
}

export const STORAGE_NAME = 'automazioni';
export const GLOBAL = 'globale';

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newGroup(nome = 'Nuovo gruppo', ambito = GLOBAL): AutomationGroup {
  return { id: newId('g'), nome, attivo: true, ambito, interruttore: false };
}

export function newAlias(gruppo: string): Alias {
  return { id: newId('a'), gruppo, attivo: true, nome: '', pattern: '', azione: '' };
}

export function newTrigger(gruppo: string): Trigger {
  return {
    id: newId('t'),
    gruppo,
    attivo: true,
    nome: '',
    tipo: 'testo',
    pattern: '',
    comando: '',
    colore: '',
    nascondi: false,
  };
}

export function emptyAutomation(): AutomationFile {
  const g = newGroup('Generale');
  return { versione: 1, gruppi: [g], alias: [], trigger: [] };
}

/** Regex di un alias: ancorata, così `k` non scatta su `kill`. */
export function aliasRegex(pattern: string): RegExp {
  let p = pattern.trim();
  if (!p.startsWith('^')) p = `^${p}`;
  if (!p.endsWith('$')) p = `${p}$`;
  return new RegExp(p, 'u');
}

export function triggerRegex(t: Pick<Trigger, 'tipo' | 'pattern'>): RegExp {
  if (t.tipo === 'regex') return new RegExp(t.pattern, 'u');
  return new RegExp(t.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
}

function checkRegex(make: () => RegExp, label: string, errors: string[]): void {
  try {
    if (make().test('')) errors.push(`${label}: riconosce anche il testo vuoto.`);
  } catch (e) {
    errors.push(`${label}: regex non valida (${(e as Error).message}).`);
  }
}

export function validateAlias(a: Alias): string[] {
  const errors: string[] = [];
  if (!a.pattern.trim()) errors.push("L'alias non ha un'espressione.");
  else checkRegex(() => aliasRegex(a.pattern), 'Alias', errors);
  if (!a.azione.trim()) errors.push("L'alias non ha un'azione.");
  return errors;
}

export function validateTrigger(t: Trigger): string[] {
  const errors: string[] = [];
  if (!t.pattern.trim()) errors.push('Il trigger non ha un testo da cercare.');
  else checkRegex(() => triggerRegex(t), 'Trigger', errors);
  if (!t.comando.trim() && !t.colore.trim() && !t.nascondi)
    errors.push('Il trigger non fa niente: scegli un comando, un colore o "nascondi".');
  return errors;
}

/** Lettura tollerante del file: voci incomplete scartate, gruppo "Generale" sempre presente. */
export function parseAutomation(json: string | null): AutomationFile {
  if (!json) return emptyAutomation();
  let d: Partial<AutomationFile>;
  try {
    d = JSON.parse(json);
  } catch {
    throw new Error('Il file delle automazioni è danneggiato (JSON non valido).');
  }
  const str = (v: unknown, f = '') => (typeof v === 'string' ? v : f);
  const gruppi: AutomationGroup[] = (Array.isArray(d.gruppi) ? d.gruppi : [])
    .filter((g) => g && typeof g.id === 'string')
    .map((g) => ({
      id: g.id,
      nome: str(g.nome, 'Gruppo'),
      attivo: g.attivo !== false,
      ambito: str(g.ambito, GLOBAL) || GLOBAL,
      interruttore: g.interruttore === true,
    }));
  if (gruppi.length === 0) gruppi.push(newGroup('Generale'));
  const ids = new Set(gruppi.map((g) => g.id));
  const fallback = gruppi[0].id;
  const alias: Alias[] = (Array.isArray(d.alias) ? d.alias : [])
    .filter((a) => a && typeof a.id === 'string')
    .map((a) => ({
      id: a.id,
      gruppo: ids.has(a.gruppo) ? a.gruppo : fallback,
      attivo: a.attivo !== false,
      nome: str(a.nome),
      pattern: str(a.pattern),
      azione: str(a.azione),
    }));
  const trigger: Trigger[] = (Array.isArray(d.trigger) ? d.trigger : [])
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => ({
      id: t.id,
      gruppo: ids.has(t.gruppo) ? t.gruppo : fallback,
      attivo: t.attivo !== false,
      nome: str(t.nome),
      tipo: t.tipo === 'regex' ? 'regex' : 'testo',
      pattern: str(t.pattern),
      comando: str(t.comando),
      colore: str(t.colore),
      nascondi: t.nascondi === true,
    }));
  return { versione: 1, gruppi, alias, trigger };
}
