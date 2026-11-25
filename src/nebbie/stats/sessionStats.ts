/**
 * Statistiche di sessione: esperienza guadagnata, XP/h, mob uccisi, monete raccolte, durata.
 *
 * L'esperienza viene dalla X del prompt quando c'è: su Nebbie X = 400.000.000 − esperienza
 * totale, quindi quando X scende l'esperienza è salita della stessa quantità (vedi
 * docs/PROTOCOLLO_NEBBIE.md). Se il prompt non mostra X si sommano i messaggi
 * "La tua esperienza e' aumentata…" / "Hai ucciso N nemici e guadagnato…".
 */
export interface StatsSnapshot {
  inizio: number;
  xp: number;
  /** Esperienza persa (X salita: morte, donazioni…). */
  xpPersa: number;
  uccisi: number;
  monete: number;
  perMob: Record<string, number>;
  /** Oro in tasca dal prompt (gruppo `oro`), e quello all'inizio della sessione. */
  oro?: number;
  oroIniziale?: number;
}

export class SessionStats {
  private s: StatsSnapshot;
  private lastX: number | undefined;
  private promptHasX = false;

  constructor(private readonly now: () => number = Date.now) {
    this.s = SessionStats.empty(now());
  }

  static empty(inizio: number): StatsSnapshot {
    return { inizio, xp: 0, xpPersa: 0, uccisi: 0, monete: 0, perMob: {} };
  }

  get snapshot(): StatsSnapshot {
    return { ...this.s, perMob: { ...this.s.perMob } };
  }

  reset(): void {
    const oro = this.s.oro;
    this.s = SessionStats.empty(this.now());
    if (oro !== undefined) {
      this.s.oro = oro;
      this.s.oroIniziale = oro;
    }
    // L'ultima X resta: il prossimo prompt continua a contare da lì.
  }

  onPromptX(x: number | undefined): void {
    if (x === undefined) return;
    this.promptHasX = true;
    if (this.lastX !== undefined) {
      const delta = this.lastX - x;
      if (delta > 0) this.s.xp += delta;
      else if (delta < 0) this.s.xpPersa += -delta;
    }
    this.lastX = x;
  }

  /** Messaggi di esperienza del MUD: usati solo se il prompt non mostra X. */
  onXpMessage(punti: number): void {
    if (!this.promptHasX) this.s.xp += punti;
  }

  onKill(nome: string, volte: number): void {
    this.s.uccisi += volte;
    this.s.perMob[nome] = (this.s.perMob[nome] ?? 0) + volte;
  }

  /** Oro in tasca letto dal prompt. */
  onPromptGold(oro: number | undefined): void {
    if (oro === undefined) return;
    this.s.oro = oro;
    this.s.oroIniziale ??= oro;
  }

  onGold(monete: number): void {
    this.s.monete += monete;
  }
}

/** Esperienza all'ora dalla durata della sessione (0 nei primi secondi). */
export function xpPerHour(s: StatsSnapshot, now: number): number {
  const hours = (now - s.inizio) / 3_600_000;
  return hours > 1 / 360 ? s.xp / hours : 0;
}

/** Durata leggibile: `1:05:09` o `5:09`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Numero con i punti delle migliaia, come li scrive il MUD. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('it-IT');
}
