/** Direzioni brevi usate in tutto il client (come nel mapper Mudlet). */
export type Dir = 'n' | 's' | 'e' | 'w' | 'u' | 'd' | 'ne' | 'nw' | 'se' | 'sw';

export interface RoomEvent {
  titolo: string;
  /** Righe di descrizione dopo il titolo (rumore compreso: il mapper decide cosa usare). */
  righeDescrizione: string[];
  /** Uscite della riga `Uscite:` (le porte chiuse non ci sono). */
  uscite: Dir[];
  usciteRiga: string;
  /** Righe `Dir - Nome stanza` di "Uscite visibili" (porte chiuse comprese). */
  visibili: { dir: Dir; nome: string }[];
  /** Mob e oggetti tra `Uscite:` e "Uscite visibili". */
  contenuti: string[];
  /** Stanza guardata con `look <dir>` o "Guardando…": non è un cambio di stanza. */
  guardata: boolean;
  /** Fermata di un mezzo di trasporto vista in questa stanza (diligenza, mongolfiera). */
  fermata?: { mezzo: 'diligenza' | 'mongolfiera'; fermata: string };
}

export interface ItemRow {
  pos: number;
  /** Solo per l'equipaggiamento: `come luce`, `sul dito destro`… */
  slot?: string;
  nome: string;
  /** Es. `in condizioni eccellenti`. */
  condizione?: string;
  /** Altre note tra parentesi: `ha un alone luminoso`, `invisibile`… */
  note: string[];
  quantita: number;
}

/** Dati del comando `score` (campi assenti se la riga non c'era). */
export interface ScoreEvent {
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  mv?: number;
  mvMax?: number;
  /** Esperienza totale. */
  exp?: number;
  /** Monete d'oro in tasca. */
  monete?: number;
  /** Livelli per classe, es. `{ M: 51, K: 51 }`. */
  livelli?: Record<string, number>;
  /** Esperienza al prossimo livello per classe (negativa = già superato). */
  prossimoLivello?: Record<string, number>;
  /** Es. `in piedi`. */
  posizione?: string;
}

/** Eventi prodotti dal parser di Nebbie (si aggiungono al bus del client). */
export interface NebbieEvents {
  room: RoomEvent;
  moveFailed: { motivo: 'muro' | 'porta' | 'fineRun'; testo: string };
  /** Una porta aperta o chiusa, da te (`chi` assente) o da un altro. */
  door: { azione: 'aperta' | 'chiusa'; chi?: string };
  mobKilled: { nome: string; volte: number };
  /** A terra: bash subito o disarm fallito (testi dei trigger Mudlet, verificati in gioco). */
  /** A terra: bash subito, disarm o finger fallito, o uno `stand` non riuscito ("Stai ancora annaspando"). */
  knockedDown: { causa: 'bash' | 'disarm' | 'finger' | 'ancora'; testo: string };
  xpGained: { punti: number; nemici?: number };
  goldLooted: { monete: number };
  spellCast: { nome: string };
  /**
   * Fine di un incantesimo. `avviso`: sta per finire ("vacilla"). `parziale`: ne finisce solo
   * un pezzo (un'immagine di mirror images distrutta in combattimento), non è una scadenza.
   */
  affectEnd: { nome: string; avviso: boolean; parziale?: boolean };
  achievement: { tipo: string; numero: number; nome: string; valore: number; totale: number };
  equipmentList: { righe: ItemRow[] };
  inventoryList: { righe: ItemRow[] };
  containerList: { titolo: string; righe: ItemRow[] };
  transportStop: { mezzo: 'diligenza' | 'mongolfiera'; fermata: string; prossima?: string };
  score: ScoreEvent;
  /** Sezione "Spells attivi" di `att`: durata residua (unità da verificare: tick?). */
  affectsList: { incantesimi: { nome: string; durata: number }[] };
}
