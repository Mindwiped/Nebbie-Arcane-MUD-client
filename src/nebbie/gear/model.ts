import type { ItemRow } from '../parser/types';

/**
 * Modello dell'equipaggiamento (SPECIFICA 5.3): cosa hai addosso, in inventario e nei
 * contenitori, con l'ora dell'ultima lettura. Si aggiorna dalle liste complete (`eq`, `inv`,
 * `exa <contenitore>`) e dai messaggi dei singoli gesti, così resta giusto anche tra una
 * lettura e l'altra. Dopo un gesto lo slot di un pezzo indossato non è noto (il messaggio
 * dice "su un dito della mano destra", la lista "sul dito destro"): lo dà il prossimo `eq`.
 */
export interface GearItem {
  nome: string;
  quantita: number;
  slot?: string;
  condizione?: string;
}

export interface GearList {
  righe: GearItem[];
  /** Ora dell'ultima lettura completa (undefined = mai letta). */
  letto?: number;
  /** Cambiata da un gesto dopo l'ultima lettura. */
  toccato?: boolean;
}

export interface GearSnapshot {
  addosso: GearList;
  inventario: GearList;
  /** Nome completo del contenitore (come nelle liste) → contenuto. */
  contenitori: Record<string, GearList>;
}

/** Messaggi dei gesti (testi reali del 2026-11-13; `(x3)` = più pezzi uguali). */
const GESTI: [RegExp, (m: RegExpExecArray) => Gesture][] = [
  [/^Smetti di usare (.+)\.$/, (m) => ({ tipo: 'togli', nome: m[1] })],
  [
    /^Indossi (.+?) (?:su|sul|sulla|sulle|sui|al|alla|alle|ai|intorno|come|in|davanti) .+\.$/,
    (m) => ({ tipo: 'indossa', nome: m[1] }),
  ],
  [
    /^Ti metti (.+?) (?:su|sul|sulla|sulle|sui|al|alla|alle|ai|intorno|come|in|davanti) .+\.$/,
    (m) => ({ tipo: 'indossa', nome: m[1] }),
  ],
  [
    /^(?:Impugni|Tieni|Stringi) (.+?)(?: (?:in|nella|con) .+)?\.$/,
    (m) => ({ tipo: 'indossa', nome: m[1] }),
  ],
  // altri messaggi reali: "Indossi X." (corpo), "Usi X." (scudo), "Ti avvolgi con X." (mantello),
  // "Prendi X in mano." (oggetto tenuto), "Metti X sulle mani." (guanti)
  [/^Indossi (.+?)\.$/, (m) => ({ tipo: 'indossa', nome: m[1] })],
  [/^Usi (.+?)\.$/, (m) => ({ tipo: 'indossa', nome: m[1] })],
  [/^Ti avvolgi (?:con|in) (.+?)\.$/, (m) => ({ tipo: 'indossa', nome: m[1] })],
  [/^Prendi (.+?) in mano\.$/, (m) => ({ tipo: 'indossa', nome: m[1] })],
  [
    /^Prendi (.+) da (.+?)\.(?: \(x(\d+)\))?$/,
    (m) => ({ tipo: 'prendi', nome: m[1], da: m[2], n: Number(m[3] ?? 1) }),
  ],
  [
    /^Prendi (.+?)\.(?: \(x(\d+)\))?$/,
    (m) => ({ tipo: 'prendi', nome: m[1], n: Number(m[2] ?? 1) }),
  ],
  [
    /^Metti (.+) in (.+?)\.(?: \(x(\d+)\))?$/,
    (m) => ({ tipo: 'metti', nome: m[1], in: m[2], n: Number(m[3] ?? 1) }),
  ],
  [
    /^Metti (.+?) (?:su|sul|sulla|sulle|sui|al|alla|alle|ai|intorno|davanti) .+\.$/,
    (m) => ({ tipo: 'indossa', nome: m[1] }),
  ],
  [/^Posi (.+?)\.(?: \(x(\d+)\))?$/, (m) => ({ tipo: 'posa', nome: m[1], n: Number(m[2] ?? 1) })],
  [/^Dai (.+) a (.+?)\.$/, (m) => ({ tipo: 'posa', nome: m[1], n: 1 })],
];

export type Gesture =
  | { tipo: 'togli'; nome: string }
  | { tipo: 'indossa'; nome: string }
  | { tipo: 'prendi'; nome: string; da?: string; n: number }
  | { tipo: 'metti'; nome: string; in: string; n: number }
  | { tipo: 'posa'; nome: string; n: number };

export function parseGesture(text: string): Gesture | undefined {
  const t = text.trim();
  for (const [re, f] of GESTI) {
    const m = re.exec(t);
    if (m) return f(m);
  }
  return undefined;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(il|lo|la|l'|un|uno|una|i|gli|le)\s*/u, '')
    .trim();
const same = (a: string, b: string) => norm(a) === norm(b);

const fromRows = (rows: ItemRow[]): GearItem[] =>
  rows.map((r) => {
    const it: GearItem = { nome: r.nome, quantita: r.quantita };
    if (r.slot) it.slot = r.slot;
    if (r.condizione) it.condizione = r.condizione;
    return it;
  });

export class GearModel {
  private worn: GearList = { righe: [] };
  private inv: GearList = { righe: [] };
  private boxes = new Map<string, GearList>();

  constructor(private readonly now: () => number = Date.now) {}

  get snapshot(): GearSnapshot {
    const copy = (l: GearList): GearList => ({ ...l, righe: l.righe.map((r) => ({ ...r })) });
    const contenitori: Record<string, GearList> = {};
    for (const [k, v] of this.boxes) contenitori[k] = copy(v);
    return { addosso: copy(this.worn), inventario: copy(this.inv), contenitori };
  }

  clear(): void {
    this.worn = { righe: [] };
    this.inv = { righe: [] };
    this.boxes.clear();
  }

  setWorn(rows: ItemRow[]): void {
    this.worn = { righe: fromRows(rows), letto: this.now() };
  }

  setInventory(rows: ItemRow[]): void {
    this.inv = { righe: fromRows(rows), letto: this.now() };
  }

  setContainer(titolo: string, rows: ItemRow[]): void {
    this.boxes.set(this.boxKey(titolo) ?? titolo, { righe: fromRows(rows), letto: this.now() });
  }

  /** Contenuto di un contenitore riconosciuto da una parte del nome. */
  container(parte: string): GearList | undefined {
    const k = this.boxKey(parte);
    return k ? this.boxes.get(k) : undefined;
  }

  /** Riga del MUD: se è un gesto riuscito, aggiorna il modello. Restituisce il gesto. */
  line(text: string): Gesture | undefined {
    const g = parseGesture(text);
    if (!g) return undefined;
    switch (g.tipo) {
      case 'togli': {
        const it = this.take(this.worn, g.nome, 1);
        this.add(this.inv, it ?? { nome: g.nome, quantita: 1 }, 1);
        break;
      }
      case 'indossa': {
        const it = this.take(this.inv, g.nome, 1);
        const worn: GearItem = { ...(it ?? { nome: g.nome, quantita: 1 }), quantita: 1 };
        delete worn.slot;
        this.worn.righe.push(worn);
        this.worn.toccato = true;
        break;
      }
      case 'prendi': {
        // Le monete non sono oggetti dell'inventario.
        if (/\b(?:gold )?coins?\b|\bmonet[ae]\b/i.test(g.nome)) break;
        const box = g.da ? this.findBox(g.da) : undefined;
        const it = box ? this.take(box, g.nome, g.n) : undefined;
        this.add(this.inv, it ?? { nome: g.nome, quantita: 1 }, g.n);
        break;
      }
      case 'metti': {
        const it = this.take(this.inv, g.nome, g.n);
        const box = this.findBox(g.in);
        if (box) this.add(box, it ?? { nome: g.nome, quantita: 1 }, g.n);
        break;
      }
      case 'posa':
        this.take(this.inv, g.nome, g.n);
        break;
    }
    return g;
  }

  private boxKey(parte: string): string | undefined {
    const p = parte.toLowerCase();
    for (const k of this.boxes.keys())
      if (k.toLowerCase().includes(p) || p.includes(k.toLowerCase())) return k;
    return undefined;
  }

  private findBox(nome: string): GearList | undefined {
    const k = this.boxKey(nome);
    return k ? this.boxes.get(k) : undefined;
  }

  /** Toglie n pezzi da una lista; restituisce il pezzo (senza quantità) se c'era. */
  private take(list: GearList, nome: string, n: number): GearItem | undefined {
    const i = list.righe.findIndex((r) => same(r.nome, nome));
    if (i < 0) return undefined;
    const it = list.righe[i];
    list.toccato = true;
    if (it.quantita > n) {
      it.quantita -= n;
      return { ...it, quantita: 1 };
    }
    list.righe.splice(i, 1);
    return { ...it, quantita: 1 };
  }

  private add(list: GearList, it: GearItem, n: number): void {
    list.toccato = true;
    const clean: GearItem = { nome: it.nome, quantita: n };
    if (it.condizione) clean.condizione = it.condizione;
    const same1 = list.righe.find((r) => same(r.nome, it.nome) && !r.slot);
    if (same1) same1.quantita += n;
    else list.righe.push(clean);
  }
}
