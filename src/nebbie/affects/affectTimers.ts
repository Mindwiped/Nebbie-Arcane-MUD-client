/**
 * Timer degli incantesimi attivi.
 *
 * Fonti, dalla più affidabile:
 * - `att`: durata residua in tick; un tick di Nebbie dura circa 75 secondi (misurato sui log
 *   reali: le durate scendono di 1 ogni 70-77 s);
 * - durate imparate: dall'inizio (lancio "Pronunci le parole…", oppure lettera che compare nel
 *   prompt, che vale anche per le pozioni) alla fine, ricordate per profilo e usate dopo;
 * - lettere del prompt: una lettera che compare avvia il timer (se la durata è nota), una che
 *   sparisce lo toglie.
 * Il messaggio di fine toglie il timer; l'avviso ("vacilla", lettera minuscola) lo segna.
 * Una durata si impara solo se la fine cade sul tick: una fine fuori tempo è un dispel.
 *
 * Gli incantesimi finiscono su uno scatto del tick, quindi la durata in secondi dipende da
 * quando lo lanci dentro il tick (log reale del 2026-11-18: anti magic shell durato 91, 107, 130,
 * 134 e 143 s, ma sempre al secondo tick dopo il lancio). Se il tick è noto si impara anche il
 * numero di scatti (`nome#tick`) e la fine prevista è su quello scatto.
 */
export const TICK_MS = 75_000;
/** Durate più brevi di così non vengono imparate (lancio fallito, recast immediato…). */
const MIN_LEARN_MS = 20_000;
/** Chiave delle durate imparate in scatti del tick: `anti magic shell#tick` = 2. */
export const TICK_KEY = '#tick';

/** Prossimo scatto del tick e periodo, se il tick è noto. */
export type TickInfo = { prossimo: number; periodo: number };

export interface AffectTimer {
  nome: string;
  /** Istante previsto di fine (ms). */
  fine: number;
  fonte: 'att' | 'lancio' | 'prompt';
  /** È arrivato l'avviso che sta per finire. */
  avviso: boolean;
}

export class AffectTimers {
  private timers = new Map<string, AffectTimer>();
  private castAt = new Map<string, number>();
  /** Primo scatto del tick dopo il lancio (se il tick era noto). */
  private castTick = new Map<string, TickInfo>();
  /** Il tick attuale (la sessione lo collega al suo orologio del tick). */
  tickInfo?: () => TickInfo | undefined;

  constructor(
    /** Durate imparate in ms per incantesimo (del profilo attivo). */
    public durations: Record<string, number> = {},
    private readonly now: () => number = Date.now,
    private readonly tickMs = TICK_MS,
    /** Chiamata quando si impara una durata nuova (per salvarla). */
    private readonly onLearn?: (durations: Record<string, number>) => void,
  ) {}

  get list(): AffectTimer[] {
    return [...this.timers.values()].sort((a, b) => a.fine - b.fine);
  }

  clear(): void {
    this.timers.clear();
    this.castAt.clear();
    this.castTick.clear();
  }

  /**
   * `att` ha l'elenco completo: sostituisce i timer. Come nei DikuMud l'incantesimo finisce
   * quando la durata scende sotto zero, cioè al (N+1)-esimo scatto del tick dopo la lettura
   * (log reale: `att` = 2, scaduto 181 s dopo = 2,4 tick). Se si conosce il prossimo tick la
   * fine è `prossimo + N tick`; altrimenti il primo scatto è in media a mezzo tick.
   */
  onAtt(
    incantesimi: { nome: string; durata: number }[],
    tick?: { prossimo: number; periodo: number },
  ): void {
    const now = this.now();
    this.timers.clear();
    for (const { nome, durata } of incantesimi) {
      const fine = tick
        ? tick.prossimo + Math.max(0, durata) * tick.periodo
        : now + (Math.max(0, durata) + 0.5) * this.tickMs;
      this.timers.set(nome, {
        nome,
        fine,
        fonte: 'att',
        avviso: false,
      });
    }
  }

  onCast(nome: string): void {
    this.start(nome, 'lancio');
  }

  /** Lettera comparsa nel prompt: l'effetto è iniziato (incantesimo o pozione). */
  onFlagAppear(nome: string): void {
    // Se c'è già un timer (da att o dal lancio appena visto) si tiene quello.
    if (this.timers.has(nome)) {
      this.castAt.set(nome, this.now());
      return;
    }
    this.start(nome, 'prompt');
  }

  private start(nome: string, fonte: 'lancio' | 'prompt'): void {
    const now = this.now();
    this.castAt.set(nome, now);
    const tick = this.tickInfo?.();
    if (tick) this.castTick.set(nome, tick);
    else this.castTick.delete(nome);
    const scatti = this.durations[nome + TICK_KEY];
    const learned = this.durations[nome];
    const fine =
      scatti && tick
        ? tick.prossimo + (scatti - 1) * tick.periodo
        : scatti
          ? now + (scatti - 0.5) * this.tickMs
          : learned
            ? now + learned
            : undefined;
    if (fine !== undefined) this.timers.set(nome, { nome, fine, fonte, avviso: false });
  }

  /**
   * Fine di un incantesimo (messaggio o lettera sparita dal prompt).
   * @param learn la fine cade sul tick: si può imparare la durata (falso per i dispel)
   */
  onEnd(nome: string, avviso: boolean, parziale = false, learn = true): void {
    // Un pezzo che finisce (immagine di mirror images) non chiude il timer.
    if (parziale) return;
    if (avviso) {
      const t = this.timers.get(nome);
      if (t) this.timers.set(nome, { ...t, avviso: true });
      return;
    }
    const cast = this.castAt.get(nome);
    if (cast !== undefined && learn) {
      const now = this.now();
      const ms = now - cast;
      const d = { ...this.durations };
      if (ms >= MIN_LEARN_MS) d[nome] = ms;
      // scatti del tick dal lancio alla fine (la fine cade su uno scatto)
      const t = this.castTick.get(nome);
      if (t && now >= t.prossimo - t.periodo / 4) {
        const scatti = Math.round((now - t.prossimo) / t.periodo) + 1;
        if (scatti >= 1) d[nome + TICK_KEY] = scatti;
      }
      if (
        d[nome] !== this.durations[nome] ||
        d[nome + TICK_KEY] !== this.durations[nome + TICK_KEY]
      ) {
        this.durations = d;
        this.onLearn?.(this.durations);
      }
    }
    this.castAt.delete(nome);
    this.castTick.delete(nome);
    this.timers.delete(nome);
  }
}

/**
 * Tempo residuo leggibile: `4:26`. A zero dice `a breve`: il timer è una stima e sparisce solo
 * quando l'incantesimo finisce davvero (messaggio di fine o lettera tolta dal prompt).
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'a breve';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
