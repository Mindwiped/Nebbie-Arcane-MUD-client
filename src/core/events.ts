import type { NebbieEvents } from '../nebbie/parser/types';
import type { ConnState, Span } from './types';

/** Valori letti dal prompt. Tutti opzionali: dipendono da come il giocatore ha impostato il prompt. */
export interface PromptData {
  nome?: string;
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  mv?: number;
  mvMax?: number;
  xp?: number;
  oro?: number;
  banca?: number;
  /** Iniziali degli incantesimi attivi tra parentesi quadre (es. `STM`). */
  affetti?: string;
  /** Condizione del tank e del bersaglio (es. `eccellente`, `graffiato`). */
  tank?: string;
  target?: string;
  /** Testo completo del prompt riconosciuto. */
  raw: string;
}

/**
 * Eventi del bus del client (vedi docs/SPECIFICA.md, 2.3): quelli generali qui, quelli del
 * testo di Nebbie (stanza, uccisioni, liste…) in `NebbieEvents`.
 */
export interface ClientEvents extends NebbieEvents {
  /** Riga completa del MUD (prompt esclusi). */
  line: { text: string; spans: Span[] };
  prompt: PromptData;
  /** Testo effettivamente inviato al MUD (mai le password). */
  commandSent: { text: string };
  status: { state: ConnState; message: string };
  /**
   * Un incantesimo sta per finire (`avviso`) o è finito, dal messaggio del MUD o dalla lettera
   * del prompt (vale anche per le pozioni). Non per le fini parziali (un'immagine distrutta).
   */
  spellWearOff: { nome: string; avviso: boolean };
  /** Inizio o fine di un combattimento (tank o bersaglio nel prompt). */
  combat: { inizio: boolean };
}
