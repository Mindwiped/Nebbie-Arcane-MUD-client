import { readData, writeData } from '../../core/backend';

/**
 * Layout dei pannelli salvati (layout.json nella cartella dati): più layout con nome
 * ("principale", "caccia"…), uno attivo. Il contenuto di ogni layout è quello di
 * `DockviewApi.toJSON()`.
 */
export interface LayoutsFile {
  versione: 1;
  attivo: string;
  layouts: Record<string, unknown>;
}

export const STORAGE_NAME = 'layout';
export const DEFAULT_LAYOUT_NAME = 'principale';

export function emptyLayouts(): LayoutsFile {
  return { versione: 1, attivo: DEFAULT_LAYOUT_NAME, layouts: {} };
}

/** Lettura tollerante: un file danneggiato non deve impedire di aprire il client. */
export function parseLayouts(json: string | null): LayoutsFile {
  if (!json) return emptyLayouts();
  try {
    const d = JSON.parse(json) as Partial<LayoutsFile>;
    const layouts =
      d.layouts && typeof d.layouts === 'object' && !Array.isArray(d.layouts) ? d.layouts : {};
    const attivo = typeof d.attivo === 'string' && d.attivo ? d.attivo : DEFAULT_LAYOUT_NAME;
    return { versione: 1, attivo, layouts };
  } catch {
    return emptyLayouts();
  }
}

/** Nome valido per un layout: non vuoto, al massimo 40 caratteri. */
export function cleanLayoutName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  return n && n.length <= 40 ? n : null;
}

export async function loadLayouts(): Promise<LayoutsFile> {
  return parseLayouts(await readData(STORAGE_NAME));
}

export async function saveLayouts(file: LayoutsFile): Promise<void> {
  await writeData(STORAGE_NAME, JSON.stringify(file));
}
