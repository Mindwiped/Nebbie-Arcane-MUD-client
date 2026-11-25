/**
 * Completamento con Tab sulle parole viste di recente nell'output (nomi di mob, oggetti…).
 * Tab ripetuto passa al candidato successivo.
 */
export class WordCompleter {
  private words: string[] = [];
  private cycle: { base: string; candidates: string[]; i: number; last: string } | null = null;

  constructor(private readonly max = 3000) {}

  /** Impara le parole di una riga (le più recenti hanno la precedenza). */
  learn(text: string): void {
    const found = text.match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu);
    if (!found) return;
    for (const w of found) {
      const i = this.words.indexOf(w);
      if (i >= 0) this.words.splice(i, 1);
      this.words.unshift(w);
    }
    if (this.words.length > this.max) this.words.length = this.max;
  }

  /** Restituisce la riga completata o `null` se non ci sono candidati. */
  complete(input: string): string | null {
    if (this.cycle && input === this.cycle.last) {
      const c = this.cycle;
      c.i = (c.i + 1) % c.candidates.length;
      c.last = c.base + c.candidates[c.i];
      return c.last;
    }
    const m = /(\S+)$/.exec(input);
    if (!m) return null;
    const prefix = m[1].toLowerCase();
    const base = input.slice(0, m.index);
    const candidates = this.words.filter(
      (w) => w.toLowerCase().startsWith(prefix) && w.toLowerCase() !== prefix,
    );
    if (candidates.length === 0) {
      this.cycle = null;
      return null;
    }
    const last = base + candidates[0];
    this.cycle = { base, candidates, i: 0, last };
    return last;
  }

  reset(): void {
    this.cycle = null;
  }
}
