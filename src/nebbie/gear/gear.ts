import type { EventBus } from '../../core/eventBus';
import type { ClientEvents } from '../../core/events';
import type { Executor, Step } from '../../core/sequence/executor';
import {
  containerOf,
  defaultGearConfig,
  defaultPlace,
  needsContainers,
  keyword,
  placeOf,
  prefixSafe,
  uniqueKeys,
  useCommand,
  type Container,
  type GearConfig,
  type Piece,
  type UseCmd,
} from './config';
import { checkedStep, listStep } from './judges';
import { GearModel, type GearItem, type GearSnapshot } from './model';
import {
  compare,
  detect,
  difference,
  isStorage,
  names,
  plan,
  type Plan,
  type Reading,
} from './plan';

/** Stato mostrato dal pannello Equipaggiamento. */
export interface GearState {
  modello: GearSnapshot;
  attuale?: string;
  vicino?: string;
  distanza?: number;
  fabbro: boolean;
  /** Pezzi indossati non in condizioni eccellenti. */
  daRiparare: number;
}

export interface GearHost {
  bus: EventBus<ClientEvents>;
  executor: Executor;
  info(text: string, level?: 'info' | 'ok' | 'warn' | 'error'): void;
  connected(): boolean;
  /** Parole chiave vere di un oggetto (identify o file d'area, dal Reliquiario), se note. */
  keywordsOf?(nome: string): string[] | undefined;
}

const ECCELLENTE = 'in condizioni eccellenti';
const CATEGORIA = 'cambio di set';

/** Pezzi da riparare: raggruppati per parola chiave (i doppi senza `2.`, che remove non accetta). */
export function repairPlan(
  worn: GearItem[],
  cfg: GearConfig,
): { comandi: string[]; pezzi: GearItem[] } {
  const groups = new Map<string, { pezzi: GearItem[]; danni: number }>();
  for (const r of worn) {
    if (isStorage(r.nome, cfg)) continue;
    const k = keyword(r.nome, cfg);
    if (!groups.has(k)) groups.set(k, { pezzi: [], danni: 0 });
    const g = groups.get(k)!;
    g.pezzi.push(r);
    if (r.condizione && r.condizione !== ECCELLENTE) g.danni += 1;
  }
  const comandi: string[] = [];
  const pezzi: GearItem[] = [];
  for (const [k, g] of groups) {
    if (g.danni === 0) continue;
    pezzi.push(...g.pezzi);
    for (const p of g.pezzi) {
      void p;
      comandi.push(`remove ${k}`, `give ${k} ${cfg.fabbro.nome}`);
    }
    for (const p of g.pezzi) comandi.push(`${useCommand(p, cfg)} ${k}`);
  }
  return { comandi, pezzi };
}

/**
 * Vestiario (SPECIFICA 5.3): modello dell'equipaggiamento, set, cambio di set e riparazione,
 * tutti eseguiti dall'esecutore un passo alla volta con controllo delle risposte.
 * Comandi: `eqset …` e `ripara …` (vedi `help`).
 */
export class Gear {
  cfg: GearConfig = defaultGearConfig();
  readonly model = new GearModel();
  /** Chiamata quando la configurazione cambia (l'app la salva per il profilo). */
  onSave?: (cfg: GearConfig) => void;
  /** Chiamata quando cambia qualcosa da mostrare. */
  onChange?: (state: GearState) => void;
  /** Apre la finestra dei contenitori (senza, si usano i comandi `eqset contenitore`). */
  onAskContainers?: (inAttesa?: string) => void;
  /** Cambio di set in attesa che l'utente scelga i contenitori. */
  private pending?: { nome: string; mode: { forza?: boolean; prova?: boolean } };

  private found: { attuale?: string; vicino?: string; distanza?: number } = {};
  private fabbro = false;
  /** Comandi per rimettere a posto i contenitori tirati fuori (eseguiti in ordine inverso). */
  private restoreSteps: string[] = [];
  /** Una lettura (`eq`/`inv`) l'ha chiesta il vestiario: niente riparazione automatica. */
  private ownRead = false;

  constructor(private readonly host: GearHost) {
    const bus = host.bus;
    bus.on('equipmentList', ({ righe }) => {
      this.model.setWorn(righe);
      this.found = detect(this.model.snapshot.addosso.righe, this.cfg);
      this.changed();
      if (!this.ownRead) this.autoRepair();
    });
    bus.on('inventoryList', ({ righe }) => {
      this.model.setInventory(righe);
      this.changed();
    });
    bus.on('containerList', ({ titolo, righe }) => {
      this.model.setContainer(titolo, righe);
      this.changed();
    });
    bus.on('line', ({ text }) => {
      let changed = this.model.line(text) !== undefined;
      if (!this.fabbro && text.toLowerCase().includes(this.cfg.fabbro.testo)) {
        this.fabbro = true;
        changed = true;
      }
      if (changed) this.changed();
    });
    bus.on('room', (room) => {
      if (room.guardata) return;
      const t = this.cfg.fabbro.testo;
      this.fabbro = room.contenuti.some((c) => c.toLowerCase().includes(t));
      this.changed();
    });
  }

  get state(): GearState {
    const modello = this.model.snapshot;
    return {
      modello,
      ...this.found,
      fabbro: this.fabbro,
      daRiparare: modello.addosso.righe.filter(
        (r) => r.condizione && r.condizione !== ECCELLENTE && !isStorage(r.nome, this.cfg),
      ).length,
    };
  }

  setConfig(cfg: GearConfig): void {
    this.cfg = cfg;
    this.found = detect(this.model.snapshot.addosso.righe, cfg);
    this.changed();
  }

  /** Cambio di personaggio o disconnessione. */
  reset(): void {
    this.model.clear();
    this.found = {};
    this.fabbro = false;
    this.restoreSteps = [];
    this.changed();
  }

  private changed(): void {
    this.onChange?.(this.state);
  }

  private save(): void {
    this.onSave?.(this.cfg);
    this.found = detect(this.model.snapshot.addosso.righe, this.cfg);
    this.changed();
  }

  private msg(t: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info'): void {
    this.host.info(t, level);
  }

  private start(nome: string, passi: Step[], onFinish: () => void, categoria = CATEGORIA): boolean {
    if (!this.host.connected()) {
      this.msg('non sei collegato.');
      return false;
    }
    const ex = this.host.executor;
    if (ex.busy) {
      const s = ex.state!;
      this.msg(`c'e' gia' ${s.categoria} ${s.nome} in corso.`, 'warn');
      return false;
    }
    const ok = ex.start({
      nome,
      categoria,
      passi,
      onFinish,
      onAbandon: () => this.restore(),
    });
    if (!ok) this.msg("l'esecutore e' occupato.", 'warn');
    return ok;
  }

  /** Rimette a posto i contenitori tirati fuori (dopo uno stop, una prova, un annullamento). */
  private restore(): void {
    const cmds = [...this.restoreSteps].reverse();
    this.restoreSteps = [];
    if (!cmds.length) return;
    this.host.executor.start({
      nome: 'rimetto a posto',
      categoria: 'vestiario',
      passi: cmds.map((c) => checkedStep(c, this.cfg.errori, { salta: true })),
    });
  }

  private read(nome: string, then: () => void, categoria = CATEGORIA): void {
    this.ownRead = true;
    this.start(
      nome,
      [listStep('eq', 'equipmentList'), listStep('inv', 'inventoryList')],
      () => {
        this.ownRead = false;
        then();
      },
      categoria,
    );
  }

  /** Dove sta un contenitore adesso, secondo il modello. */
  private whereIs(c: Container): 'indossato' | 'inventario' | 'dentro' | undefined {
    const m = this.model.snapshot;
    if (m.addosso.righe.some((r) => containerOf(r.nome, this.cfg) === c)) return 'indossato';
    if (m.inventario.righe.some((r) => containerOf(r.nome, this.cfg) === c)) return 'inventario';
    if (c.dove === 'dentro' && c.in) return 'dentro';
    return undefined;
  }

  private contents(c: Container) {
    return this.model.container(c.nome || c.parola);
  }

  // ---------- parole chiave univoche ----------

  /** Tutti i nomi che il vestiario conosce: set, posti, addosso, inventario, contenitori. */
  private knownNames(): string[] {
    const all: string[] = [];
    for (const set of Object.values(this.cfg.sets)) for (const p of set) all.push(p.nome);
    all.push(...Object.keys(this.cfg.posti));
    const m = this.model.snapshot;
    for (const l of [m.addosso, m.inventario, ...Object.values(m.contenitori)])
      for (const r of l.righe) all.push(r.nome);
    return all.filter((n) => !isStorage(n, this.cfg));
  }

  /**
   * Aggiunge le parole chiave univoche che mancano (pezzi con la stessa parola, es. tre paia di
   * guanti). Restituisce quante ne ha aggiunte.
   */
  ensureKeys(dire = false): number {
    const r = uniqueKeys(this.knownNames(), (n) => this.host.keywordsOf?.(n), this.cfg);
    const nuove = Object.entries(r.chiavi);
    for (const [n, k] of nuove) this.cfg.chiavi[n] = k;
    if (nuove.length) {
      this.save();
      this.msg(
        `parole chiave univoche: ${nuove.map(([n, k]) => `${k} = ${n}`).join(', ')}` +
          (r.dubbi.length ? ` (dal nome, non da identify: ${r.dubbi.join(', ')})` : ''),
      );
    } else if (dire) this.msg('parole chiave: nessun doppione da sistemare.');
    for (const n of r.irrisolti)
      this.msg(`${n}: nessuna parola chiave univoca, usa  eqset chiave <parola> = ${n}`, 'warn');
    return nuove.length;
  }

  // ---------- riordino delle borse ----------

  /**
   * Mette ogni pezzo nel suo posto (richiesta del 2026-11-24): apre i contenitori principali,
   * tira fuori quelli interni, li legge tutti e sposta i pezzi che non stanno dove devono
   * (`eqset posto`). I pezzi indossati restano addosso.
   */
  reorder(prova = false): void {
    this.ensureKeys();
    this.restoreSteps = [];
    this.read('riordino', () => {
      const passi: Step[] = [];
      for (const c of this.cfg.contenitori) {
        if (c.dove === 'dentro') continue;
        const w = this.whereIs(c);
        if (!w) {
          this.msg(`non trovo ${c.parola} ne' addosso ne' in inventario.`, 'warn');
          continue;
        }
        if (w === 'indossato' && c.togliPerUsare) {
          passi.push(checkedStep(`remove ${c.parola}`, this.cfg.errori));
          this.restoreSteps.push(`wear ${c.parola}`);
        }
        passi.push(listStep(`exa ${c.parola}`, 'containerList'));
      }
      for (const c of this.cfg.contenitori) {
        if (c.dove !== 'dentro') continue;
        passi.push(...this.takeOut(c));
        passi.push(listStep(`exa ${c.parola}`, 'containerList'));
      }
      this.start('riordino', passi, () => this.runReorder(prova), 'riordino');
    });
  }

  private runReorder(prova: boolean): void {
    const mosse: string[] = [];
    const fuori: string[] = [];
    const where = (parola: string) => {
      const c = this.cfg.contenitori.find((x) => x.parola === parola);
      return c ? (this.contents(c)?.righe ?? []) : this.model.snapshot.inventario.righe;
    };
    const luoghi = ['inv', ...this.cfg.contenitori.map((c) => c.parola)];
    for (const da of luoghi) {
      for (const r of prefixSafe(where(da), (x) => keyword(x.nome, this.cfg))) {
        if (isStorage(r.nome, this.cfg)) continue;
        const a = this.cfg.posti[r.nome];
        if (!a || a === da || !luoghi.includes(a)) continue;
        const k = keyword(r.nome, this.cfg);
        for (let i = 0; i < r.quantita; i++) {
          if (da !== 'inv') mosse.push(`get ${k} ${da}`);
          if (a !== 'inv') mosse.push(`put ${k} ${a}`);
        }
        fuori.push(`${r.nome}${r.quantita > 1 ? ` (x${r.quantita})` : ''}: ${da} -> ${a}`);
      }
    }
    if (prova || !mosse.length) {
      if (!mosse.length) this.msg("tutto gia' al suo posto.", 'ok');
      else {
        this.msg(`per riordinare (${mosse.length} comandi):`);
        for (const f of fuori) this.msg(`  ${f}`);
      }
      return this.restore();
    }
    const passi: Step[] = mosse.map((c) => checkedStep(c, this.cfg.errori));
    for (const cmd of [...this.restoreSteps].reverse())
      passi.push(checkedStep(cmd, this.cfg.errori, { salta: true }));
    passi.push(listStep('inv', 'inventoryList'));
    this.msg(`riordino: ${fuori.length} pezzi da spostare (${mosse.length} comandi)`);
    for (const f of fuori) this.msg(`  ${f}`);
    this.start(
      'riordino',
      passi,
      () => {
        this.restoreSteps = [];
        const inv = this.model.snapshot.inventario.righe.filter(
          (r) =>
            !isStorage(r.nome, this.cfg) &&
            this.cfg.posti[r.nome] &&
            this.cfg.posti[r.nome] !== 'inv',
        );
        if (inv.length)
          this.msg(`rimasti in inventario: ${inv.map((r) => r.nome).join(', ')}`, 'warn');
        else this.msg('borse riordinate.', 'ok');
      },
      'riordino',
    );
  }

  // ---------- cambio di set ----------

  /** Apre la scelta dei contenitori (pannello Equipaggiamento). */
  askContainers(): void {
    this.pending = undefined;
    if (this.onAskContainers) this.onAskContainers();
    else this.listContainers();
  }

  /** Contenitori scelti nella finestra: si salvano e riparte il cambio di set in attesa. */
  setContainers(contenitori: Container[], destinazione: string): void {
    this.cfg.contenitori = contenitori;
    this.cfg.destinazione = destinazione;
    this.save();
    this.listContainers();
    const p = this.pending;
    this.pending = undefined;
    if (p) this.change(p.nome, p.mode);
  }

  /** Finestra dei contenitori chiusa senza salvare: il cambio di set in attesa non parte. */
  cancelContainers(): void {
    if (this.pending) this.msg(`cambio di set ${this.pending.nome} annullato.`);
    this.pending = undefined;
  }

  change(nome: string, mode: { forza?: boolean; prova?: boolean } = {}): void {
    const set = this.cfg.sets[nome];
    if (!set) return this.msg(`il set ${nome} non esiste. ${this.setList()}`);
    if (needsContainers(this.cfg) && this.onAskContainers) {
      // personaggio nuovo: prima si sceglie da dove prendere i pezzi e dove mettere quelli tolti
      this.pending = { nome, mode };
      this.msg('prima di cambiare set dimmi quali contenitori usi.');
      return this.onAskContainers(nome);
    }
    this.restoreSteps = [];
    this.ensureKeys();
    // 1) eq e inventario
    this.read(nome, () => {
      if (this.isWorn(set)) {
        this.found = { attuale: nome, vicino: nome, distanza: 0 };
        this.changed();
        return this.msg(`stai gia' indossando il set ${nome}.`, 'ok');
      }
      // 2) contenitori principali: tolti di dosso se serve, poi esaminati
      const passi: Step[] = [];
      for (const c of this.cfg.contenitori) {
        if (c.dove === 'dentro') continue;
        const w = this.whereIs(c);
        if (!w) {
          this.msg(`non trovo ${c.parola} ne' addosso ne' in inventario.`, 'warn');
          continue;
        }
        if (w === 'indossato' && c.togliPerUsare) {
          passi.push(checkedStep(`remove ${c.parola}`, this.cfg.errori));
          this.restoreSteps.push(`wear ${c.parola}`);
        }
        passi.push(listStep(`exa ${c.parola}`, 'containerList'));
      }
      const next = () => this.planAndRun(nome, set, mode, new Set());
      if (passi.length) this.start(nome, passi, next);
      else next();
    });
  }

  private reading(lettiOra: Set<string>): Reading {
    const m = this.model.snapshot;
    const contenuti: Reading['contenuti'] = {};
    for (const c of this.cfg.contenitori) {
      const l = this.contents(c);
      // Un contenitore principale conta solo se letto adesso; uno interno anche da prima.
      const ok = l?.letto !== undefined && (c.dove === 'dentro' || lettiOra.has(c.parola));
      const presente = c.dove === 'dentro' || this.whereIs(c) !== undefined;
      contenuti[c.parola] = ok ? l!.righe : presente ? undefined : [];
    }
    return { eq: m.addosso.righe, inv: m.inventario.righe, contenuti };
  }

  private planAndRun(
    nome: string,
    set: Piece[],
    mode: { forza?: boolean; prova?: boolean },
    letti: Set<string>,
  ): void {
    const principali = new Set(
      this.cfg.contenitori.filter((c) => c.dove !== 'dentro').map((c) => c.parola),
    );
    const P = plan(set, this.reading(principali), this.cfg);
    // 3) pezzi presunti in un contenitore interno non letto: lo tiro fuori e lo esamino
    // (uno alla volta finché ce n'è uno non ancora letto: il pezzo può stare nell'altro)
    const daLeggere = this.cfg.contenitori.filter(
      (c) =>
        c.dove === 'dentro' &&
        !letti.has(c.parola) &&
        P.metti.some((w) => w.presunto && w.da === c.parola),
    );
    if (daLeggere.length) {
      const passi: Step[] = [];
      for (const c of daLeggere) {
        letti.add(c.parola);
        passi.push(...this.takeOut(c));
        passi.push(listStep(`exa ${c.parola}`, 'containerList'));
      }
      this.start(nome, passi, () => this.planAndRun(nome, set, mode, letti));
      return;
    }
    if (mode.prova) {
      this.msg(`per passare a ${nome}:`);
      const vis = P.passi.map((c) => (P.alt[c] ? `${c} (o ${P.alt[c]})` : c));
      this.msg(vis.length ? vis.join(', ') : 'niente da fare');
      for (const m of P.mancanti) this.msg(`manca: ${m}`, 'warn');
      return this.restore();
    }
    if (P.mancanti.length && !mode.forza) {
      this.msg('cambio annullato, mancano questi pezzi:', 'error');
      for (const m of P.mancanti) this.msg(`  ${m}`, 'error');
      this.msg(`(eqset forza ${nome} per cambiare comunque)`);
      return this.restore();
    }
    if (P.passi.length === 0) {
      this.msg('niente da fare.');
      return this.restore();
    }
    // 4) contenitori interni usati ma non ancora fuori, i passi, poi tutto a posto e verifica
    const passi: Step[] = [];
    for (const c of this.cfg.contenitori)
      if (c.dove === 'dentro' && P.usati.includes(c.parola)) passi.push(...this.takeOut(c));
    for (const cmd of P.passi) passi.push(checkedStep(cmd, this.cfg.errori, { alt: P.alt[cmd] }));
    for (const cmd of [...this.restoreSteps].reverse())
      passi.push(checkedStep(cmd, this.cfg.errori, { salta: true }));
    passi.push(listStep('eq', 'equipmentList'), listStep('inv', 'inventoryList'));
    this.msg(`passo al set ${nome} (${P.passi.length} comandi)`);
    this.ownRead = true;
    this.start(nome, passi, () => {
      this.ownRead = false;
      this.restoreSteps = [];
      this.verify(nome, P);
    });
  }

  /** Passi per avere in inventario un contenitore interno (e il comando per rimetterlo). */
  private takeOut(c: Container): Step[] {
    if (this.whereIs(c) === 'inventario' || this.restoreSteps.includes(`put ${c.parola} ${c.in}`))
      return [];
    this.restoreSteps.push(`put ${c.parola} ${c.in}`);
    return [checkedStep(`get ${c.parola} ${c.in}`, this.cfg.errori)];
  }

  private isWorn(set: Piece[]): boolean {
    const cur = names(this.model.snapshot.addosso.righe, this.cfg);
    const t = names(set, this.cfg);
    return difference(t, cur).length === 0 && difference(cur, t).length === 0;
  }

  private verify(nome: string, P: Plan): void {
    const set = this.cfg.sets[nome];
    const m = this.model.snapshot;
    const { mancano, inPiu } = compare(set, m.addosso.righe, this.cfg);
    // impara da dove venivano i pezzi presi dai contenitori
    for (const w of P.metti)
      if (w.da && w.da !== 'inv' && !this.cfg.posti[w.nome]) this.cfg.posti[w.nome] = w.da;
    const rimasti = P.togli.filter(
      (x) => x.a !== 'inv' && m.inventario.righe.some((r) => r.nome === x.nome),
    );
    if (mancano.length === 0 && inPiu.length === 0) {
      // pezzi doppi (due braccialetti, due lobi): uno slot ciascuno, non quello del primo
      const presi = new Set<number>();
      for (const p of set) {
        const i = m.addosso.righe.findIndex((e, j) => !presi.has(j) && e.nome === p.nome && e.slot);
        if (i >= 0) {
          presi.add(i);
          p.slot = m.addosso.righe[i].slot;
        }
      }
      this.save();
      this.found = { attuale: nome, vicino: nome, distanza: 0 };
      this.changed();
      this.msg(`set ${nome} indossato.`, rimasti.length ? 'warn' : 'ok');
    } else {
      this.save();
      this.msg("il cambio non e' completo:", 'warn');
      for (const n of mancano) this.msg(`  non addosso: ${n}`, 'warn');
      for (const n of inPiu) this.msg(`  in piu': ${n}`, 'warn');
      this.msg(`rilancia  eqset ${nome}  per completare, o  eqset prova ${nome}`);
    }
    for (const x of rimasti)
      this.msg(`rimasto in inventario: ${x.nome} (doveva andare in ${x.a})`, 'warn');
  }

  /** Rilegge eq e inventario (pulsante Aggiorna del pannello). */
  refresh(): void {
    this.read('eq e inventario', () => this.changed(), 'lettura');
  }

  /** Salva come set quello che indossi adesso (letto con `eq`). */
  saveSet(nome: string): void {
    this.ownRead = true;
    this.start(
      nome,
      [listStep('eq', 'equipmentList')],
      () => {
        this.ownRead = false;
        const set = this.model.snapshot.addosso.righe
          .filter((p) => !isStorage(p.nome, this.cfg))
          .map((p) => (p.slot ? { nome: p.nome, slot: p.slot } : { nome: p.nome }));
        if (!set.length)
          return this.msg('non ho letto nessun pezzo addosso, set non salvato.', 'error');
        this.cfg.sets[nome] = set;
        this.save();
        this.found = { attuale: nome, vicino: nome, distanza: 0 };
        this.changed();
        this.msg(`set ${nome} salvato con ${set.length} pezzi.`, 'ok');
      },
      'salvataggio del set',
    );
  }

  deleteSet(nome: string): void {
    if (!this.cfg.sets[nome]) return this.msg(`il set ${nome} non esiste.`);
    delete this.cfg.sets[nome];
    this.save();
    this.msg(`set ${nome} eliminato.`);
  }

  /** Toglie un pezzo da un set (dal pannello). */
  removePiece(nome: string, index: number): void {
    const set = this.cfg.sets[nome];
    if (!set?.[index]) return;
    set.splice(index, 1);
    this.save();
  }

  // ---------- riparazione ----------

  /** Ripara i pezzi non eccellenti (rilegge l'eq prima). */
  repair(force = false): void {
    if (!this.fabbro && !force)
      return this.msg('nessun fabbro qui (ripara forza per provare comunque).', 'warn');
    this.ownRead = true;
    this.start(
      'lettura',
      [listStep('eq', 'equipmentList')],
      () => {
        this.ownRead = false;
        this.runRepair();
      },
      'riparazione',
    );
  }

  private runRepair(): void {
    const { comandi, pezzi } = repairPlan(this.model.snapshot.addosso.righe, this.cfg);
    if (!comandi.length) return this.msg('niente da riparare.', 'ok');
    this.msg(
      `riparo: ${pezzi.map((p) => `${p.nome} (${p.condizione ?? 'senza stato'})`).join(', ')}`,
    );
    this.ownRead = true;
    this.start(
      'dal fabbro',
      [...comandi.map((c) => checkedStep(c, this.cfg.errori)), listStep('eq', 'equipmentList')],
      () => {
        this.ownRead = false;
        const rest = this.state.daRiparare;
        this.msg(
          rest ? `riparazione finita, ${rest} pezzi ancora rovinati.` : 'tutto riparato.',
          rest ? 'warn' : 'ok',
        );
      },
      'riparazione',
    );
  }

  /** `eq` scritto da te con il fabbro presente e la riparazione automatica accesa. */
  private autoRepair(): void {
    if (!this.cfg.fabbro.automatico || !this.fabbro || this.host.executor.busy) return;
    if (this.state.daRiparare === 0) return;
    this.msg('fabbro presente e pezzi rovinati: riparo (ripara auto off per spegnere).');
    this.runRepair();
  }

  // ---------- comandi ----------

  setList(): string {
    const t = Object.keys(this.cfg.sets).sort();
    return t.length ? `Set: ${t.join(', ')}` : 'Nessun set salvato: eqset salva <nome>';
  }

  private help(): void {
    this.msg(
      'eqset <set> | eqset prova <set> | eqset forza <set> | eqset salva <nome> | eqset elimina <set>',
    );
    this.msg('eqset mostra [set] | eqset stop | eqset contenitori');
    this.msg(
      'eqset riordina [prova]  (ogni pezzo nel suo posto) | eqset chiavi  (parole chiave univoche)',
    );
    this.msg(
      'eqset contenitore <parola> indossato|inventario [togli] | eqset contenitore <parola> dentro <altro>',
    );
    this.msg(
      'eqset contenitore via <parola> | eqset chiave <parola> = <nome> | eqset usa wear|hold|wield = <nome>',
    );
    this.msg('eqset destinazione <contenitore>|inv  (dove vanno i pezzi tolti)');
    this.msg(
      'eqset posto <contenitore>|inv = <nome> | ripara [forza] | ripara auto on|off | fabbro si|no',
    );
  }

  private findName(q: string): string | string[] {
    const ql = q.toLowerCase();
    const all = new Set<string>();
    for (const set of Object.values(this.cfg.sets)) for (const p of set) all.add(p.nome);
    for (const r of this.model.snapshot.addosso.righe) all.add(r.nome);
    const list = [...all];
    const exact = list.find((n) => n.toLowerCase() === ql);
    if (exact) return exact;
    const found = list.filter((n) => n.toLowerCase().includes(ql));
    return found.length === 1 ? found[0] : found.length === 0 ? q : found;
  }

  private setFor(
    table: 'chiavi' | 'usa' | 'posti',
    value: string,
    text: string,
    descr: string,
  ): void {
    const nome = this.findName(text.trim());
    if (Array.isArray(nome)) {
      this.msg("piu' oggetti corrispondono, scrivi meglio il nome:");
      for (const n of nome) this.msg(`  ${n}`);
      return;
    }
    (this.cfg[table] as Record<string, string>)[nome] = value;
    this.save();
    this.msg(`${nome}: ${descr} ${value}`);
  }

  private containerCommand(resto: string): void {
    const p = resto.trim().split(/\s+/);
    if (p[0] === 'via' && p[1]) {
      this.cfg.contenitori = this.cfg.contenitori.filter((c) => c.parola !== p[1].toLowerCase());
      if (this.cfg.destinazione === p[1].toLowerCase()) this.cfg.destinazione = 'inv';
      this.save();
      return this.msg(`contenitore ${p[1]} tolto.`);
    }
    const parola = p[0]?.toLowerCase();
    const dove = p[1]?.toLowerCase();
    if (!parola || !['indossato', 'inventario', 'dentro'].includes(dove ?? ''))
      return this.msg(
        'uso: eqset contenitore <parola> indossato|inventario [togli] | <parola> dentro <altro>',
      );
    const c: Container = { parola, nome: parola, dove: dove as Container['dove'] };
    if (dove === 'dentro') {
      if (!p[2])
        return this.msg('dentro quale contenitore? eqset contenitore <parola> dentro <altro>');
      c.in = p[2].toLowerCase();
    }
    if (p.includes('togli')) c.togliPerUsare = true;
    const i = this.cfg.contenitori.findIndex((x) => x.parola === parola);
    if (i >= 0) this.cfg.contenitori[i] = { ...this.cfg.contenitori[i], ...c };
    else this.cfg.contenitori.push(c);
    this.save();
    this.listContainers();
  }

  private listContainers(): void {
    if (!this.cfg.contenitori.length)
      return this.msg('nessun contenitore: i pezzi si prendono e si lasciano in inventario.');
    this.msg("contenitori (dove si cercano i pezzi, dopo l'inventario):");
    for (const c of this.cfg.contenitori)
      this.msg(
        `  ${c.parola}: ${c.dove === 'dentro' ? `dentro ${c.in}` : c.dove}${c.togliPerUsare ? ', va tolto per usarlo' : ''}`,
      );
    const d = defaultPlace(this.cfg);
    this.msg(`i pezzi tolti vanno in: ${d === 'inv' ? 'inventario' : d}`);
  }

  /** Comandi `eqset …`, `ripara …`, `fabbro …`. */
  command(word: string, raw: string): void {
    const arg = raw.trim();
    if (word === 'fabbro') {
      const a = arg.toLowerCase();
      if (a === 'si' || a === 'sì') this.fabbro = true;
      else if (a === 'no') this.fabbro = false;
      this.changed();
      return this.msg(
        `fabbro ${this.fabbro ? 'presente' : 'non rilevato'}; riparazione automatica ${this.cfg.fabbro.automatico ? 'accesa' : 'spenta'}.`,
      );
    }
    if (word === 'ripara') {
      const a = arg.toLowerCase();
      if (a === 'auto on' || a === 'auto off') {
        this.cfg.fabbro.automatico = a === 'auto on';
        this.save();
        return this.msg(
          `riparazione automatica ${this.cfg.fabbro.automatico ? 'accesa' : 'spenta'}.`,
        );
      }
      return this.repair(a === 'forza');
    }
    const m = /^(\S+)\s*(.*?)\s*$/.exec(arg);
    const verbo = (m?.[1] ?? '').toLowerCase();
    const resto = m?.[2] ?? '';
    const nome = resto.toLowerCase();
    switch (verbo) {
      case '':
        this.msg(this.setList());
        if (this.found.attuale) this.msg(`set attuale: ${this.found.attuale}`);
        else if (this.found.vicino)
          this.msg(
            `set attuale: nessuno (il piu' vicino e' ${this.found.vicino}, ${this.found.distanza} pezzi diversi)`,
          );
        return this.help();
      case 'aiuto':
        return this.help();
      case 'stop':
        if (!this.host.executor.stop()) this.msg('nessun cambio in corso.');
        return;
      case 'salva':
        if (!nome || /\s/.test(nome)) return this.msg('uso: eqset salva <nome>  (una parola)');
        return this.saveSet(nome);
      case 'forza':
        return this.change(nome, { forza: true });
      case 'prova':
        return this.change(nome, { prova: true });
      case 'elimina':
        return this.deleteSet(nome);
      case 'contenitori':
        return this.listContainers();
      case 'riordina':
        return this.reorder(nome === 'prova');
      case 'chiavi':
        this.ensureKeys(true);
        return;
      case 'contenitore':
        return this.containerCommand(resto);
      case 'destinazione': {
        if (nome !== 'inv' && !this.cfg.contenitori.some((c) => c.parola === nome))
          return this.msg('uso: eqset destinazione <contenitore>|inv');
        this.cfg.destinazione = nome;
        this.save();
        return this.listContainers();
      }
      case 'mostra': {
        if (!nome) return this.msg(this.setList());
        const set = this.cfg.sets[nome];
        if (!set) return this.msg(`il set ${nome} non esiste. ${this.setList()}`);
        this.msg(`set ${nome}  (chiave, comando, dove va quando lo togli)`);
        for (const p of set)
          this.msg(
            `  ${keyword(p.nome, this.cfg).padEnd(11)} ${useCommand(p, this.cfg).padEnd(5)} ${placeOf(p.nome, this.cfg).padEnd(10)} ${p.nome}${p.slot ? `   <${p.slot}>` : ''}`,
          );
        return;
      }
      case 'chiave': {
        const mm = /^(\S+)\s*=\s*(.+)$/.exec(resto);
        if (!mm) return this.msg("uso: eqset chiave <parola> = <nome dell'oggetto>");
        return this.setFor('chiavi', mm[1].toLowerCase(), mm[2], 'parola chiave');
      }
      case 'usa': {
        const mm = /^(\p{L}+)\s*=\s*(.+)$/u.exec(resto);
        const c = mm?.[1].toLowerCase() as UseCmd | undefined;
        if (!mm || !c || !['wear', 'hold', 'wield'].includes(c))
          return this.msg('uso: eqset usa wear|hold|wield = <nome>');
        return this.setFor('usa', c, mm[2], 'si indossa con');
      }
      case 'posto': {
        const mm = /^(\S+)\s*=\s*(.+)$/u.exec(resto);
        const d = mm?.[1].toLowerCase();
        if (!mm || !d || (d !== 'inv' && !this.cfg.contenitori.some((c) => c.parola === d)))
          return this.msg('uso: eqset posto <contenitore>|inv = <nome>');
        return this.setFor('posti', d, mm[2], 'quando lo togli va in');
      }
      default:
        return this.change(verbo);
    }
  }
}
