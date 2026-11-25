/**
 * Esecutore di sequenze (SPECIFICA 5.1): manda una lista di comandi uno alla volta, il
 * successivo solo quando il prompt del precedente è arrivato, e decide per ogni passo se è
 * riuscito. Lo usano percorsi, cambio di set, riparazione, giro pozze, rilancio incantesimi.
 *
 * Non conosce Nebbie: gli eventi del MUD gli arrivano con `event()` e `prompt()`, e ogni
 * passo può avere un "giudice" che li guarda e, al prompt, dice com'è andata.
 */

export type Outcome =
  | { ok: true }
  | {
      ok: false;
      motivo: string;
      /** Comandi da mandare prima di ritentare il passo una volta (es. `open n` per una porta). */
      prima?: string[];
    };

export interface StepJudge {
  /** Un evento del MUD mentre il passo aspetta la sua risposta. */
  on(event: string, data: unknown): void;
  /** È arrivato il prompt: com'è andato il passo. */
  prompt(): Outcome;
}

export interface Step {
  cmd: string;
  /** Comando da provare una volta se il passo fallisce (es. `hold x` → `wear x`). */
  alt?: string;
  /** Cosa fare se fallisce: fermarsi (predefinito), saltarlo o ritentarlo N volte. */
  seFallisce?: 'ferma' | 'salta' | { ritenta: number };
  /** Senza giudice il passo riesce quando arriva il prompt. */
  judge?: () => StepJudge;
}

export interface SequenceSpec {
  nome: string;
  /** `percorso`, `vestiario`, `incantesimi`… (mostrato nella striscia e nei messaggi). */
  categoria: string;
  passi: Step[];
  /** Fermarsi se inizia un combattimento. */
  fermaInCombattimento?: boolean;
  /** Un passo alla volta: dopo ogni passo riuscito aspetta `next()` (richiesta del 2026-11-15). */
  passoPasso?: boolean;
  /** Attesa massima della risposta a un passo (ms); poi il passo conta come fallito. */
  attesaMax?: number;
  /** Chiamata quando l'ultimo passo è riuscito. */
  onFinish?: () => void;
  /** Chiamata se la sequenza viene chiusa senza finire (es. per rimettere a posto i contenitori). */
  onAbandon?: () => void;
}

export interface SequenceState {
  nome: string;
  categoria: string;
  /** Passo in corso (o da cui si riparte), contando da 1. */
  passo: number;
  totale: number;
  stato: 'corre' | 'pausa' | 'fermo';
  /** Perché si è fermata. */
  motivo?: string;
  /** Il passo fermo era fallito (si può saltare) e non solo interrotto. */
  fallito?: boolean;
  /** Un passo alla volta: in pausa aspetta il comando per il passo successivo. */
  passoPasso?: boolean;
}

export interface ExecutorHost {
  send(cmd: string): Promise<void>;
  info(text: string): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const DEFAULT_WAIT = 8000;

export class Executor {
  private spec: SequenceSpec | null = null;
  private steps: Step[] = [];
  private index = 0;
  private stato: SequenceState['stato'] = 'corre';
  private motivo: string | undefined;
  private fallito = false;
  /** Il passo `index` è stato mandato e se ne aspetta il prompt. */
  private waiting = false;
  private judge: StepJudge | null = null;
  private timer: unknown;
  /** Tentativi già fatti per il passo attuale (ritenta, alternativa, comandi `prima`). */
  private tries = 0;
  private altUsed = false;
  private primaUsed = false;
  /** Comando effettivamente mandato per il passo attuale (può essere l'alternativa). */
  private sentCmd = '';
  private stepMode = false;

  /** Chiamata a ogni cambio di stato (l'interfaccia lo mostra). */
  onChange?: (state: SequenceState | null) => void;

  constructor(private readonly host: ExecutorHost) {}

  get state(): SequenceState | null {
    if (!this.spec) return null;
    return {
      nome: this.spec.nome,
      categoria: this.spec.categoria,
      passo: Math.min(this.index + 1, this.steps.length),
      totale: this.steps.length,
      stato: this.stato,
      ...(this.motivo ? { motivo: this.motivo } : {}),
      ...(this.fallito ? { fallito: true } : {}),
      ...(this.stepMode ? { passoPasso: true } : {}),
    };
  }

  /** Una sequenza sta correndo o è in pausa (una ferma non conta: se ne può avviare un'altra). */
  get busy(): boolean {
    return this.spec !== null && this.stato !== 'fermo';
  }

  /**
   * Gli automatismi (rilanci, loot, regole) devono aspettare: la sequenza corre o un passo aspetta
   * la sua risposta. In pausa tra un passo e l'altro ("un passo alla volta", o pausa chiesta)
   * no: lì si combatte e si fa loot (log reale del 2026-11-18: tutto in coda fino alla fine del
   * percorso, poi partito insieme).
   */
  get blocking(): boolean {
    return this.busy && (this.stato === 'corre' || this.waiting);
  }

  start(spec: SequenceSpec): boolean {
    if (this.busy || spec.passi.length === 0) return false;
    // Una sequenza ferma che deve rimettere a posto qualcosa lo fa prima (e occupa l'esecutore).
    if (this.spec?.onAbandon) {
      this.close();
      if (this.busy) return false;
    }
    this.host.clearTimeout(this.timer);
    this.spec = spec;
    this.steps = [...spec.passi];
    this.index = 0;
    this.stato = 'corre';
    this.motivo = undefined;
    this.fallito = false;
    this.waiting = false;
    this.stepMode = spec.passoPasso === true;
    this.resetTries();
    this.changed();
    void this.sendCurrent();
    return true;
  }

  /** Evento del MUD (stanza, passo fallito, riga…): va al giudice del passo in attesa. */
  event(name: string, data: unknown): void {
    if (this.waiting) this.judge?.on(name, data);
  }

  /** È arrivato un prompt. */
  prompt(info: { inCombattimento: boolean }): void {
    if (!this.spec || !this.waiting) return;
    this.waiting = false;
    this.host.clearTimeout(this.timer);
    const out = this.judge?.prompt() ?? { ok: true };
    this.judge = null;
    const before = this.index;
    if (out.ok) this.advance();
    else if (!this.retry(out)) {
      this.halt(
        `fermo al passo ${this.index + 1}/${this.steps.length} (${this.sentCmd}): ${out.motivo}`,
        true,
      );
      return;
    }
    if (!this.spec) return;
    if (this.spec.fermaInCombattimento && info.inCombattimento && this.stato === 'corre') {
      this.halt(`fermo al passo ${this.index + 1}/${this.steps.length}: combattimento`);
      return;
    }
    // Un passo alla volta: passo riuscito (o saltato) → si aspetta `next()`. Un ritentativo
    // dello stesso passo (porta, alternativa) fa parte dello stesso passo e continua.
    if (this.stato === 'corre' && this.stepMode && this.index !== before) {
      this.stato = 'pausa';
      this.changed();
      return;
    }
    if (this.stato === 'corre') void this.sendCurrent();
    else this.changed();
  }

  /** Un passo alla volta: manda il passo successivo. */
  next(): void {
    if (!this.spec || this.waiting || this.stato !== 'pausa') return;
    this.stato = 'corre';
    this.motivo = undefined;
    this.changed();
    void this.sendCurrent();
  }

  /** Accende o spegne il "un passo alla volta" sulla sequenza in corso. */
  setStepMode(on: boolean): void {
    if (!this.spec || this.stepMode === on) return;
    this.stepMode = on;
    this.host.info(`${this.label()}: ${on ? 'un passo alla volta' : 'tutti i passi di fila'}.`);
    this.changed();
    if (!on && this.stato === 'pausa') this.resume();
  }

  pause(): void {
    if (this.spec && this.stato === 'corre') {
      this.stato = 'pausa';
      this.host.info(`${this.label()}: in pausa.`);
      this.changed();
    }
  }

  /** Riparte da una pausa o da uno stop, dal passo in cui si era fermata. */
  resume(): void {
    if (!this.spec || this.stato === 'corre') return;
    this.stato = 'corre';
    this.motivo = undefined;
    this.fallito = false;
    this.host.info(`${this.label()}: riprende dal passo ${this.index + 1}/${this.steps.length}.`);
    this.changed();
    // Fermata mentre un passo aspettava la risposta: si aspetta ancora quella.
    if (this.waiting) this.armTimer();
    else void this.sendCurrent();
  }

  /** Salta il passo fallito e riprende dal successivo. */
  skip(): void {
    if (!this.spec || this.stato !== 'fermo' || this.waiting) return;
    this.index += 1;
    this.resetTries();
    if (this.index >= this.steps.length) return this.finish();
    this.resume();
  }

  /** Ferma la sequenza (resta visibile e riprendibile). Restituisce false se non ce n'era una. */
  stop(reason = 'fermato'): boolean {
    if (!this.spec) return false;
    if (this.stato === 'fermo') return true;
    this.halt(`${reason} al passo ${this.index + 1}/${this.steps.length}`);
    return true;
  }

  /** Toglie la sequenza (ferma o no); se non era finita, chiama il suo `onAbandon`. */
  close(): void {
    const spec = this.spec;
    this.drop();
    spec?.onAbandon?.();
  }

  private drop(): void {
    this.host.clearTimeout(this.timer);
    this.spec = null;
    this.waiting = false;
    this.judge = null;
    this.changed();
  }

  private label(): string {
    return this.spec ? `${capital(this.spec.categoria)} ${this.spec.nome}` : '';
  }

  private changed(): void {
    this.onChange?.(this.state);
  }

  private resetTries(): void {
    this.tries = 0;
    this.altUsed = false;
    this.primaUsed = false;
  }

  private async sendCurrent(): Promise<void> {
    const spec = this.spec;
    const step = this.steps[this.index];
    if (!spec || !step || this.waiting) return;
    const cmd = this.altUsed && step.alt ? step.alt : step.cmd;
    this.sentCmd = cmd;
    this.judge = step.judge?.() ?? null;
    this.waiting = true;
    this.changed();
    try {
      await this.host.send(cmd);
    } catch (e) {
      this.waiting = false;
      this.halt(`comando non inviato: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (this.spec !== spec || !this.waiting) return;
    this.armTimer();
  }

  /** Se la risposta al passo non arriva entro l'attesa massima, il passo conta come fallito. */
  private armTimer(): void {
    const spec = this.spec;
    if (!spec) return;
    this.host.clearTimeout(this.timer);
    this.timer = this.host.setTimeout(() => {
      if (this.spec !== spec || !this.waiting) return;
      this.waiting = false;
      this.judge = null;
      const secondi = Math.round((spec.attesaMax ?? DEFAULT_WAIT) / 1000);
      this.halt(
        `fermo al passo ${this.index + 1}/${this.steps.length} (${this.sentCmd}): ` +
          `nessuna risposta in ${secondi} s`,
        true,
      );
    }, spec.attesaMax ?? DEFAULT_WAIT);
  }

  /** Passo fallito: prova i rimedi previsti. Restituisce false se bisogna fermarsi. */
  private retry(out: Extract<Outcome, { ok: false }>): boolean {
    const step = this.steps[this.index];
    if (out.prima?.length && !this.primaUsed) {
      this.primaUsed = true;
      this.host.info(`${this.label()}: ${out.motivo}, provo con ${out.prima.join(', ')}.`);
      this.steps.splice(this.index, 0, ...out.prima.map((cmd) => ({ cmd })));
      return true;
    }
    if (step.alt && !this.altUsed) {
      this.altUsed = true;
      this.host.info(`${this.label()}: ${step.cmd} non riuscito, provo con ${step.alt}.`);
      return true;
    }
    const sf = step.seFallisce ?? 'ferma';
    if (typeof sf === 'object' && this.tries < sf.ritenta) {
      this.tries += 1;
      this.host.info(`${this.label()}: ${out.motivo}, ritento (${this.tries}/${sf.ritenta}).`);
      return true;
    }
    if (sf === 'salta') {
      this.host.info(`${this.label()}: ${this.sentCmd} saltato (${out.motivo}).`);
      this.advance();
      return true;
    }
    return false;
  }

  private advance(): void {
    // I comandi `prima` sono passi inseriti: dopo di loro si ritenta il passo originale.
    this.index += 1;
    if (!this.primaUsed || this.steps[this.index - 1].judge) this.resetTries();
    if (this.index >= this.steps.length) this.finish();
  }

  private finish(): void {
    const spec = this.spec;
    this.drop();
    if (!spec) return;
    this.host.info(`${capital(spec.categoria)} ${spec.nome} finito.`);
    spec.onFinish?.();
  }

  private halt(motivo: string, fallito = false): void {
    this.host.clearTimeout(this.timer);
    this.stato = 'fermo';
    this.motivo = motivo.replace(/\.+$/, '');
    this.fallito = fallito;
    this.host.info(`${this.label()}: ${this.motivo}.`);
    this.changed();
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
