import { readData, writeData } from '../backend';
import { GLOBAL } from '../automation/model';

/**
 * Barra pulsanti (docs/SPECIFICA.md, 3): ogni pulsante manda un comando come se fosse scritto
 * nella riga di comando (alias, `;`, `#n`, abbreviazioni), senza entrare nella cronologia.
 */
export interface ActionButton {
  id: string;
  etichetta: string;
  comando: string;
  /** Colore di sfondo (CSS), vuoto = predefinito. */
  colore: string;
  /** Scorciatoia: `F1`…`F12`, `Alt+1`…`Alt+0`, vuoto = nessuna. */
  tasto: string;
  /** `globale` oppure l'id del profilo. */
  ambito: string;
}

export interface ButtonsFile {
  versione: 1;
  pulsanti: ActionButton[];
}

export const STORAGE_NAME = 'pulsanti';

/** Scorciatoie disponibili: non interferiscono con la scrittura nella riga di comando. */
export const SHORTCUTS = [
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => `Alt+${d}`),
];

export function newButton(ambito = GLOBAL): ActionButton {
  return {
    id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    etichetta: 'Nuovo',
    comando: '',
    colore: '',
    tasto: '',
    ambito,
  };
}

/** Scorciatoia di un tasto premuto (usa `code`: su macOS ⌥ cambia `key`). */
export function shortcutOf(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): string | null {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (!e.altKey && /^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  const digit = /^Digit(\d)$/.exec(e.code);
  if (e.altKey && digit) return `Alt+${digit[1]}`;
  return null;
}

/** Pulsanti visibili per un profilo: globali e del profilo, nell'ordine del file. */
export function buttonsFor(file: ButtonsFile, profileId: string | undefined): ActionButton[] {
  return file.pulsanti.filter((b) => b.ambito === GLOBAL || b.ambito === profileId);
}

export function validateButton(b: ActionButton, all: ActionButton[]): string[] {
  const errors: string[] = [];
  if (!b.etichetta.trim()) errors.push("Il pulsante non ha un'etichetta.");
  if (!b.comando.trim()) errors.push('Il pulsante non ha un comando.');
  if (b.tasto && !SHORTCUTS.includes(b.tasto)) errors.push(`Scorciatoia non valida: ${b.tasto}.`);
  if (b.tasto) {
    // Due pulsanti visibili insieme non possono avere la stessa scorciatoia.
    const clash = all.find(
      (o) =>
        o.id !== b.id &&
        o.tasto === b.tasto &&
        (o.ambito === b.ambito || o.ambito === GLOBAL || b.ambito === GLOBAL),
    );
    if (clash) errors.push(`${b.tasto} è già usato da "${clash.etichetta}".`);
  }
  return errors;
}

export function parseButtons(json: string | null): ButtonsFile {
  if (!json) return { versione: 1, pulsanti: [] };
  let d: Partial<ButtonsFile>;
  try {
    d = JSON.parse(json);
  } catch {
    throw new Error('Il file dei pulsanti è danneggiato (JSON non valido).');
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const pulsanti = (Array.isArray(d.pulsanti) ? d.pulsanti : [])
    .filter((b) => b && typeof b.id === 'string')
    .map((b) => ({
      id: b.id,
      etichetta: str(b.etichetta),
      comando: str(b.comando),
      colore: str(b.colore),
      tasto: SHORTCUTS.includes(str(b.tasto)) ? str(b.tasto) : '',
      ambito: str(b.ambito) || GLOBAL,
    }));
  return { versione: 1, pulsanti };
}

export async function loadButtons(): Promise<ButtonsFile> {
  return parseButtons(await readData(STORAGE_NAME));
}

export async function saveButtons(file: ButtonsFile): Promise<void> {
  await writeData(STORAGE_NAME, JSON.stringify(file, null, 2));
}
