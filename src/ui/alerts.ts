import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { ALERT_LABELS, type AlertKind, type Settings } from '../core/settings';

/**
 * Avvisi dell'interfaccia (Fase 6): un suono breve generato al volo (niente file audio) e una
 * notifica di sistema quando la finestra non è in primo piano. Cosa avvisa e come lo decidono
 * le impostazioni.
 */

/** Note (Hz) e durata di ogni suono: riconoscibili a orecchio. */
const TONES: Record<AlertKind, { note: number[]; ms: number }> = {
  furto: { note: [880, 660, 880, 660], ms: 110 },
  terra: { note: [330, 220], ms: 140 },
  tell: { note: [660, 990], ms: 90 },
  gruppo: { note: [520], ms: 80 },
  hp: { note: [440, 440, 440], ms: 120 },
  disconnesso: { note: [600, 400, 250], ms: 160 },
};

/** Stesso avviso più vicino di così: uno solo (es. tanti tell di fila). */
const SAME_ALERT_MS = 2500;

export class Alerter {
  private audio: AudioContext | null = null;
  private last = new Map<AlertKind, number>();
  private permission: boolean | null = null;

  constructor(private settings: () => Settings) {}

  alert(kind: AlertKind, testo: string): void {
    const s = this.settings();
    const choice = s.avvisi[kind];
    const now = Date.now();
    if (now - (this.last.get(kind) ?? 0) < SAME_ALERT_MS) return;
    this.last.set(kind, now);
    if (s.suoni && choice.suono) this.play(kind);
    if (s.notifiche && choice.notifica && !document.hasFocus()) void this.notify(kind, testo);
  }

  /** Suono di prova (impostazioni). */
  play(kind: AlertKind): void {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const { note, ms } = TONES[kind];
      let t = ctx.currentTime;
      for (const f of note) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + ms / 1000 + 0.02);
        t += ms / 1000 + 0.03;
      }
    } catch {
      // audio non disponibile: niente suono
    }
  }

  private async notify(kind: AlertKind, testo: string): Promise<void> {
    try {
      if (this.permission === null) {
        this.permission = await isPermissionGranted();
        if (!this.permission) this.permission = (await requestPermission()) === 'granted';
      }
      if (!this.permission) return;
      sendNotification({ title: `Nebbie: ${ALERT_LABELS[kind]}`, body: testo.slice(0, 200) });
    } catch {
      // notifiche non disponibili: resta il suono
    }
  }
}
