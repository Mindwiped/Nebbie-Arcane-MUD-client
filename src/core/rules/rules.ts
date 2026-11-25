/**
 * Regole sullo stato (SPECIFICA 5.4): "quando <condizione> allora <azione>". I trigger
 * reagiscono al testo; le regole a quello che il client sa (valori del prompt, fatti
 * riconosciuti dal parser). Ogni scatto passa da `host.run`, che lo scrive nell'output.
 */
export type Campo = 'hp' | 'mp' | 'mv' | 'oro';

export type RuleEvent =
  | 'mobUcciso'
  | 'moneteCadavere'
  | 'atterrato'
  | 'effettoFinito'
  | 'combattimentoInizio'
  | 'combattimentoFine'
  | 'stanza';

export type Condition =
  | { tipo: 'valore'; campo: Campo; op: '<' | '>'; soglia: number; percento?: boolean }
  | { tipo: 'evento'; evento: RuleEvent; filtro?: string };

export type Action = { tipo: 'comandi'; testo: string } | { tipo: 'avviso'; testo: string };

export interface Rule {
  id: string;
  nome: string;
  attiva: boolean;
  quando: Condition;
  allora: Action[];
  /** Secondi minimi tra due scatti. Per i valori: ogni quanto riprova finché la condizione vale. */
  attesa: number;
  /** Quando può scattare rispetto al combattimento. */
  combattimento: 'sempre' | 'solo' | 'fuori';
  /** Scatti massimi per sessione (assente = senza limite). */
  maxVolte?: number;
  /** Regola pronta di serie (il nome della preimpostazione). */
  preset?: string;
}

export interface Values {
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  mv?: number;
  mvMax?: number;
  oro?: number;
}

export interface RulesHost {
  now(): number;
  inCombat(): boolean;
  /** Esegue le azioni di una regola; `soggetto` riempie `{nome}` (mob, incantesimo, stanza). */
  run(rule: Rule, soggetto?: string): void;
}

export const EVENT_LABELS: Record<RuleEvent, string> = {
  mobUcciso: 'mob ucciso',
  moneteCadavere: 'monete prese da un cadavere ({nome} = quante)',
  atterrato: 'a terra (bash, disarm o finger fallito, stand non riuscito)',
  effettoFinito: 'incantesimo finito',
  combattimentoInizio: 'inizia un combattimento',
  combattimentoFine: 'finisce un combattimento',
  stanza: 'entri in una stanza',
};

const CAMPO_LABEL: Record<Campo, string> = { hp: 'HP', mp: 'MP', mv: 'MV', oro: 'oro' };

export function describeCondition(c: Condition): string {
  if (c.tipo === 'valore')
    return `${CAMPO_LABEL[c.campo]} ${c.op} ${c.soglia}${c.percento ? '%' : ''}`;
  return `${EVENT_LABELS[c.evento]}${c.filtro ? ` (${c.filtro})` : ''}`;
}

export function describeActions(a: Action[]): string {
  return a.map((x) => (x.tipo === 'comandi' ? x.testo : `avviso: ${x.testo}`)).join(' · ');
}

export function newRuleId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Regole pronte, spente tranne quando si convertono impostazioni vecchie. */
export function presetRules(): Rule[] {
  return [
    {
      id: 'preset-second-wind',
      nome: 'second wind con poco movimento',
      attiva: false,
      quando: { tipo: 'valore', campo: 'mv', op: '<', soglia: 70 },
      allora: [{ tipo: 'comandi', testo: "cast 'second wind' {pg}" }],
      attesa: 8,
      combattimento: 'sempre',
      preset: 'secondWind',
    },
    {
      id: 'preset-monete',
      nome: 'monete dopo un uccisione',
      attiva: false,
      quando: { tipo: 'evento', evento: 'mobUcciso' },
      allora: [{ tipo: 'comandi', testo: 'get all.coin corp;get all.coin dust' }],
      attesa: 0,
      combattimento: 'sempre',
      preset: 'monete',
    },
    {
      // richiesta del 2026-11-18: dividere col gruppo le monete del loot, come `split` a mano
      id: 'preset-split',
      nome: 'split delle monete prese dal cadavere',
      attiva: false,
      quando: { tipo: 'evento', evento: 'moneteCadavere' },
      allora: [{ tipo: 'comandi', testo: 'split {nome}' }],
      attesa: 0,
      combattimento: 'sempre',
      preset: 'split',
    },
    {
      id: 'preset-stand',
      nome: 'in piedi dopo bash o disarm fallito',
      attiva: false,
      quando: { tipo: 'evento', evento: 'atterrato' },
      allora: [{ tipo: 'comandi', testo: 'stand' }],
      attesa: 2,
      combattimento: 'sempre',
      preset: 'stand',
    },
  ];
}

export class RulesEngine {
  rules: Rule[] = [];
  enabled = false;
  /** Scatti per regola in questa sessione (per il pannello e per `maxVolte`). */
  private fired = new Map<string, { volte: number; ultima: number }>();

  constructor(private readonly host: RulesHost) {}

  stats(id: string): { volte: number; ultima?: number } {
    return this.fired.get(id) ?? { volte: 0 };
  }

  resetStats(): void {
    this.fired.clear();
  }

  /** Valori nuovi dal prompt. */
  values(v: Values): void {
    for (const r of this.active()) {
      const c = r.quando;
      if (c.tipo !== 'valore') continue;
      const val = v[c.campo];
      if (val === undefined) continue;
      let x = val;
      if (c.percento) {
        const max =
          c.campo === 'oro' ? undefined : v[`${c.campo}Max` as 'hpMax' | 'mpMax' | 'mvMax'];
        if (!max) continue;
        x = (val / max) * 100;
      }
      if (c.op === '<' ? x < c.soglia : x > c.soglia) this.fire(r, `${val}`);
    }
  }

  /** Un fatto riconosciuto. `soggetto`: nome del mob, dell'incantesimo, titolo della stanza. */
  event(ev: RuleEvent, soggetto = '', extra: string[] = []): void {
    for (const r of this.active()) {
      const c = r.quando;
      if (c.tipo !== 'evento' || c.evento !== ev) continue;
      if (c.filtro) {
        const f = c.filtro.toLowerCase();
        if (![soggetto, ...extra].some((t) => t.toLowerCase().includes(f))) continue;
      }
      this.fire(r, soggetto);
    }
  }

  private active(): Rule[] {
    return this.enabled ? this.rules.filter((r) => r.attiva) : [];
  }

  private fire(r: Rule, soggetto: string): void {
    const fight = this.host.inCombat();
    if (r.combattimento === 'solo' && !fight) return;
    if (r.combattimento === 'fuori' && fight) return;
    const now = this.host.now();
    const st = this.fired.get(r.id) ?? { volte: 0, ultima: 0 };
    if (st.volte > 0 && now - st.ultima < r.attesa * 1000) return;
    if (r.maxVolte !== undefined && st.volte >= r.maxVolte) return;
    this.fired.set(r.id, { volte: st.volte + 1, ultima: now });
    this.host.run(r, soggetto);
  }
}

/** Lettura tollerante di una regola salvata. */
export function parseRule(v: unknown): Rule | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const q = d.quando as Record<string, unknown> | undefined;
  let quando: Condition | null = null;
  if (q?.tipo === 'valore' && ['hp', 'mp', 'mv', 'oro'].includes(q.campo as string)) {
    quando = {
      tipo: 'valore',
      campo: q.campo as Campo,
      op: q.op === '>' ? '>' : '<',
      soglia: Number(q.soglia) || 0,
      ...(q.percento === true ? { percento: true } : {}),
    };
  } else if (q?.tipo === 'evento' && typeof q.evento === 'string' && q.evento in EVENT_LABELS) {
    quando = {
      tipo: 'evento',
      evento: q.evento as RuleEvent,
      ...(typeof q.filtro === 'string' && q.filtro ? { filtro: q.filtro } : {}),
    };
  }
  if (!quando) return null;
  const allora = (Array.isArray(d.allora) ? d.allora : [])
    .filter(
      (a): a is Action =>
        a && (a.tipo === 'comandi' || a.tipo === 'avviso') && typeof a.testo === 'string',
    )
    .map((a) => ({ tipo: a.tipo, testo: a.testo }));
  const comb =
    d.combattimento === 'solo' || d.combattimento === 'fuori' ? d.combattimento : 'sempre';
  return {
    id: typeof d.id === 'string' && d.id ? d.id : newRuleId(),
    nome: typeof d.nome === 'string' ? d.nome : '',
    attiva: d.attiva === true,
    quando,
    allora,
    attesa: Math.max(0, Number(d.attesa) || 0),
    combattimento: comb,
    ...(typeof d.maxVolte === 'number' ? { maxVolte: d.maxVolte } : {}),
    ...(typeof d.preset === 'string' ? { preset: d.preset } : {}),
  };
}
