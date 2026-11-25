import { readData, writeData } from '../../core/backend';
import { parseProfiles, serializeProfiles, STORAGE_NAME, type ProfilesFile } from './profiles';

/** Profili salvati nella cartella dati dell'app (profili.json). */
export async function loadProfiles(): Promise<ProfilesFile> {
  return parseProfiles(await readData(STORAGE_NAME));
}

export async function saveProfiles(file: ProfilesFile): Promise<void> {
  await writeData(STORAGE_NAME, serializeProfiles(file));
}
