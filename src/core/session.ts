import {
  compilePromptRegex,
  DEFAULT_PROMPT_REGEX,
  splitPrompts,
} from '../nebbie/prompt/promptParser';
import { AutoLogin, type LoginAction } from '../nebbie/login/autoLogin';
import { NebbieParser } from '../nebbie/parser/nebbieParser';
import type { RoomEvent } from '../nebbie/parser/types';
import {
  allPaths,
  compactPath,
  emptyPathsFile,
  expandPath,
  findPaths,
  groupByZone,
  newPathId,
  type PathEntry,
  type PathsFile,
} from '../nebbie/paths/paths';
import { pathJudge } from '../nebbie/paths/moves';
import { Mapper } from '../nebbie/map/mapper';
import type { MapData } from '../nebbie/map/model';
import { PathRecorder, type RecordingState } from '../nebbie/paths/recorder';
import { Executor, type SequenceState } from './sequence/executor';
import { AffectTimers, type AffectTimer } from '../nebbie/affects/affectTimers';
import { msToNextTick, TickClock, type TickSnapshot } from '../nebbie/affects/tickClock';
import { SessionStats, formatNumber, type StatsSnapshot } from '../nebbie/stats/sessionStats';
import { TheftAlarm } from '../nebbie/stats/theftAlarm';
import { parseAffectFlags, type AffectFlag } from '../nebbie/prompt/affectFlags';
import { newAccount, type Account, type Profile } from '../nebbie/profiles/profiles';
import {
  DEFAULT_TABLE,
  expandSpell,
  importAll,
  parseAllRow,
  type AllRow,
  type SpellTable,
} from '../nebbie/spells/abbreviations';
import { Gear, type GearState } from '../nebbie/gear/gear';
import type { GearConfig } from '../nebbie/gear/config';
import { KeepActive } from '../nebbie/keep/keepActive';
import type { AutoConfig } from '../nebbie/keep/autoConfig';
import { RulesEngine, type Rule } from './rules/rules';
import { AutomationEngine, type TriggerFire } from './automation/engine';
import type { AutomationFile, Trigger } from './automation/model';
import { errorMessage, type Backend } from './backend';
import { parseInput } from './commandParser';
import { WordCompleter } from './completion';
import { EventBus } from './eventBus';
import type { ClientEvents } from './events';
import { History } from './history';
import { OutputBuffer, type OutLine } from './outputBuffer';
import type { AlertKind } from './settings';
import { ScriptHost, type ScriptsFile, type WorkerLike } from './scripts/scripts';
import { concatSpans, plainSpans, spansText } from './spans';
import type { ConnState, ServerEvent, Span, WireLine } from './types';
import { emptyVitals, updateVitals, type Vitals } from './vitals';
import { cleanName, IdentifyReader } from '../nebbie/relics/reliquiario';
import { RelicStore } from '../nebbie/relics/store';

/** Stato mostrato dall'interfaccia. Nell'app è un oggetto `$state` di Svelte. */

/**
 * Loot del cadavere (log reali): "Prendi gold coins da il corpo di il goblin alchimista.",
 * "Prendi gold coins da a pile of dust and bones."; comandi `get all.coin corp|dust`.
 */
const LOOT_REPLY =
  /^Prendi .+ da (?:il |lo |la |l'|i |gli |le |a |an? )?(?:corpo|resti|cadavere|pile of dust)/i;
const LOOT_CMD = /^(?:get|prendi)\s.*\b(?:corp\w*|cadavere|dust|resti)\b/i;

/** Le monete contate entro questo tempo dalla riga del loot vengono dal cadavere. */
const LOOT_GOLD_MS = 2000;

/** Messaggi privati e al gruppo (log reali: "[Nome] ti dice '…'", "[Nome] dice al gruppo '…'"). */
const TELL = /^\[([^\]]+)\] (?:ti dice|(dice al gruppo)) '/;

/** Di nuovo in piedi (log reali: "Ti alzi.", "Sei in piedi.", "Sei gia' in piedi."). */
const RIALZATO = /^(?:Ti alzi|Sei (?:gia' )?in piedi)\.\s*$/;

/** Effetti che finiscono anche per un'azione, non solo sul tick (attaccare, colpi ricevuti). */
const BREAKABLE = new Set(['invisibility', 'improved invisibility', 'mirror images']);

/** Attesa massima delle risposte agli automatismi prima del passo successivo. */
const NEXT_AFTER_AUTO_MS = 8000;
/** Un prompt prima di tanto dall'invio non è la risposta (nessun MUD risponde così in fretta). */
const AUTO_REPLY_MIN_MS = 40;

export interface SessionState {
  conn: ConnState;
  replaying: boolean;
  /** Script utente accesi (id). */
  scriptAttivi: string[];
  /** Il server nasconde l'input: si sta scrivendo la password. */
  password: boolean;
  vitals: Vitals;
  /** Nome letto dal prompt (può differire dal profilo se si entra con un altro pg). */
  promptName?: string;
  /** Effetti attivi dalle lettere del prompt (`[FsTM]`), se il prompt le mostra. */
  affetti?: AffectFlag[];
  /** Monete in tasca dall'ultimo prompt (se il prompt le mostra). */
  oro?: number;
  /** Condizione del tank e del bersaglio dal prompt (assenti = nessuno). */
  tank?: string;
  target?: string;
  /** Ultima stanza in cui si è entrati (non quelle guardate con `look <dir>`). */
  room?: RoomEvent;
  /** Incantesimi attivi dall'ultimo `att`, con l'ora in cui è stato letto. */
  att?: { incantesimi: { nome: string; durata: number }[]; letto: number };
  /** Statistiche della sessione (XP, mob uccisi, monete…). */
  stats: StatsSnapshot;
  /** Timer degli incantesimi attivi, in ordine di scadenza. */
  timers: AffectTimer[];
  /** Fase e durata del tick, ricavate dalle scadenze degli incantesimi. */
  tick: TickSnapshot;
  /** Sequenza in corso o ferma (percorso, cambio di set…), se c'è. */
  sequence?: SequenceState;
  /** Registrazione di un percorso in corso (`rec`). */
  recording?: RecordingState;
  /** Cresce quando cambia l'elenco dei percorsi (per i pannelli). */
  pathsVersion: number;
  /** Moduli con interruttore: id → acceso (fabbro, mantieni, regole). */
  modules: Record<string, boolean>;
  /** Automatismi: rilanci in attesa e ultime azioni (per il pannello). */
  auto: AutoState;
  /** Mappa: cresce a ogni cambio (il pannello ridisegna), stanza attuale. */
  map: { versione: number; cur?: number };
  /** Vestiario: modello dell'equipaggiamento, set attuale, fabbro (per il pannello). */
  gear?: GearState;
  /** Reliquiario: cartella di identi.js (vuota = spento), oggetti, errore di lettura. */
  relics: { cartella: string; versione: number; oggetti: number; errore?: string };
}

export interface AutoState {
  /** Cresce a ogni cambio di configurazione (il pannello la rilegge). */
  versione: number;
  attesa: { nome: string; motivo: string; tentativi: number }[];
  azioni: { ora: number; testo: string }[];
}

export function initialState(): SessionState {
  return {
    conn: 'disconnected',
    replaying: false,
    scriptAttivi: [],
    password: false,
    vitals: emptyVitals(),
    stats: SessionStats.empty(Date.now()),
    timers: [],
    tick: new TickClock().snapshot,
    pathsVersion: 0,
    modules: { fabbro: false, mantieni: false, regole: false },
    auto: { versione: 0, attesa: [], azioni: [] },
    map: { versione: 0 },
    relics: { cartella: '', versione: 0, oggetti: 0 },
  };
}

/**
 * Sessione di gioco: riceve gli eventi del backend, separa i prompt, riempie l'output,
 * aggiorna lo stato e pubblica gli eventi sul bus. Non contiene nulla di un personaggio
 * specifico: tutto viene dal profilo attivo.
 */
export class Session {
  readonly bus = new EventBus<ClientEvents>();
  readonly output = new OutputBuffer();
  readonly history = new History();
  readonly completer = new WordCompleter();
  /** Parser del testo di Nebbie: trasforma le righe in eventi sul bus. */
  private readonly parser = new NebbieParser((event, data) =>
    // Gli eventi del parser sono un sottoinsieme di ClientEvents.
    this.bus.emit(event, data as ClientEvents[typeof event]),
  );

  private profile: Profile | null = null;
  private account: Account = newAccount();
  private passwordSaved = false;
  private autoLogin: AutoLogin | null = null;
  private readonly stats = new SessionStats();
  private readonly theft = new TheftAlarm();
  private readonly tick = new TickClock();
  /** Lettere degli effetti al prompt precedente (null = nessun riferimento ancora). */
  private prevFlags: Map<string, AffectFlag> | null = null;
  private timers = new AffectTimers({}, Date.now, undefined, (d) => this.onDurationsLearned?.(d));
  /** Percorsi: file dell'utente ed elenco completo (pacchetto + utente). */
  private pathsFile: PathsFile = emptyPathsFile();
  private paths: PathEntry[] = allPaths(this.pathsFile);
  /** Esecutore delle sequenze di comandi (percorsi e, in seguito, set, riparazioni…). */
  readonly executor: Executor;
  private recorder: PathRecorder | null = null;
  /** `vai` lontano dalla stanza di partenza: ripetuto entro 15 s parte comunque. */
  private forceStart: { id: string; until: number } | null = null;
  /** Chiamata quando cambiano i percorsi, i preferiti o l'ultimo uso (l'app li salva). */
  onPathsChanged?: (file: PathsFile) => void;
  /** Ultimo elenco numerato mostrato da `percorsi` o `vai` (per `vai <numero>`). */
  private lastListing: PathEntry[] = [];
  /** Alias e trigger dell'utente. */
  private readonly automation = new AutomationEngine();
  /** Automatismi (SPECIFICA 5.4): incantesimi da mantenere e regole sullo stato. */
  readonly keep: KeepActive;
  readonly rules: RulesEngine;
  private autoCfg: AutoConfig | null = null;
  private onAutoSave?: (cfg: AutoConfig) => void;
  /** Mapper automatico (SPECIFICA 4). */
  readonly mapper = new Mapper();
  /** L'interfaccia chiede in che zona registrare (interruttore MAPPER acceso). */
  onAskMapZone?: () => void;
  /** Chiamata quando la mappa cambia (l'app la salva qualche secondo dopo). */
  onMapChanged?: (data: MapData) => void;
  private mapVersion = 0;
  /** Comandi di automatismi arrivati mentre girava una sequenza: partono dopo. */
  private autoQueue: { label: string; raw: string }[] = [];
  /** Comandi di automatismi mandati che aspettano ancora il loro prompt. */
  private autoInFlight = 0;
  /** Ultima riga "Prendi … da il corpo": le monete contate subito dopo vengono dal cadavere. */
  private lootAt = 0;
  /**
   * Ora dell'ultimo comando automatico: un prompt arrivato insieme alla riga che l'ha fatto
   * partire (fine di un incantesimo e prompt nello stesso blocco) non è la sua risposta.
   */
  private autoSentAt = 0;
  /** Passo successivo chiesto mentre gli automatismi aspettavano risposta: parte dopo. */
  private nextAfterAuto: ReturnType<typeof setTimeout> | null = null;
  /** Vestiario: equipaggiamento, set, cambio di set e riparazione (SPECIFICA 5.3). */
  readonly gear: Gear;
  /** Reliquiario: identi.js nella cartella scelta dall'utente (l'app collega lettura e scrittura). */
  readonly relics: RelicStore;
  relicIo: {
    read(cartella: string): Promise<string | null>;
    write(cartella: string, testo: string): Promise<void>;
    readMobs?(cartella: string): Promise<string | null>;
  } = {
    read: async () => null,
    write: async () => {},
  };
  private readonly identify: IdentifyReader;
  /**
   * Identify in gioco salvato: l'interfaccia chiede se l'oggetto sta in un contenitore
   * (richiesta dell'utente del 2026-11-17).
   */
  onAskRelicContainer?: (oggetto: { chiave: string; nome: string; contenitore?: string }) => void;
  /** Apre la finestra di importazione degli identify (la gestisce l'app). */
  openRelicImport?: () => void;
  /** Chiamata quando un trigger viene spento perché scattava di continuo (l'app lo salva). */
  onTriggerDisabled?: (trigger: Trigger) => void;
  /** Chiamata quando si impara la durata di un incantesimo (l'app la salva per il profilo). */
  onDurationsLearned?: (durations: Record<string, number>) => void;
  /** Massimi HP/MP/MV letti dall'ultimo `score`. */
  private scoreMax: Partial<Record<'hp' | 'mp' | 'mv', number>> = {};
  private loginHintShown = false;
  private promptRe = compilePromptRegex(DEFAULT_PROMPT_REGEX);
  /** Riga parziale non riconosciuta come prompt: verrà riunita al suo seguito. */
  private pending: { spans: Span[]; line: OutLine } | null = null;
  private lastPrompt: OutLine | null = null;
  /** Script utente (Fase 5): ognuno nel suo Web Worker, con l'API `nebbie`. */
  readonly scripts: ScriptHost;
  scriptsFile: ScriptsFile = { versione: 1, script: [] };
  /** Crea il worker di uno script (nei test se ne usa uno finto). */
  createScriptWorker: (source: string) => WorkerLike = (source) =>
    new Worker(
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
    ) as unknown as WorkerLike;
  /** Abbreviazioni degli incantesimi (abbreviazioni.json, modificabili dall'utente). */
  spells: SpellTable = { ...DEFAULT_TABLE };
  /** Chiamata quando gli script cambiano (l'app li salva). */
  onScriptsChanged?: (f: ScriptsFile) => void;
  /** Chiamata quando la tabella delle abbreviazioni cambia (l'app la salva). */
  onSpellsChanged?: (t: SpellTable) => void;
  /** Righe dell'ultimo elenco `ALL` visto nell'output (per l'importazione). */
  allRows = new Map<string, AllRow>();
  /** Avvisi per l'interfaccia (suono, notifica di sistema): l'app decide cosa farne. */
  onAlert?: (tipo: AlertKind, testo: string) => void;
  /** Soglia degli HP bassi in percento del massimo (dalle impostazioni). */
  alertHp = 30;
  private hpLow = false;
  /** Disconnessione chiesta dall'utente: non è un collegamento perso. */
  private userDisconnect = false;
  /** Riga del MUD che il parser sta leggendo (per colorarne lo sfondo). */
  private lineInParse: OutLine | null = null;
  /** Finito a terra: il prossimo "Ti alzi." o `stand` avrà lo sfondo verde. */
  private down = false;
  /** In combattimento all'ultimo prompt (per l'evento `combat`). */
  private fighting = false;

  constructor(
    private readonly backend: Backend,
    readonly state: SessionState,
  ) {
    this.scripts = new ScriptHost({
      createWorker: (src) => this.createScriptWorker(src),
      send: (nome, raw) => this.autoSend(`⚙ Script ${nome}`, raw),
      echo: (nome, text) => this.system(`[Script ${nome}] ${text}`),
      error: (nome, text) => this.error(`[Script ${nome}] ${text}`),
      now: () => Date.now(),
      state: () => this.scriptState(),
    });
    this.scripts.onChange = () => (this.state.scriptAttivi = this.scripts.runningIds);
    // Statistiche di sessione.
    const syncStats = () => (this.state.stats = this.stats.snapshot);
    this.bus.on('xpGained', ({ punti }) => (this.stats.onXpMessage(punti), syncStats()));
    this.bus.on('mobKilled', ({ nome, volte }) => (this.stats.onKill(nome, volte), syncStats()));
    this.bus.on('goldLooted', ({ monete }) => (this.stats.onGold(monete), syncStats()));
    this.bus.on('prompt', (p) => {
      this.stats.onPromptX(p.xp);
      this.stats.onPromptGold(p.oro);
      syncStats();
      if (p.oro !== undefined) {
        const alert = this.theft.onGold(p.oro);
        if (alert) {
          const msg =
            `[FURTO?] ti mancano ${formatNumber(alert.mancano)} monete di tasca ` +
            `(da ${formatNumber(alert.da)} a ${formatNumber(alert.a)})`;
          this.alarm(msg);
          this.onAlert?.('furto', msg);
        }
      }
    });
    this.bus.on('commandSent', ({ text }) => {
      if (LOOT_CMD.test(text.trim())) this.keep.lootSent();
      this.theft.onCommand();
      this.recorder?.command(text);
      this.mapper.command(text);
    });
    // Mapper: comandi, stanze, passi falliti, porte; il prompt chiude il comando.
    this.mapper.onChange = (salva) => {
      this.state.map = { versione: ++this.mapVersion, cur: this.mapper.cur ?? undefined };
      if (salva) this.onMapChanged?.(this.mapper.data);
    };
    this.mapper.onInfo = ({ text }) => this.system(`[Mappa] ${text}`);
    // Marcatura delle stanze identiche: monete posate una alla volta (un drop di più monete
    // diventa un mucchio che non dice il numero). Mai in mezzo a una sequenza: si è già altrove.
    this.mapper.onMark = (n) => {
      if (this.state.conn !== 'connected' || this.state.password) return false;
      if (this.executor.blocking) {
        this.system(
          '[Mappa] non marco la stanza durante un percorso: lo farò alla prossima visita.',
        );
        return false;
      }
      void this.sendLabelled(
        `⚙ Mappa: marco la stanza con ${n} monete`,
        Array(n).fill('drop 1 coin'),
      );
      return true;
    };
    this.bus.on('room', (room) => this.mapper.room(room));
    this.bus.on('moveFailed', (f) => this.mapper.moveFailed(f));
    this.bus.on('door', (d) => this.mapper.door(d));
    this.bus.on('prompt', () => this.mapper.prompt());
    // Timer degli incantesimi.
    const syncTimers = () => (this.state.timers = this.timers.list);
    this.timers.tickInfo = () => {
      const now = Date.now();
      const left = msToNextTick(this.tick.snapshot, now);
      return left === undefined
        ? undefined
        : { prossimo: now + left, periodo: this.tick.snapshot.periodo };
    };
    this.bus.on('affectsList', ({ incantesimi }) => {
      const now = Date.now();
      this.tickFromAtt(incantesimi, now);
      const left = msToNextTick(this.tick.snapshot, now);
      const tick =
        left === undefined
          ? undefined
          : { prossimo: now + left, periodo: this.tick.snapshot.periodo };
      this.timers.onAtt(incantesimi, tick);
      syncTimers();
    });
    this.bus.on('spellCast', ({ nome }) => (this.timers.onCast(nome), syncTimers()));
    this.bus.on('affectEnd', ({ nome, avviso, parziale }) => {
      // Le scadenze vere (e gli avvisi) cadono sul tick del MUD; una fine fuori tempo è un
      // dispel: toglie il timer ma non sposta il tick e non insegna la durata.
      const onTick = !parziale && this.markTick();
      this.timers.onEnd(nome, avviso, parziale, onTick);
      syncTimers();
      if (!parziale) this.bus.emit('spellWearOff', { nome, avviso });
    });
    // Esecutore e registratore guardano stanze, passi falliti, porte e prompt.
    this.executor = new Executor({
      send: (cmd) => this.sendStep(cmd),
      info: (text) => this.system(text),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    this.executor.onChange = (st) => {
      this.state.sequence = st ?? undefined;
      // Finita (o fermata) una sequenza, partono gli automatismi rimasti in attesa.
      if (!this.executor.blocking) queueMicrotask(() => this.flushAuto());
    };
    this.gear = new Gear({
      bus: this.bus,
      executor: this.executor,
      info: (text, level = 'info') =>
        level === 'error' ? this.error(`[Vestiario] ${text}`) : this.system(`[Vestiario] ${text}`),
      connected: () => this.state.conn === 'connected',
      keywordsOf: (nome) => this.relicKeywords(nome),
    });
    this.gear.onChange = (g) => {
      this.state.gear = g;
      this.syncModuleState();
    };
    for (const ev of ['equipmentList', 'inventoryList', 'containerList'] as const)
      this.bus.on(ev, (d) => this.executor.event(ev, d));
    this.keep = new KeepActive({
      now: () => Date.now(),
      cast: (cmd, motivo) => this.autoSend(`⚙ Mantieni attivi: ${motivo}`, cmd),
      info: (t) => this.system(`[Mantieni attivi] ${t}`),
      busy: () => this.executor.blocking,
      ready: () => this.state.conn === 'connected' && !this.state.password,
      later: (fn, ms) => void setTimeout(fn, ms),
    });
    this.keep.onChange = () => this.syncAuto();
    this.relics = new RelicStore({
      read: (c) => this.relicIo.read(c),
      write: (c, t) => this.relicIo.write(c, t),
      readMobs: (c) => this.relicIo.readMobs?.(c) ?? Promise.resolve(null),
      info: (t, level) =>
        level === 'warn' ? this.error(`[Reliquiario] ${t}`) : this.system(`[Reliquiario] ${t}`),
      now: () => Date.now(),
    });
    this.relics.onChange = () =>
      (this.state.relics = {
        cartella: this.relics.cartella,
        versione: this.relics.versione,
        oggetti: Object.keys(this.relics.db.oggetti).length,
        errore: this.relics.errore,
      });
    this.identify = new IdentifyReader(
      () => Date.now(),
      (c, nome) =>
        void this.relics.identify(c, nome, this.pgName()).then((r) => {
          if (r) this.onAskRelicContainer?.(r);
        }),
    );
    this.bus.on('equipmentList', ({ righe }) => {
      const eq = righe
        .filter((r) => r.slot)
        .map((r) => ({ slot: r.slot!, nome: cleanName(r.nome) }));
      const pg = this.pgName();
      if (pg) void this.relics.equipment(pg, eq);
    });
    this.keep.onCostLearned = (costi) => {
      if (!this.autoCfg) return;
      this.autoCfg.costi = costi;
      this.onAutoSave?.(this.autoCfg);
    };
    this.rules = new RulesEngine({
      now: () => Date.now(),
      inCombat: () => this.fighting,
      run: (rule, soggetto) => this.runRule(rule, soggetto),
    });
    this.bus.on('spellWearOff', ({ nome, avviso }) => {
      this.scripts.event('incantesimoFinito', { nome, avviso });
      this.keep.wearOff(nome, avviso);
      if (!avviso) this.rules.event('effettoFinito', nome);
    });
    this.bus.on('spellCast', ({ nome }) => this.keep.spellCast(nome));
    // Log reali: "Prendi gold coins da il corpo di …" e subito "C'erano 10.000 monete.".
    this.bus.on('goldLooted', ({ monete }) => {
      if (monete <= 0 || Date.now() - this.lootAt > LOOT_GOLD_MS) return;
      this.lootAt = 0;
      this.rules.event('moneteCadavere', String(monete));
    });
    this.bus.on('mobKilled', ({ nome }) => {
      this.rules.event('mobUcciso', nome);
      this.mapper.mobSeen(nome); // solo mentre il mapper registra
      this.scripts.event('mobUcciso', { nome });
      this.keep.killed();
    });
    this.bus.on('knockedDown', ({ causa }) => {
      this.rules.event('atterrato', causa);
      this.scripts.event('aTerra', { causa });
      // sfondo rosso sulla riga dell'azione che ti ha mandato a terra (richiesta del 2026-11-15)
      if (this.lineInParse) this.output.setBackground(this.lineInParse, 'rosso');
      if (!this.down)
        this.onAlert?.('terra', this.lineInParse ? spansText(this.lineInParse.spans) : '');
      this.down = true;
    });
    this.bus.on('combat', ({ inizio }) => {
      this.scripts.event('combattimento', { inizio });
      this.rules.event(inizio ? 'combattimentoInizio' : 'combattimentoFine');
      this.keep.fight(inizio); // i rilanci aspettano la fine del combattimento e il loot
    });
    this.bus.on('room', (room) => {
      if (!room.guardata) this.rules.event('stanza', room.titolo, room.contenuti);
      this.scripts.event('stanza', {
        titolo: room.titolo,
        uscite: room.uscite,
        contenuti: room.contenuti,
        guardata: room.guardata,
      });
    });
    this.bus.on('prompt', (p) => {
      const v = this.state.vitals;
      this.rules.values({
        hp: p.hp,
        hpMax: v.hp.max,
        mp: p.mp,
        mpMax: v.mp.max,
        mv: p.mv,
        mvMax: v.mv.max,
        oro: p.oro,
      });
      this.keep.prompt(p.mp);
      this.identify.prompt();
    });
    this.bus.on('room', (room) => {
      if (!room.guardata) this.keep.room();
      if (!room.guardata) this.state.room = room;
      this.executor.event('room', room);
      this.recorder?.room(room);
      this.syncRecording();
    });
    this.bus.on('moveFailed', (f) => {
      this.executor.event('moveFailed', f);
      this.recorder?.moveFailed(f);
    });
    this.bus.on('door', (d) => {
      this.executor.event('door', d);
      this.recorder?.door(d);
    });
    this.bus.on('line', ({ text }) => {
      // loot del cadavere: Mantieni attivi rilancia dopo (log reali: "Prendi gold coins da il
      // corpo di il goblin alchimista.")
      const row = parseAllRow(text);
      if (row) this.allRows.set(row.nome, row);
      this.scripts.line(text);
      if (this.relics.attivo) this.identify.line(text);
      const tell = TELL.exec(text);
      if (tell) {
        this.onAlert?.(tell[2] ? 'gruppo' : 'tell', text);
        this.scripts.event('messaggio', { da: tell[1], gruppo: !!tell[2], testo: text });
      }
      if (LOOT_REPLY.test(text)) {
        this.lootAt = Date.now();
        this.keep.looted();
      } else if (/^Non vedi nessun/i.test(text)) this.keep.lootNone();
      else if (/^Non c'e' nessuno con quel nome qui\./i.test(text)) this.keep.targetMissing();
      else if (/^Il mana si rifuta di scorrere/i.test(text)) this.keep.noMagicZone();
      this.executor.event('line', text);
      this.recorder?.line(text);
    });
    this.bus.on('prompt', (p) => {
      this.executor.prompt({ inCombattimento: !!(p.tank || p.target) });
      if (this.autoInFlight > 0 && Date.now() - this.autoSentAt >= AUTO_REPLY_MIN_MS)
        this.autoInFlight -= 1;
      if (this.autoInFlight === 0 && this.nextAfterAuto) this.runNextStep();
      if (this.recorder) {
        this.recorder.prompt();
        this.syncRecording();
      }
    });
    this.bus.on('affectsList', ({ incantesimi }) => {
      this.state.att = { incantesimi, letto: Date.now() };
    });
    // `score` dà i massimi veri e i valori attuali: le barre si aggiornano subito.
    this.bus.on('score', (s) => {
      if (s.hpMax !== undefined) this.scoreMax = { hp: s.hpMax, mp: s.mpMax, mv: s.mvMax };
      this.state.vitals = updateVitals(
        this.state.vitals,
        { hp: s.hp, mp: s.mp, mv: s.mv },
        this.profile?.max ?? {},
        this.scoreMax,
      );
    });
    this.bus.onError = (error, event) =>
      this.error(`Errore in un ascoltatore di "${event}": ${errorMessage(error)}`);
  }

  get activeProfile(): Profile | null {
    return this.profile;
  }

  setProfile(profile: Profile): void {
    this.promptRe = compilePromptRegex(profile.promptRegex);
    this.profile = profile;
    this.scoreMax = {};
    this.state.vitals = emptyVitals();
    this.state.promptName = undefined;
    this.state.oro = undefined;
    this.state.affetti = undefined;
    this.prevFlags = null;
    this.state.tank = undefined;
    this.state.target = undefined;
    this.state.room = undefined;
    this.state.att = undefined;
    this.timers.clear();
    this.state.timers = [];
    this.theft.reset();
    this.gear.reset();
    this.keep.reset();
    this.rules.resetStats();
    this.autoQueue = [];
    this.autoInFlight = 0;
  }

  /**
   * Due `att` ravvicinati: se una durata è scesa, tra le due letture è scattato un tick.
   * Con letture distanti al massimo 45 s il punto medio stima il tick con ±22 s, e la fase
   * si affina con le letture successive (log reale: tutto sceso di 1 tra 862 s e 902 s).
   */
  private tickFromAtt(incantesimi: { nome: string; durata: number }[], now: number): void {
    const prev = this.state.att;
    if (!prev || now - prev.letto > 45_000) return;
    const before = new Map(prev.incantesimi.map((s) => [s.nome, s.durata]));
    const dropped = incantesimi.some((s) => {
      const b = before.get(s.nome);
      return b !== undefined && s.durata < b;
    });
    if (!dropped) return;
    // Solo se la fase non è ancora stabile: le scadenze vere sono più precise.
    if (!this.tick.stable) {
      this.tick.onTick((prev.letto + now) / 2, false);
      this.state.tick = this.tick.snapshot;
    }
  }

  /** HP sotto la soglia: un avviso solo all'attraversamento (si riarma sopra soglia + 5%). */
  private checkHp(): void {
    const { value, max } = this.state.vitals.hp;
    if (value === undefined || !max) return;
    const pct = (value / max) * 100;
    if (!this.hpLow && pct < this.alertHp) {
      this.hpLow = true;
      this.onAlert?.('hp', `HP bassi: ${value}/${max}`);
    } else if (this.hpLow && pct >= this.alertHp + 5) this.hpLow = false;
  }

  /** Segna un possibile tick; restituisce true se cade in fase (non è un dispel). */
  private markTick(): boolean {
    const ok = this.tick.onTick();
    this.state.tick = this.tick.snapshot;
    return ok;
  }

  /**
   * Confronta le lettere degli effetti con il prompt precedente: una lettera che compare avvia
   * il timer (vale anche per le pozioni, che non hanno "Pronunci le parole"), una minuscola è
   * l'avviso, una che sparisce chiude il timer. Il primo prompt fa solo da riferimento.
   */
  private flagsChanged(flags: AffectFlag[], inCombat = false): void {
    const now = new Map(flags.map((f) => [f.lettera, f]));
    const prev = this.prevFlags;
    this.prevFlags = now;
    if (!prev) return;
    for (const f of flags) {
      if (!f.incantesimo) continue;
      const before = prev.get(f.lettera);
      if (!before) this.timers.onFlagAppear(f.incantesimo);
      if (f.inScadenza && !before?.inScadenza) {
        this.markTick();
        this.timers.onEnd(f.incantesimo, true);
        this.bus.emit('spellWearOff', { nome: f.incantesimo, avviso: true });
      }
    }
    for (const [lettera, f] of prev) {
      if (now.has(lettera) || !f.incantesimo) continue;
      // Una lettera che sparisce è un tick solo se l'effetto è scaduto davvero: dopo l'avviso
      // (minuscola), oppure fuori dal combattimento per gli effetti che non si rompono da soli.
      // Log reale del 2026-11-15: in combattimento I (invisibilità rotta attaccando) e M
      // (immagini distrutte dai colpi) sono spariti 15 s dopo il tick e lo hanno spostato.
      const scaduto = f.inScadenza || (!BREAKABLE.has(f.incantesimo) && !inCombat);
      const onTick = scaduto && this.markTick();
      this.timers.onEnd(f.incantesimo, false, false, onTick);
      this.bus.emit('spellWearOff', { nome: f.incantesimo, avviso: false });
    }
    this.state.timers = this.timers.list;
  }

  /** Carica alias e trigger validi per il profilo attivo (gruppi globali e del profilo). */
  setAutomation(file: AutomationFile, profileId: string | undefined): void {
    this.automation.load(file, profileId);
  }

  /**
   * Interruttori per l'interfaccia, ricavati dai moduli. Non legge `state`: queste funzioni
   * girano anche dentro gli effetti di Svelte (cambio di profilo), e leggere e scrivere lo
   * stesso stato lì crea un ciclo infinito (effect_update_depth_exceeded).
   */
  private syncModuleState(): void {
    this.state.modules = {
      mapper: this.mapper.registra,
      fabbro: this.gear.cfg.fabbro.automatico,
      mantieni: this.keep.enabled,
      regole: this.rules.enabled,
    };
  }

  // --- Automatismi (SPECIFICA 5.4) ------------------------------------------------------

  private autoActions: { ora: number; testo: string }[] = [];
  private autoVersion = 0;

  /** Stato per il pannello (non legge `state`, vedi syncModuleState). */
  private syncAuto(): void {
    this.state.auto = {
      versione: this.autoVersion,
      attesa: this.keep.waiting,
      azioni: [...this.autoActions],
    };
  }

  private logAuto(testo: string): void {
    this.autoActions = [{ ora: Date.now(), testo }, ...this.autoActions].slice(0, 30);
    this.syncAuto();
  }

  /** Configurazione degli automatismi del profilo attivo e funzione per salvarla. */
  setAutoConfig(cfg: AutoConfig, onSave: (cfg: AutoConfig) => void): void {
    this.autoCfg = cfg;
    this.onAutoSave = onSave;
    this.keep.enabled = cfg.mantieni.attivo;
    this.keep.entries = cfg.mantieni.voci;
    this.keep.prune();
    this.keep.costs = { ...cfg.costi };
    this.rules.enabled = cfg.regole.attivo;
    this.rules.rules = cfg.regole.voci;
    this.autoVersion += 1;
    this.syncModuleState();
    this.syncAuto();
  }

  get autoConfig(): AutoConfig | null {
    return this.autoCfg;
  }

  /** Il pannello ha cambiato la configurazione (voci, regole, interruttori). */
  updateAutoConfig(change: (cfg: AutoConfig) => void): void {
    if (!this.autoCfg) return;
    change(this.autoCfg);
    this.setAutoConfig(this.autoCfg, this.onAutoSave ?? (() => {}));
    this.onAutoSave?.(this.autoCfg);
  }

  /** Statistiche di una regola in questa sessione. */
  ruleStats(id: string): { volte: number; ultima?: number } {
    return this.rules.stats(id);
  }

  /** Comandi di un automatismo: come una riga scritta (alias, `;`, comandi del client). */
  private autoSend(label: string, raw: string): void {
    if (this.state.conn !== 'connected' || this.state.password) return;
    if (this.executor.blocking) {
      // lo stesso comando già in coda non si ripete (log reale: 11 loot uguali in coda)
      if (!this.autoQueue.some((x) => x.raw === raw)) this.autoQueue.push({ label, raw });
      this.logAuto(`${label} (in attesa: gira una sequenza)`);
      return;
    }
    this.logAuto(`${label} → ${raw}`);
    const cmds: string[] = [];
    for (const c of parseInput(raw)) if (!this.builtin(c)) cmds.push(c);
    if (!cmds.length) return;
    const expanded = this.expandAll(cmds);
    this.autoInFlight += expanded.length;
    this.autoSentAt = Date.now();
    void this.sendLabelled(label, expanded);
  }

  private flushAuto(): void {
    if (this.executor.blocking) return;
    const q = this.autoQueue;
    this.autoQueue = [];
    for (const x of q) this.autoSend(x.label, x.raw);
    this.keep.flush();
  }

  private runRule(rule: Rule, soggetto?: string): void {
    const sub = (t: string) => t.replace(/\{nome\}/gi, soggetto ?? '');
    for (const a of rule.allora) {
      if (a.tipo === 'avviso') {
        this.alarm(`⚑ ${sub(a.testo)}`);
        this.logAuto(`regola "${rule.nome}": avviso`);
      } else this.autoSend(`⚙ Regola "${rule.nome}"`, sub(a.testo));
    }
    this.syncAuto();
  }

  /**
   * Parole chiave vere di un oggetto dal Reliquiario (nome uguale): prima un identify fatto in
   * gioco, poi i file d'area. Servono al vestiario per scegliere parole chiave univoche.
   */
  private relicKeywords(nome: string): string[] | undefined {
    if (!this.relics.attivo) return undefined;
    const n = cleanName(nome).toLowerCase();
    const trovati = Object.values(this.relics.db.oggetti).filter(
      (o) => o.nome && cleanName(o.nome).toLowerCase() === n,
    );
    const o = trovati.find((x) => !x.mud) ?? trovati[0];
    const k = o ? (o.parole ?? o.chiave) : undefined;
    return k ? k.split(/\s+/).filter((w) => w && !w.startsWith('#')) : undefined;
  }

  /** Comandi `mantieni …` e `regole …`. */
  private autoCommand(word: string, raw: string): void {
    const cfg = this.autoCfg;
    const arg = raw.trim();
    const say = (t: string) =>
      this.system(`[${word === 'mantieni' ? 'Mantieni attivi' : 'Regole'}] ${t}`);
    if (!cfg) return say('scegli prima un profilo.');
    if (word === 'regole') {
      if (arg === 'on' || arg === 'off') {
        this.updateAutoConfig((c) => (c.regole.attivo = arg === 'on'));
        return say(arg === 'on' ? 'accese.' : 'spente.');
      }
      say(
        `${cfg.regole.attivo ? 'accese' : 'spente'} (regole on|off; si modificano nel pannello Automatismi):`,
      );
      for (const r of cfg.regole.voci) say(`  ${r.attiva ? '●' : '○'} ${r.nome}`);
      return;
    }
    const m = /^(\S+)\s*(.*)$/.exec(arg);
    const verbo = (m?.[1] ?? '').toLowerCase();
    const resto = (m?.[2] ?? '').trim();
    if (verbo === 'on' || verbo === 'off') {
      this.updateAutoConfig((c) => (c.mantieni.attivo = verbo === 'on'));
      return say(verbo === 'on' ? 'acceso.' : 'spento.');
    }
    if (verbo === 'via') {
      this.updateAutoConfig((c) => {
        c.mantieni.voci = c.mantieni.voci.filter((v) => v.incantesimo !== resto.toLowerCase());
      });
      return say(`tolto ${resto}.`);
    }
    if (verbo === 'lancia') return this.keep.castNow(resto);
    if (!verbo) {
      say(
        `${cfg.mantieni.attivo ? 'acceso' : 'spento'} (mantieni on|off · mantieni <incantesimo> [bersaglio] · mantieni via <incantesimo>):`,
      );
      for (const v of cfg.mantieni.voci) {
        const c = cfg.costi[v.incantesimo];
        say(
          `  ${v.incantesimo}${v.bersaglio ? ` su ${v.bersaglio}` : ''}${c ? ` (${c} mana)` : ''}` +
            (v.attivo === false ? ' — rilancio automatico spento' : ''),
        );
      }
      return;
    }
    // mantieni <incantesimo> [bersaglio]: l'incantesimo può avere spazi, il bersaglio no
    const words = arg.split(/\s+/);
    const known = new Set(this.timers.list.map((t) => t.nome));
    let nome = arg.toLowerCase();
    let bersaglio = '{pg}';
    if (words.length > 1 && !known.has(nome)) {
      const last = words[words.length - 1];
      if (/^\{pg\}$|^[A-Z]/.test(last)) {
        bersaglio = last;
        nome = words.slice(0, -1).join(' ').toLowerCase();
      }
    }
    this.updateAutoConfig((c) => {
      c.mantieni.voci = [
        ...c.mantieni.voci.filter((v) => v.incantesimo !== nome),
        { incantesimo: nome, bersaglio },
      ];
    });
    say(
      `mantengo ${nome}${bersaglio ? ` su ${bersaglio}` : ''}${cfg.mantieni.attivo ? '' : ' (acceso con: mantieni on)'}.`,
    );
  }

  toggleModule(id: string): void {
    if (id === 'mapper') {
      if (this.mapper.registra) return this.mapCommand('off');
      // l'interfaccia chiede in che zona vanno le stanze nuove; senza, la zona attuale
      return this.onAskMapZone ? this.onAskMapZone() : this.mapCommand('on');
    }
    if (id === 'fabbro') {
      this.gear.command('ripara', this.gear.cfg.fabbro.automatico ? 'auto off' : 'auto on');
      return;
    }
    if (id === 'mantieni') this.autoCommand('mantieni', this.keep.enabled ? 'off' : 'on');
    if (id === 'regole') this.autoCommand('regole', this.rules.enabled ? 'off' : 'on');
  }

  // --- Mappa (SPECIFICA 4) ---------------------------------------------------------------

  /** Mappa caricata dall'app all'avvio. */
  setMap(data: MapData): void {
    this.mapper.load(data);
    // la registrazione parte sempre spenta: si accende a mano (interruttore MAPPER)
    this.mapper.stopRecording();
    this.syncModuleState();
  }

  /** Accende la registrazione della mappa nella zona scelta (esistente o nuova). */
  startMapping(scelta: { zona: number } | { nuova: string }): void {
    const id = this.mapper.startRecording(scelta);
    this.syncModuleState();
    const nome = this.mapper.data.zone.find((z) => z.id === id)?.nome ?? '';
    this.system(`[Mappa] registro: le stanze nuove vanno nella zona "${nome}".`);
  }

  /** Stato per gli script, dall'ultimo prompt. */
  private scriptState(): Record<string, unknown> {
    const v = this.state.vitals;
    return {
      nome: this.state.promptName ?? this.profile?.nome,
      hp: v.hp.value,
      hpMax: v.hp.max,
      mp: v.mp.value,
      mpMax: v.mp.max,
      mv: v.mv.value,
      mvMax: v.mv.max,
      oro: this.state.oro,
      stanza: this.state.room?.titolo,
      tank: this.state.tank,
      bersaglio: this.state.target,
      inCombattimento: this.fighting,
      effetti: (this.state.affetti ?? []).map((f) => f.incantesimo ?? f.lettera),
    };
  }

  /** Script caricati (all'avvio o salvando dall'editor): partono quelli attivi. */
  setScripts(file: ScriptsFile, salva = false): void {
    this.scriptsFile = file;
    this.scripts.stopAll();
    for (const s of file.script) if (s.attivo) this.scripts.start(s);
    this.state.scriptAttivi = this.scripts.runningIds;
    if (salva) this.onScriptsChanged?.(file);
  }

  /** Ferma gli script accesi che non sono tra quelli salvati (provati e poi lasciati). */
  stopUnsavedScripts(): void {
    const saved = new Set(this.scriptsFile.script.map((s) => s.id));
    for (const s of this.scripts.runningScripts) if (!saved.has(s.id)) this.scripts.stop(s.id);
  }

  /** `script` = elenco; `script avvia|ferma <nome>`. */
  private scriptCommand(arg: string): void {
    const say = (t: string) => this.system(`[Script] ${t}`);
    const [sub, ...rest] = arg.trim().split(/\s+/);
    const nome = rest.join(' ').toLowerCase();
    const saved = new Set(this.scriptsFile.script.map((s) => s.id));
    const list = [
      ...this.scriptsFile.script,
      ...this.scripts.runningScripts.filter((s) => !saved.has(s.id)),
    ];
    const find = () => list.find((s) => s.nome.toLowerCase() === nome);
    if (!sub) {
      if (!list.length) return say('nessuno script: creane uno in Automazioni… → Script…');
      for (const s of list)
        say(
          `${s.nome}: ${this.scripts.isRunning(s.id) ? 'acceso' : 'spento'}` +
            (saved.has(s.id) ? '' : ' (provato, non salvato)'),
        );
      return say('script avvia <nome> · script ferma <nome>');
    }
    const s = find();
    if (!s) return say(`nessuno script "${rest.join(' ')}".`);
    if (sub === 'avvia') this.scripts.start(s);
    else if (sub === 'ferma') this.scripts.stop(s.id);
    else say('script avvia <nome> · script ferma <nome>');
  }

  /** Tabella delle abbreviazioni caricata o modificata (editor). */
  setSpells(t: SpellTable, salva = false): void {
    this.spells = t;
    if (salva) this.onSpellsChanged?.(t);
  }

  /**
   * Aggiunge gli incantesimi dell'ultimo elenco `ALL` visto che non hanno ancora
   * un'abbreviazione; restituisce quante voci ha aggiunto.
   */
  importSpellsFromAll(): number {
    const { table, aggiunte } = importAll(this.spells, [...this.allRows.values()]);
    if (aggiunte.length) this.setSpells(table, true);
    this.system(
      aggiunte.length
        ? `[Incantesimi] ${aggiunte.length} abbreviazioni nuove: ` +
            aggiunte.map(([a, v]) => `${a} = ${v.nome}`).join(', ')
        : this.allRows.size
          ? "[Incantesimi] nessun incantesimo nuovo nell'elenco ALL."
          : '[Incantesimi] scrivi ALL nel gioco e scorri tutte le pagine, poi importa.',
    );
    return aggiunte.length;
  }

  /** Unisce due stanze che sono la stessa (`drop` sparisce dentro `keep`). */
  mergeRooms(keep: number, drop: number): void {
    const m = this.mapper;
    const t = m.data.stanze[drop]?.titolo;
    this.system(
      m.mergeRooms(keep, drop)
        ? `[Mappa] stanza ${drop} "${t}" unita alla ${keep}.`
        : '[Mappa] uso: mappa unisci <stanza da tenere> <stanza da togliere> (due stanze diverse).',
    );
  }

  /** Cancella una stanza della mappa. */
  deleteRoom(id: number): void {
    const t = this.mapper.data.stanze[id]?.titolo;
    if (this.mapper.deleteRoom(id)) this.system(`[Mappa] stanza ${id} "${t}" cancellata.`);
  }

  /** Sposta tutte le stanze di un'isola nella zona `to`. */
  moveIsland(from: number, to: number): void {
    const m = this.mapper;
    const a = m.data.zone.find((z) => z.id === from)?.nome;
    const b = m.data.zone.find((z) => z.id === to)?.nome;
    const n = m.moveArea(from, to);
    this.system(
      n
        ? `[Mappa] ${n} stanze di "${a}" spostate nella zona "${b}".`
        : '[Mappa] niente da spostare.',
    );
  }

  /** Sposta le stanze `ids` in una zona esistente o in una zona nuova con il nome dato. */
  moveRooms(ids: number[], dest: { zona: number } | { nuova: string }): number | undefined {
    const m = this.mapper;
    const ok = ids.filter((i) => m.data.stanze[i]);
    if (!ok.length) return;
    const to = 'zona' in dest ? dest.zona : m.addZone(dest.nuova);
    const nome = m.data.zone.find((z) => z.id === to)?.nome;
    const n = m.moveRooms(ok, to);
    this.system(
      n
        ? `[Mappa] ${n === 1 ? '1 stanza spostata' : `${n} stanze spostate`} nella zona "${nome}".`
        : '[Mappa] niente da spostare.',
    );
    return to;
  }

  /** "Vai qui": percorso più breve dalla stanza attuale, eseguito come un percorso. */
  goToRoom(id: number): void {
    const cur = this.mapper.cur;
    const r = this.mapper.data.stanze[id];
    if (!r) return this.system(`[Mappa] la stanza ${id} non esiste.`);
    if (cur === null)
      return this.system('[Mappa] non so dove sei: muoviti o scrivi look (o mappa sono <n>).');
    const cmds = this.mapper.path(cur, id);
    if (!cmds) return this.system(`[Mappa] non conosco una strada per "${r.titolo}" (${id}).`);
    if (!cmds.length) return this.system(`[Mappa] sei già in "${r.titolo}".`);
    void this.runPath({
      id: `mappa:${id}`,
      zona: 'Mappa',
      nome: `${r.titolo} (${id})`,
      nota: '',
      path: cmds.join(','),
      origine: 'utente',
    });
  }

  private mapCommand(raw: string): void {
    const say = (t: string) => this.system(`[Mappa] ${t}`);
    const [sub, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ');
    const m = this.mapper;
    switch ((sub ?? '').toLowerCase()) {
      case '': {
        const r = m.current;
        const n = Object.keys(m.data.stanze).length;
        say(
          `${m.registra ? 'registra' : 'non registra (segue solo la posizione)'} · ${n} stanze in ${m.data.zone.length} zone · ` +
            (r ? `sei in "${r.titolo}" (${r.id})` : 'posizione sconosciuta'),
        );
        say(
          'mappa on [zona] | off · mappa cerca <testo> · mappa nota <testo> · ' +
            'mappa unisci <tieni> <togli> · mappa elimina <n> conferma · mappa sono <n> · mappa vai <n> · mappa zona <nome> · ' +
            `mappa monete on|off (ora ${m.data.noMonete ? 'spenta' : 'accesa'}) · mappa reset conferma`,
        );
        return;
      }
      case 'on':
      case 'riprendi': {
        // `mappa on <nome>`: zona esistente con quel nome, altrimenti zona nuova; senza nome
        // la zona della stanza in cui sei (o una zona nuova se non sai dove sei)
        const z = arg
          ? m.data.zone.find((x) => x.nome.toLowerCase() === arg.toLowerCase())
          : m.data.zone.find((x) => x.id === m.current?.zona);
        return this.startMapping(z ? { zona: z.id } : { nuova: arg || 'Zona nuova' });
      }
      case 'off':
      case 'pausa':
        m.stopRecording();
        this.syncModuleState();
        return say('non registro più: seguo solo la posizione sulle stanze note.');
      case 'monete':
        if (arg !== 'on' && arg !== 'off')
          return say('uso: mappa monete on|off (marca con le monete le stanze identiche).');
        m.data.noMonete = arg === 'off';
        this.onMapChanged?.(m.data);
        return say(
          arg === 'on'
            ? 'nelle stanze identiche lascio 1, 2, 3… monete per riconoscerle.'
            : 'marcatura con le monete spenta.',
        );
      case 'sono':
        return say(
          m.setCurrent(Number(arg)) ? `sei nella stanza ${arg}.` : `la stanza ${arg} non esiste.`,
        );
      case 'vai':
        return this.goToRoom(Number(arg.replace(/^#/, '')));
      case 'zona': {
        const r = m.current;
        if (!r || !arg) return say('uso: mappa zona <nome> (rinomina la zona in cui sei).');
        m.renameArea(r.zona, arg);
        return say(`zona rinominata: ${arg}.`);
      }
      case 'cerca': {
        const found = m.search(arg, 15);
        if (!found.length) return say(arg ? `niente per "${arg}".` : 'uso: mappa cerca <testo>');
        const zn = (id: number) => m.data.zone.find((z) => z.id === id)?.nome ?? '';
        for (const r of found)
          say(`${r.id} · ${r.titolo} (${zn(r.zona)})${r.note ? ` — ${r.note}` : ''}`);
        return;
      }
      case 'nota': {
        const r = m.current;
        if (!r) return say('non so dove sei: la nota va sulla stanza attuale.');
        m.setNotes(r.id, arg);
        return say(arg ? `nota sulla stanza ${r.id}: ${arg}` : `nota della stanza ${r.id} tolta.`);
      }
      case 'unisci': {
        const [a, b] = rest.map((x) => Number(x.replace(/^#/, '')));
        return this.mergeRooms(a, b);
      }
      case 'elimina': {
        const id = Number((rest[0] ?? '').replace(/^#/, ''));
        if (!m.data.stanze[id]) return say('uso: mappa elimina <numero> conferma');
        if (rest[1] !== 'conferma')
          return say(
            `cancella la stanza ${id} "${m.data.stanze[id].titolo}": scrivi  mappa elimina ${id} conferma`,
          );
        return this.deleteRoom(id);
      }
      case 'reset':
        if (arg !== 'conferma') return say('cancella tutta la mappa: scrivi  mappa reset conferma');
        m.reset();
        return say('mappa cancellata.');
      default:
        say('comando sconosciuto (mappa = aiuto).');
    }
  }

  /** Configurazione del vestiario del profilo attivo e funzione per salvarla. */
  setGearConfig(cfg: GearConfig, onSave: (cfg: GearConfig) => void): void {
    this.gear.onSave = onSave;
    this.gear.setConfig(cfg);
    this.syncModuleState();
  }

  /** File dei percorsi dell'utente (caricato dall'app all'avvio). */
  setPaths(file: PathsFile): void {
    this.pathsFile = file;
    this.paths = allPaths(file);
    this.state.pathsVersion += 1;
  }

  get allPaths(): PathEntry[] {
    return this.paths;
  }

  get pathsData(): PathsFile {
    return this.pathsFile;
  }

  private changePaths(change: (f: PathsFile) => PathsFile): void {
    this.setPaths(change(this.pathsFile));
    this.onPathsChanged?.(this.pathsFile);
  }

  /** Salva un percorso dell'utente (nuovo o modificato). Uno del pacchetto diventa una copia. */
  savePath(p: PathEntry): PathEntry {
    let entry = p;
    if (p.origine === 'pacchetto') {
      entry = { ...p, id: newPathId(), origine: 'utente', sostituisce: p.id };
    }
    this.changePaths((f) => {
      const i = f.percorsi.findIndex((x) => x.id === entry.id);
      const percorsi = [...f.percorsi];
      if (i >= 0) percorsi[i] = entry;
      else percorsi.push(entry);
      return { ...f, percorsi };
    });
    return entry;
  }

  /** Elimina un percorso dell'utente; uno del pacchetto viene nascosto. */
  deletePath(p: PathEntry): void {
    this.changePaths((f) =>
      p.origine === 'pacchetto'
        ? { ...f, nascosti: [...new Set([...f.nascosti, p.id])] }
        : { ...f, percorsi: f.percorsi.filter((x) => x.id !== p.id) },
    );
  }

  /** Rimette in elenco i percorsi del pacchetto nascosti. */
  restoreHiddenPaths(): void {
    this.changePaths((f) => ({ ...f, nascosti: [] }));
  }

  toggleFavorite(p: PathEntry): void {
    this.changePaths((f) => ({
      ...f,
      preferiti: f.preferiti.includes(p.id)
        ? f.preferiti.filter((x) => x !== p.id)
        : [...f.preferiti, p.id],
    }));
  }

  /**
   * Comandi del client (non vanno al MUD). Restituisce true se il comando era del client.
   * - `percorsi [zona]`, `vai <nome|numero>`, `vai prova <nome>`,
   *   `vai stop|pausa|riprendi|salta|chiudi`
   * - `rec`, `rec fine <nome>`, `rec annulla|pausa|riprendi|scarta`
   */
  private builtin(raw: string): boolean {
    const text = raw.trim();
    const word = /^(\S+)(?:\s+(.*))?$/.exec(text);
    if (word && this.scripts.command(word[1], word[2] ?? '')) return true;
    if (word && word[1].toLowerCase() === 'script') {
      this.scriptCommand(word[2] ?? '');
      return true;
    }
    if (word && word[1].toLowerCase() === 'mappa') {
      this.mapCommand(word[2] ?? '');
      return true;
    }
    if (word && ['mantieni', 'regole'].includes(word[1].toLowerCase())) {
      this.autoCommand(word[1].toLowerCase(), word[2] ?? '');
      return true;
    }
    if (word && word[1].toLowerCase() === 'reliquiario') {
      this.relicCommand((word[2] ?? '').trim().toLowerCase());
      return true;
    }
    if (word && ['eqset', 'ripara', 'fabbro'].includes(word[1].toLowerCase())) {
      this.gear.command(word[1].toLowerCase(), word[2] ?? '');
      return true;
    }
    let m = /^percorsi(?:\s+(.+))?$/i.exec(text);
    if (m) {
      this.listPaths(m[1]?.trim());
      return true;
    }
    m = /^rec(?:\s+(.+))?$/i.exec(text);
    if (m) {
      this.recCommand(m[1]?.trim() ?? '');
      return true;
    }
    m = /^vai(?:\s+(.+))?$/i.exec(text);
    if (!m) return false;
    const arg = m[1]?.trim() ?? '';
    const sub = arg.toLowerCase();
    if (!arg) {
      this.system(
        'Uso: vai <nome|numero> · vai passo <nome> (un passo alla volta) · vai avanti · ' +
          'vai prova <nome> · vai stop|pausa|riprendi|salta|chiudi ' +
          '(percorsi = elenco)',
      );
    } else if (sub === 'stop') {
      if (!this.stopPath()) this.system('Nessun percorso in corso.');
    } else if (sub === 'pausa') this.executor.pause();
    else if (sub === 'riprendi') this.resumePath();
    else if (sub === 'salta') this.executor.skip();
    else if (sub === 'chiudi') this.executor.close();
    else if (sub === 'avanti') this.nextStep();
    else if (sub === 'passo') {
      // sulla sequenza in corso: accende o spegne il passo alla volta
      if (!this.executor.state) this.system('Uso: vai passo <nome|numero>');
      else this.executor.setStepMode(!this.executor.state.passoPasso);
    } else if (/^passo\s+/i.test(arg)) {
      const p = this.pickPath(arg.replace(/^passo\s+/i, '').trim());
      if (p) void this.runPath(p, { passoPasso: true });
    } else {
      const prova = /^prova\s+(.+)$/i.exec(arg);
      const q = prova ? prova[1].trim() : arg;
      const p = this.pickPath(q);
      if (p && prova) this.previewPath(p);
      else if (p) void this.runPath(p);
    }
    return true;
  }

  /** Percorso per nome o numero dell'ultimo elenco; se ce n'è più d'uno li elenca. */
  private pickPath(q: string): PathEntry | undefined {
    if (/^\d+$/.test(q)) {
      const p = this.lastListing[Number(q) - 1];
      if (!p) this.system(`Nessun percorso numero ${q} nell'ultimo elenco.`);
      return p;
    }
    const found = findPaths(this.paths, q);
    if (found.length === 1) return found[0];
    if (found.length === 0) this.system(`Nessun percorso chiamato "${q}".`);
    else this.showListing(`Più percorsi per "${q}": scrivi vai <numero>`, found);
    return undefined;
  }

  private listPaths(zona?: string): void {
    const zones = groupByZone(this.paths);
    if (!zona) {
      this.system(`Zone (${zones.length}): ${zones.map((z) => z.zona).join(', ')}`);
      this.system('percorsi <zona> = percorsi della zona; vai <nome> = parti.');
      return;
    }
    const q = zona.toLowerCase();
    const z =
      zones.find((x) => x.zona.toLowerCase() === q) ??
      zones.find((x) => x.zona.toLowerCase().includes(q));
    if (!z) this.system(`Nessuna zona "${zona}".`);
    else this.showListing(`Percorsi di ${z.zona}:`, z.voci);
  }

  private showListing(title: string, list: PathEntry[]): void {
    this.lastListing = list;
    this.system(title);
    list.forEach((p, i) =>
      this.system(
        `  ${i + 1}. ${p.nome}${p.nota ? ` (${p.nota})` : ''}` +
          `${p.origine === 'pacchetto' ? '' : p.origine === 'mud' ? ' · MUD' : ' · tuo'}`,
      ),
    );
  }

  /** "Prova": mostra i comandi senza mandarli. */
  previewPath(p: PathEntry): void {
    const cmds = expandPath(p.path);
    this.system(`Prova ${p.nome} (${cmds.length} comandi): ${cmds.join(', ')}`);
  }

  /**
   * Fa partire un percorso con l'esecutore: un comando alla volta, controllando che ogni
   * movimento porti in una stanza nuova. Si ferma su un passo fallito o se inizia un
   * combattimento. Lontano dalla stanza di partenza chiede conferma (ripetere entro 15 s).
   */
  async runPath(p: PathEntry, opts: { passoPasso?: boolean } = {}): Promise<boolean> {
    if (this.state.conn !== 'connected') {
      this.system('Non sei collegato.');
      return false;
    }
    if (this.executor.busy) {
      const s = this.executor.state!;
      this.system(`C'è già ${s.categoria} ${s.nome} in corso: fermalo prima (vai stop).`);
      return false;
    }
    if (this.state.tank || this.state.target) {
      this.system('Sei in combattimento: il percorso non parte.');
      return false;
    }
    const here = this.state.room?.titolo;
    const forced = this.forceStart?.id === p.id && Date.now() < this.forceStart.until;
    this.forceStart = null;
    if (p.partenza && here && here !== p.partenza && !forced) {
      this.forceStart = { id: p.id, until: Date.now() + 15_000 };
      this.system(
        `${p.nome} parte da "${p.partenza}" e tu sei in "${here}": ripeti entro 15 secondi ` +
          'per partire comunque.',
      );
      return false;
    }
    const cmds = expandPath(p.path);
    if (p.troppo) this.system(`Attenzione: ${p.troppo}`);
    this.output.push(
      'echo',
      [],
      `▶ percorso ${p.nome} (${cmds.length} comandi)` +
        (opts.passoPasso ? ' · un passo alla volta: Invio sulla riga vuota per il prossimo' : ''),
    );
    const ok = this.executor.start({
      nome: p.nome,
      categoria: 'percorso',
      fermaInCombattimento: true,
      passoPasso: opts.passoPasso,
      passi: cmds.map((cmd) => ({ cmd, judge: pathJudge(cmd, { porte: p.apriPorte }) })),
      onFinish: () => {
        const at = this.state.room?.titolo;
        if (p.arrivo && at && at !== p.arrivo)
          this.system(`Attenzione: sei in "${at}", ma ${p.nome} doveva arrivare in "${p.arrivo}".`);
      },
    });
    if (ok) this.changePaths((f) => ({ ...f, usati: { ...f.usati, [p.id]: Date.now() } }));
    return ok;
  }

  /** Un passo di una sequenza: va al MUD e nell'output come un comando scritto. */
  private async sendStep(cmd: string): Promise<void> {
    await this.backend.send(cmd);
    this.parser.command(cmd);
    this.bus.emit('commandSent', { text: cmd });
    this.showEcho(cmd);
  }

  /** Ferma il percorso in corso (resta riprendibile); restituisce false se non ce n'era uno. */
  stopPath(): boolean {
    return this.executor.busy && this.executor.stop();
  }

  /** Un passo alla volta: il passo successivo (Invio sulla riga vuota, pulsante, `vai avanti`). */
  nextStep(): void {
    const s = this.executor.state;
    if (!s?.passoPasso) return this.system('Nessun percorso un passo alla volta in corso.');
    if (s.stato === 'fermo') return this.resumePath();
    // Comandi automatici (rilancio, loot) ancora senza risposta: il loro prompt verrebbe preso
    // per quello del passo. Il passo parte appena rispondono (al massimo dopo qualche secondo).
    if (this.autoInFlight > 0) {
      if (!this.nextAfterAuto) {
        this.system('Passo successivo appena rispondono i comandi automatici.');
        this.nextAfterAuto = setTimeout(() => this.runNextStep(), NEXT_AFTER_AUTO_MS);
      }
      return;
    }
    this.executor.next();
  }

  private runNextStep(): void {
    if (this.nextAfterAuto) clearTimeout(this.nextAfterAuto);
    this.nextAfterAuto = null;
    this.autoInFlight = 0;
    this.executor.next();
  }

  resumePath(): void {
    if (this.state.conn !== 'connected') return this.system('Non sei collegato.');
    if (!this.executor.state) return this.system('Nessun percorso da riprendere.');
    this.executor.resume();
  }

  /** "Ferma tutto" (pulsante o Esc sulla riga vuota): ferma la sequenza in corso. */
  stopAll(): void {
    const stopped = this.stopPath();
    if (this.recorder && !this.recorder.state.pausa) this.recPause(true);
    if (!stopped) this.system('Ferma tutto: niente in corso.');
  }

  // --- Registratore dei percorsi -------------------------------------------------------

  private syncRecording(): void {
    this.state.recording = this.recorder?.state;
  }

  private recCommand(arg: string): void {
    const [sub, ...rest] = arg.split(/\s+/);
    switch ((sub ?? '').toLowerCase()) {
      case '':
        if (this.recorder) {
          const r = this.recorder.state;
          this.system(
            `Registrazione: ${r.passi.length} passi${r.pausa ? ' (in pausa)' : ''}: ` +
              `${compactPath(r.passi) || '-'}. rec fine <nome> per salvare.`,
          );
        } else this.recStart();
        break;
      case 'fine':
        this.recFinish({ nome: rest.join(' ') });
        break;
      case 'annulla':
        this.recUndo();
        break;
      case 'pausa':
        this.recPause(true);
        break;
      case 'riprendi':
        this.recPause(false);
        break;
      case 'scarta':
        this.recDiscard();
        break;
      default:
        this.system(
          'Uso: rec · rec fine <nome> · rec annulla · rec pausa · rec riprendi · rec scarta',
        );
    }
  }

  recStart(): void {
    if (this.recorder) return this.system('Stai già registrando (rec = stato).');
    this.recorder = new PathRecorder(this.state.room?.titolo);
    this.syncRecording();
    this.system(
      `Registrazione iniziata${this.state.room ? ` da "${this.state.room.titolo}"` : ''}: ` +
        'cammina, poi rec fine <nome>. Muri, porte chiuse e look non vengono registrati.',
    );
  }

  recUndo(): void {
    const tolto = this.recorder?.undo();
    this.syncRecording();
    this.system(tolto ? `Tolto l'ultimo passo (${tolto}).` : 'Nessun passo da togliere.');
  }

  recPause(pausa: boolean): void {
    if (!this.recorder) return this.system('Nessuna registrazione in corso.');
    this.recorder.setPaused(pausa);
    this.syncRecording();
    this.system(pausa ? 'Registrazione in pausa.' : 'Registrazione ripresa.');
  }

  recDiscard(): void {
    if (!this.recorder) return this.system('Nessuna registrazione in corso.');
    this.recorder = null;
    this.syncRecording();
    this.system('Registrazione scartata.');
  }

  /** Salva la registrazione come percorso; restituisce il percorso salvato. */
  recFinish(d: { nome: string; zona?: string; nota?: string }): PathEntry | undefined {
    const r = this.recorder?.state;
    if (!r) {
      this.system('Nessuna registrazione in corso (rec per iniziare).');
      return undefined;
    }
    if (!d.nome.trim()) {
      this.system('Dai un nome al percorso: rec fine <nome>.');
      return undefined;
    }
    if (r.passi.length === 0) {
      this.system('La registrazione non ha passi: niente da salvare.');
      return undefined;
    }
    const entry: PathEntry = {
      id: newPathId(),
      zona: d.zona?.trim() || 'Registrati',
      nome: d.nome.trim(),
      nota: d.nota?.trim() ?? '',
      path: compactPath(r.passi),
      origine: 'registrato',
      ...(r.partenza ? { partenza: r.partenza } : {}),
      ...(this.state.room ? { arrivo: this.state.room.titolo } : {}),
    };
    this.recorder = null;
    this.syncRecording();
    this.savePath(entry);
    this.system(`Percorso ${entry.nome} salvato in ${entry.zona}: ${entry.path}`);
    for (const a of r.avvisi) this.system(`Da controllare: ${a}`);
    return entry;
  }

  /** Durate degli incantesimi imparate per il profilo attivo. */
  setLearnedDurations(durations: Record<string, number>): void {
    this.timers.durations = durations;
  }

  /** "Reset sessione": azzera le statistiche (il log su disco resta). */
  resetStats(): void {
    this.stats.reset();
    this.state.stats = this.stats.snapshot;
    this.system('Statistiche di sessione azzerate.');
  }

  /** Account di gioco (comune a tutti i personaggi) e se c'è una password salvata. */
  setAccount(account: Account, passwordSaved: boolean): void {
    this.account = account;
    this.passwordSaved = passwordSaved;
  }

  async connect(): Promise<void> {
    const p = this.profile;
    if (!p) return this.system('Scegli o crea un profilo prima di collegarti.');
    if (this.state.conn === 'connected' || this.state.conn === 'connecting') return;
    const a = this.account;
    this.autoLogin = null;
    this.loginHintShown = false;
    if (a.accessoAutomatico) {
      try {
        this.autoLogin = new AutoLogin(a, p.nome, this.passwordSaved).start();
      } catch (e) {
        this.error(`Accesso automatico disattivato: ${errorMessage(e)}`);
      }
    }
    this.state.conn = 'connecting';
    try {
      await this.backend.connect(
        { host: a.host, port: a.port, encoding: a.encoding, profile: p.nome, log: p.log },
        (ev) => this.handle(ev),
      );
    } catch (e) {
      this.state.conn = 'disconnected';
      this.error(errorMessage(e));
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnect = true;
    try {
      await this.backend.disconnect();
    } catch (e) {
      this.error(errorMessage(e));
    }
  }

  async startReplay(path: string, speed = 1): Promise<void> {
    try {
      await this.backend.startReplay(path, speed, (ev) => this.handle(ev));
    } catch (e) {
      this.error(errorMessage(e));
    }
  }

  async stopReplay(): Promise<void> {
    try {
      await this.backend.stopReplay();
    } catch (e) {
      this.error(errorMessage(e));
    }
  }

  handle(ev: ServerEvent): void {
    switch (ev.type) {
      case 'lines':
        for (const line of ev.lines) this.handleLine(line);
        break;
      case 'serverEcho':
        this.state.password = ev.on;
        if (this.autoLogin) this.runLogin(this.autoLogin.onServerEcho(ev.on));
        break;
      case 'status':
        if (ev.state === 'replay') this.state.replaying = true;
        else if (ev.state === 'replayEnded') this.state.replaying = false;
        else {
          const was = this.state.conn;
          this.state.conn = ev.state;
          if (ev.state === 'connected') this.userDisconnect = false;
          if (ev.state === 'disconnected' && was === 'connected' && !this.userDisconnect)
            this.onAlert?.('disconnesso', ev.message);
          if (ev.state === 'disconnected') {
            this.state.password = false;
            this.autoLogin?.stop();
            // Alla prossima connessione le lettere già presenti non sono effetti "nuovi".
            this.prevFlags = null;
            this.keep.reset();
            this.autoQueue = [];
            this.autoInFlight = 0;
            if (this.nextAfterAuto) clearTimeout(this.nextAfterAuto);
            this.nextAfterAuto = null;
            this.executor.stop('connessione persa');
          }
        }
        this.system(ev.message);
        this.bus.emit('status', { state: ev.state, message: ev.message });
        break;
      case 'echo':
        this.parser.command(ev.text);
        this.showEcho(ev.text);
        break;
      case 'error':
        this.error(ev.message);
        break;
    }
  }

  private handleLine(wire: WireLine): void {
    let spans = wire.spans;
    if (this.pending) {
      if (this.output.last === this.pending.line) this.output.popLast();
      spans = concatSpans(this.pending.spans, spans);
      this.pending = null;
    }
    const parts = splitPrompts(spans, this.promptRe);
    parts.forEach((part, i) => {
      if (part.kind === 'prompt') {
        this.parser.prompt();
        this.lastPrompt = this.output.push('prompt', part.spans);
        this.state.vitals = updateVitals(
          this.state.vitals,
          part.data,
          this.profile?.max ?? {},
          this.scoreMax,
        );
        this.checkHp();
        if (part.data.nome) this.state.promptName = part.data.nome;
        if (part.data.oro !== undefined) this.state.oro = part.data.oro;
        if (part.data.affetti !== undefined) {
          // Il prompt mostra effetti e tank/bersaglio: `*` (nessuno) diventa undefined.
          const flags = parseAffectFlags(part.data.affetti);
          const fight = !!(part.data.tank || part.data.target);
          const wasFighting = this.fighting;
          this.state.affetti = flags;
          this.state.tank = part.data.tank;
          this.state.target = part.data.target;
          // Prima il combattimento, poi le lettere: un effetto finito nel prompt che apre il
          // combattimento deve già trovare Mantieni attivi in attesa (log reale con sir Goldblum:
          // M sparita nel primo prompt di combattimento → mirror images rilanciato in mezzo).
          if (fight !== this.fighting) {
            this.fighting = fight;
            this.bus.emit('combat', { inizio: fight });
          }
          this.flagsChanged(flags, fight || wasFighting);
        }
        this.bus.emit('prompt', part.data);
        this.scripts.prompt(this.scriptState());
        return;
      }
      const line = this.output.push('mud', part.spans);
      if (this.autoLogin?.active) this.runLogin(this.autoLogin.onText(part.text));
      else if (!this.autoLogin) this.loginHint(part.text);
      if (wire.partial && i === parts.length - 1) {
        this.pending = { spans: part.spans, line };
      } else {
        this.completer.learn(part.text);
        this.lineInParse = line;
        if (this.down && RIALZATO.test(part.text)) {
          this.output.setBackground(line, 'verde');
          this.down = false;
        }
        this.bus.emit('line', { text: part.text, spans: part.spans });
        this.parser.line(part.text);
        this.lineInParse = null;
        this.runTriggers(part.text, line);
      }
    });
  }

  /** Se il server chiede il nome utente e l'accesso automatico è spento, dice dove attivarlo. */
  private loginHint(text: string): void {
    if (this.loginHintShown || this.state.conn !== 'connected') return;
    let re: RegExp;
    try {
      re = new RegExp(this.account.promptUtente, 'u');
    } catch {
      return;
    }
    if (!re.test(text)) return;
    this.loginHintShown = true;
    this.system(
      'Accesso automatico spento: per entrare da solo imposta utente e password in ' +
        'Profili… → Account e accesso e spunta "Accesso automatico".',
    );
  }

  /** Trigger dell'utente su una riga completa: colore, nascondi, comandi. */
  private runTriggers(text: string, line: OutLine): void {
    const r = this.automation.matchLine(text);
    if (r.colore) this.output.recolor(line, r.colore);
    if (r.nascondi) this.output.remove(line);
    for (const t of r.spenti) {
      this.error(
        `Trigger "${t.nome || t.pattern}" spento: scattava più di 5 volte al secondo ` +
          '(riattivalo dalle Automazioni dopo averlo corretto).',
      );
      this.onTriggerDisabled?.(t);
    }
    for (const fire of r.fires) void this.sendFromTrigger(fire);
  }

  /** Comandi di un trigger: passano dagli alias e sono scritti nell'output col nome del trigger. */
  private async sendFromTrigger(fire: TriggerFire): Promise<void> {
    const label = fire.trigger.nome || fire.trigger.pattern;
    await this.sendLabelled(`⚙ ${label}`, this.expandAll(fire.comandi));
  }

  /**
   * Comando di un pulsante: come se fosse scritto (alias, `;`, `#n`, abbreviazioni), ma non
   * entra nella cronologia e l'output lo mostra con l'etichetta del pulsante.
   */
  async sendFromButton(label: string, raw: string): Promise<void> {
    if (this.state.conn !== 'connected') {
      this.system('Non sei collegato.');
      return;
    }
    if (this.state.password) return;
    await this.sendLabelled(`▶ ${label}`, this.expandAll(parseInput(raw)));
  }

  private async sendLabelled(label: string, commands: string[]): Promise<void> {
    if (this.state.conn !== 'connected' || this.state.password) return;
    this.pending = null;
    const echo = this.output.push('echo', [], `${label} → ${commands.join('; ')}`);
    this.markStand(echo, commands);
    for (const text of commands) {
      try {
        await this.backend.send(text);
      } catch (e) {
        this.error(errorMessage(e));
        return;
      }
      this.parser.command(text);
      this.bus.emit('commandSent', { text });
    }
  }

  /** Esegue i passi dell'accesso automatico e li scrive nell'output (niente di nascosto). */
  private runLogin(actions: LoginAction[]): void {
    for (const action of actions) {
      void this.loginStep(action);
    }
  }

  private async loginStep(action: LoginAction): Promise<void> {
    const a = this.account;
    try {
      switch (action.type) {
        case 'sendUser':
          // Il nome utente (spesso un'email) non va nel log di sessione.
          await this.backend.send(a.utente, false);
          this.system('Accesso automatico: nome utente inviato.');
          break;
        case 'sendPassword':
          await this.backend.sendPassword(a.host, a.utente);
          this.system('Accesso automatico: password inviata (dal portachiavi).');
          break;
        case 'send':
          await this.backend.send(action.text);
          this.parser.command(action.text);
          this.system(
            `Accesso automatico: scelto il personaggio ${action.text} (${this.profile?.nome}).`,
          );
          break;
        case 'info':
          this.system(`Accesso automatico: ${action.message}`);
          break;
      }
    } catch (e) {
      this.autoLogin?.stop();
      this.error(`Accesso automatico interrotto: ${errorMessage(e)}`);
    }
  }

  /** Invia quello che il giocatore ha scritto nella riga di comando. */
  async sendInput(raw: string): Promise<void> {
    if (this.state.conn !== 'connected') {
      this.system('Non sei collegato.');
      return;
    }
    // Password: niente separatori, alias, cronologia, eco né log.
    let commands: string[];
    if (this.state.password) {
      commands = [raw];
    } else {
      if (this.builtin(raw)) {
        this.history.add(raw);
        return;
      }
      const typed = parseInput(raw);
      commands = this.expandAll(typed);
      this.history.add(raw);
      // Se un alias ha cambiato qualcosa, l'eco mostra cosa parte davvero.
      const changed = commands.join('\n') !== typed.join('\n');
      this.showEcho(changed ? `${raw} → ${commands.join('; ')}` : raw);
    }
    this.pending = null;
    for (const text of commands) {
      try {
        await this.backend.send(text);
      } catch (e) {
        this.error(errorMessage(e));
        return;
      }
      if (!this.state.password) {
        this.parser.command(text);
        this.bus.emit('commandSent', { text });
      }
    }
  }

  /**
   * Alias dell'utente, poi abbreviazioni degli incantesimi (se attive nel profilo), poi il
   * segnaposto `{pg}` = nome del personaggio collegato (dal prompt, altrimenti dal profilo).
   */
  private expandAll(commands: string[]): string[] {
    const pg = this.state.promptName ?? this.profile?.nome ?? '';
    return commands
      .flatMap((c) => this.automation.expand(c) ?? [c])
      .map((c) => this.expand(c))
      .map((c) => c.replace(/\{pg\}/gi, pg));
  }

  /** Abbreviazioni degli incantesimi, se attive nel profilo. */
  private expand(command: string): string {
    if (this.profile?.abbreviazioni) return expandSpell(command, this.spells) ?? command;
    return command;
  }

  private showEcho(text: string): void {
    const attach = this.pending?.line ?? this.lastPrompt ?? undefined;
    this.pending = null;
    const line = this.output.echo(text, attach);
    this.markStand(line, text.split(/[;→]/));
  }

  /**
   * Dopo una caduta, la riga con lo `stand` mandato prende lo sfondo verde: in combattimento
   * il MUD non risponde niente (log reali), fuori risponde "Ti alzi." (verde anche quella,
   * se arriva prima).
   */
  private markStand(line: OutLine, commands: string[]): void {
    if (!this.down || !commands.some((c) => /^st(?:a|an|and)?$/i.test(c.trim()))) return;
    this.output.setBackground(line, 'verde');
    this.down = false;
  }

  /** Nome del pg: dal prompt, altrimenti quello del profilo. */
  private pgName(): string {
    return this.state.promptName ?? this.profile?.nome ?? '';
  }

  /** `reliquiario` (stato), `reliquiario ricarica`. */
  private relicCommand(arg: string): void {
    const say = (t: string) => this.system(`[Reliquiario] ${t}`);
    if (!this.relics.attivo)
      return say('spento: scegli la cartella di identi.js in Impostazioni → Reliquiario.');
    if (arg === 'ricarica') {
      void this.relics.reload().then(() => say(`riletto: ${this.state.relics.oggetti} oggetti.`));
      return;
    }
    if (arg) return say('uso: reliquiario · reliquiario ricarica');
    const pgs = Object.keys(this.relics.db.pg);
    say(
      `${this.state.relics.oggetti} oggetti, pg: ${pgs.length ? pgs.join(', ') : 'nessuno'} · ` +
        `file: ${this.relics.cartella}/identi.js` +
        (this.relics.errore ? ` · ${this.relics.errore}` : ''),
    );
  }

  system(message: string): void {
    this.pending = null;
    this.output.push('system', plainSpans(message));
  }

  /** Allarme ben visibile nell'output (es. furto). */
  alarm(message: string): void {
    this.pending = null;
    this.output.push('alarm', plainSpans(message));
  }

  error(message: string): void {
    this.pending = null;
    this.output.push('error', plainSpans(message));
  }
}
