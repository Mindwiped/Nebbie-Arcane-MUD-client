/**
 * Allarme furto (docs/SPECIFICA.md, 3): l'oro in tasca cala senza che il giocatore abbia
 * fatto qualcosa. Funziona solo se il prompt mostra l'oro (gruppo `oro` nella regex del
 * profilo). "Fare qualcosa" = aver mandato un comando negli ultimi secondi: comprare, dare,
 * pagare passano da un comando. Quali comandi spendono davvero è *da verificare* con i log.
 */
export interface TheftAlert {
  da: number;
  a: number;
  mancano: number;
}

export class TheftAlarm {
  private last: number | undefined;
  private lastCommandAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly graceMs = 3000,
  ) {}

  onCommand(): void {
    this.lastCommandAt = this.now();
  }

  reset(): void {
    this.last = undefined;
  }

  /** Oro letto dal prompt; restituisce l'allarme se è calato senza un comando recente. */
  onGold(oro: number): TheftAlert | null {
    const prev = this.last;
    this.last = oro;
    if (prev === undefined || oro >= prev) return null;
    if (this.now() - this.lastCommandAt <= this.graceMs) return null;
    return { da: prev, a: oro, mancano: prev - oro };
  }
}
