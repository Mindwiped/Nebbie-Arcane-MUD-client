import { TICK_MS } from './affectTimers';

/**
 * Orologio del tick del MUD. Nebbie non segnala il tick, ma gli incantesimi scadono (e
 * avvisano, "vacilla") proprio allo scattare del tick: ogni scadenza dà la fase del tick.
 * La durata parte da 75 s e si affina confrontando le scadenze tra loro (log reali: 374,9 s
 * tra due scadenze = 5,00 tick; 150,0 s = 2,00 tick).
 *
 * Un dispel toglie gli incantesimi in un momento qualsiasi: quando la fase è stabile, una
 * fine che cade lontano dal tick previsto viene scartata (`onTick` restituisce false). Se due
 * segnali scartati sono coerenti tra loro, la fase si riallinea su di loro.
 */
export interface TickSnapshot {
  /** Ultimo tick osservato (ms), se ce n'è stato uno. */
  ultimo?: number;
  /** Durata stimata del tick (ms). */
  periodo: number;
  /** Quante misure hanno affinato la durata. */
  misure: number;
}

/** Scadenze più vicine di così appartengono allo stesso tick. */
const SAME_TICK_MS = 5_000;
/** Durate plausibili (misurato: 74,98 s); fuori da qui la misura viene da un segnale sbagliato. */
const MIN_PERIOD = 70_000;
const MAX_PERIOD = 80_000;
/** Oltre questo numero di tick tra due scadenze la misura è troppo incerta. */
const MAX_TICKS_APART = 40;
/** Con la fase stabile, una fine più lontana di così dal tick previsto non è un tick. */
const ON_TICK_TOLERANCE_MS = 4_000;
/** Misure necessarie per considerare la fase stabile (e scartare i segnali fuori tempo). */
const STABLE_AFTER = 2;
/** Oltre questi tick dall'ultimo il controllo di fase è troppo incerto: si riaggancia. */
const MAX_TICKS_CHECKED = 20;

export class TickClock {
  private s: TickSnapshot = { periodo: TICK_MS, misure: 0 };
  /** Ultimo segnale scartato: se il prossimo è coerente con lui, la fase si sposta. */
  private rejected: number | undefined;
  /** L'ultimo tick viene da una scadenza vera (non da una stima tra due `att`). */
  private lastPrecise = false;

  constructor(private readonly now: () => number = Date.now) {}

  get snapshot(): TickSnapshot {
    return { ...this.s };
  }

  /** La fase è abbastanza sicura da riconoscere i segnali fuori tempo. */
  get stable(): boolean {
    return this.s.misure >= STABLE_AFTER;
  }

  /**
   * Una scadenza o un avviso di incantesimo (o un tick stimato in un istante passato, `at`).
   * Restituisce true se è (probabilmente) un tick, false se è fuori tempo (dispel).
   * `precise: false` = stima approssimativa (tra due `att`): fissa la fase solo se non ce n'è
   * una precisa e non entra nella stima della durata.
   */
  onTick(at?: number, precise = true): boolean {
    const t = at ?? this.now();
    const last = this.s.ultimo;
    if (!precise) {
      if (last === undefined || !this.lastPrecise) {
        this.s.ultimo = t;
        this.lastPrecise = false;
      }
      return true;
    }
    if (last === undefined || !this.lastPrecise) {
      this.s.ultimo = t;
      this.lastPrecise = true;
      return true;
    }
    const dt = t - last;
    if (dt < SAME_TICK_MS) return true;
    const k = Math.round(dt / this.s.periodo);
    const offset = Math.abs(dt - k * this.s.periodo);

    if (this.stable && k <= MAX_TICKS_CHECKED && (k < 1 || offset > ON_TICK_TOLERANCE_MS)) {
      const prev = this.rejected;
      if (prev !== undefined && t - prev >= SAME_TICK_MS) {
        const kr = Math.round((t - prev) / this.s.periodo);
        if (kr >= 1 && Math.abs(t - prev - kr * this.s.periodo) <= ON_TICK_TOLERANCE_MS) {
          // Due segnali fuori fase ma coerenti tra loro: era la fase a essere sbagliata.
          this.s.ultimo = t;
          this.lastPrecise = true;
          this.rejected = undefined;
          return true;
        }
      }
      this.rejected = t;
      return false;
    }

    if (k >= 1 && k <= MAX_TICKS_APART) {
      const estimate = dt / k;
      if (estimate >= MIN_PERIOD && estimate <= MAX_PERIOD) {
        const n = Math.min(this.s.misure, 19);
        this.s.periodo = (this.s.periodo * (n + 1) + estimate) / (n + 2);
        this.s.misure += 1;
      }
    }
    this.s.ultimo = t;
    this.lastPrecise = true;
    this.rejected = undefined;
    return true;
  }
}

/** Millisecondi al prossimo tick, o `undefined` se non se n'è ancora visto uno. */
export function msToNextTick(s: TickSnapshot, now: number): number | undefined {
  if (s.ultimo === undefined) return undefined;
  const elapsed = now - s.ultimo;
  return s.periodo - (((elapsed % s.periodo) + s.periodo) % s.periodo);
}
