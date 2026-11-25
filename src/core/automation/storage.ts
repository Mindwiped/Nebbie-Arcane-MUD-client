import { readData, writeData } from '../backend';
import { parseAutomation, STORAGE_NAME, type AutomationFile } from './model';

/** Alias, trigger e gruppi salvati in automazioni.json nella cartella dati. */
export async function loadAutomation(): Promise<AutomationFile> {
  return parseAutomation(await readData(STORAGE_NAME));
}

export async function saveAutomation(file: AutomationFile): Promise<void> {
  await writeData(STORAGE_NAME, JSON.stringify(file, null, 2));
}
