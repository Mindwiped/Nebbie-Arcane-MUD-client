/** Numero massimo di ripetizioni con `#n`, per evitare di inondare il MUD per sbaglio. */
export const MAX_REPEAT = 50;

/**
 * Trasforma la riga scritta dal giocatore nei comandi da mandare:
 * - `;` separa più comandi (`\;` per un punto e virgola vero);
 * - `#3 nord` ripete un comando.
 * Una riga vuota manda un invio vuoto (serve in molti MUD).
 */
export function parseInput(input: string, separator = ';'): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && input[i + 1] === separator) {
      current += separator;
      i++;
    } else if (c === separator) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);

  const out: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    const m = /^#(\d+)\s+(.+)$/.exec(part);
    if (m) {
      const n = Math.min(Number(m[1]), MAX_REPEAT);
      for (let k = 0; k < n; k++) out.push(m[2]);
    } else if (part || parts.length === 1) {
      out.push(part);
    }
  }
  return out;
}
