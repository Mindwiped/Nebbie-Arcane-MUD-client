import {
  containerOf,
  keyword,
  placeOf,
  prefixSafe,
  useCommand,
  type GearConfig,
  type Piece,
} from './config';

/**
 * Piano del cambio di set (SPECIFICA 5.3), dall'algoritmo di EqSet 2 generalizzato a
 * contenitori qualsiasi: i pezzi uguali restano dove sono, prima si liberano gli slot, poi il
 * pezzo nuovo prende il posto del vecchio (stesso slot, poi stessa parola chiave).
 */
export interface Seen {
  nome: string;
  slot?: string;
  quantita: number;
}

export interface Reading {
  eq: Seen[];
  inv: Seen[];
  /** Parola del contenitore → contenuto; assente = non letto (i pezzi mancanti si cercano lì). */
  contenuti: Record<string, Seen[] | undefined>;
}

export interface ToRemove extends Piece {
  /** Parola del contenitore in cui va, o `inv`. */
  a: string;
}
export interface ToWear extends Piece {
  /** `inv`, parola del contenitore da cui si prende; undefined = introvabile. */
  da?: string;
  /** Il contenitore non è stato letto: si presume che il pezzo sia lì. */
  presunto?: boolean;
}

export interface Plan {
  passi: string[];
  /** Comando → alternativa se fallisce (hold → wear). */
  alt: Record<string, string>;
  mancanti: string[];
  togli: ToRemove[];
  metti: ToWear[];
  /** Contenitori usati dai passi. */
  usati: string[];
}

/** I contenitori non fanno parte dei set. */
export const isStorage = (nome: string, cfg: GearConfig) => containerOf(nome, cfg) !== undefined;

export function names(list: { nome: string }[], cfg: GearConfig): string[] {
  return list.filter((p) => !isStorage(p.nome, cfg)).map((p) => p.nome);
}

/** Elementi di `a` che non sono in `b`, contando i doppi. */
export function difference(a: string[], b: string[]): string[] {
  const c = new Map<string, number>();
  for (const n of b) c.set(n, (c.get(n) ?? 0) + 1);
  const out: string[] = [];
  for (const n of a) {
    const k = c.get(n) ?? 0;
    if (k > 0) c.set(n, k - 1);
    else out.push(n);
  }
  return out;
}

/** Il set più vicino all'equipaggiamento indossato (0 differenze = è quello). */
export function detect(
  eq: { nome: string }[],
  cfg: GearConfig,
): { attuale?: string; vicino?: string; distanza?: number } {
  if (eq.length === 0) return {};
  const cur = names(eq, cfg);
  let best: string | undefined;
  let dmin: number | undefined;
  for (const nome of Object.keys(cfg.sets).sort()) {
    const t = names(cfg.sets[nome], cfg);
    const d = difference(cur, t).length + difference(t, cur).length;
    if (dmin === undefined || d < dmin) {
      best = nome;
      dmin = d;
    }
  }
  return { attuale: dmin === 0 ? best : undefined, vicino: best, distanza: dmin };
}

/** Confronto tra un set e quello che indossi (per il pannello). */
export function compare(
  set: Piece[],
  eq: { nome: string }[],
  cfg: GearConfig,
): { uguali: string[]; mancano: string[]; inPiu: string[] } {
  const t = names(set, cfg);
  const cur = names(eq, cfg);
  const mancano = difference(t, cur);
  return { uguali: difference(t, mancano), mancano, inPiu: difference(cur, t) };
}

export function plan(set: Piece[], L: Reading, cfg: GearConfig): Plan {
  const cur = L.eq
    .filter((p) => !isStorage(p.nome, cfg))
    .map((p) => ({ nome: p.nome, slot: p.slot }));

  const libero = cur.map(() => true);
  const tenuto: (Piece | undefined)[] = cur.map(() => undefined);
  const metti: ToWear[] = [];
  for (const w of set) {
    if (isStorage(w.nome, cfg)) continue;
    const i = cur.findIndex((p, j) => libero[j] && p.nome === w.nome);
    if (i >= 0) {
      libero[i] = false;
      tenuto[i] = w;
    } else metti.push({ nome: w.nome, slot: w.slot });
  }
  // Pezzi con la stessa parola chiave di uno da togliere: `remove` sceglie da solo quale
  // togliere (e `2.` non funziona), quindi si tolgono tutti all'inizio e si rimettono quelli
  // che restano (log reale: due Verdespina, tolta quella come luce invece di quella in mano).
  const k = (n: string) => keyword(n, cfg);
  const doppie = new Set(cur.filter((_, i) => libero[i]).map((p) => k(p.nome)));
  // anche se la parola di un pezzo da togliere è l'inizio della sua (`bracciale` toglierebbe il
  // braccialetto, log del 2026-11-24)
  const prende = (tolta: string, altra: string) => altra.startsWith(tolta);
  const rimetti = new Set<number>();
  cur.forEach((p, i) => {
    if (libero[i] || ![...doppie].some((d) => prende(d, k(p.nome)))) return;
    libero[i] = true;
    rimetti.add(i);
    metti.push({ nome: tenuto[i]!.nome, slot: tenuto[i]!.slot, da: 'inv' });
  });
  const togli: ToRemove[] = cur
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => libero[i])
    .map(({ p, i }) => ({ ...p, a: rimetti.has(i) ? 'inv' : placeOf(p.nome, cfg) }));

  const count = (list?: Seen[]) => {
    const t = new Map<string, number>();
    for (const p of list ?? []) t.set(p.nome, (t.get(p.nome) ?? 0) + p.quantita);
    return t;
  };
  const take = (m: Map<string, number>, n: string) => {
    const k = m.get(n) ?? 0;
    if (k <= 0) return false;
    m.set(n, k - 1);
    return true;
  };
  const inv = count(L.inv);
  const boxes = cfg.contenitori.map((c) => ({
    parola: c.parola,
    noto: L.contenuti[c.parola] !== undefined,
    roba: count(L.contenuti[c.parola]),
  }));
  const ignoto = boxes.find((b) => !b.noto);
  const mancanti: string[] = [];
  for (const w of metti) {
    if (w.da) continue; // da rimettere: è appena stato tolto, è in inventario
    if (take(inv, w.nome)) w.da = 'inv';
    else {
      const b = boxes.find((x) => x.noto && take(x.roba, w.nome));
      // non letto: prima nel suo posto (dove va quando lo togli), poi nel primo non letto
      const suo = boxes.find((x) => !x.noto && x.parola === cfg.posti[w.nome]);
      if (b) w.da = b.parola;
      else if (suo ?? ignoto) {
        w.da = (suo ?? ignoto)!.parola;
        w.presunto = true;
      } else {
        const dove = ['inventario', ...cfg.contenitori.map((c) => c.parola)].join(', ');
        mancanti.push(`${w.nome} (non e' in: ${dove})`);
      }
    }
  }

  // coppie: il pezzo nuovo prende il posto del vecchio
  // i doppi da rimettere si tolgono tutti subito, senza abbinarli
  const conflitto = new Set([...rimetti].map((i) => k(cur[i].nome)));
  // pezzi da togliere con parole una l'inizio dell'altra: tutti subito, prima la più lunga
  const kt = togli.map((r) => k(r.nome));
  const prefisso = new Set<number>();
  kt.forEach((a, i) =>
    kt.forEach((b, j) => {
      if (a !== b && b.startsWith(a)) prefisso.add(i).add(j);
    }),
  );
  const subito = (r: ToRemove, i: number) => conflitto.has(k(r.nome)) || prefisso.has(i);
  const usato = togli.map((r, i) => subito(r, i));
  const coppia = new Map<number, ToRemove>();
  const abbina = (f: (r: ToRemove, w: ToWear) => boolean) => {
    metti.forEach((w, wi) => {
      if (coppia.has(wi)) return;
      const ri = togli.findIndex((r, i) => !usato[i] && f(r, w));
      if (ri >= 0) {
        usato[ri] = true;
        coppia.set(wi, togli[ri]);
      }
    });
  };
  abbina((r, w) => !!w.slot && r.slot === w.slot);
  abbina((r, w) => keyword(r.nome, cfg) === keyword(w.nome, cfg));

  const passi: string[] = [];
  const alt: Record<string, string> = {};
  const giu = (r: ToRemove) => {
    const k = keyword(r.nome, cfg);
    passi.push(`remove ${k}`);
    if (r.a !== 'inv') passi.push(`put ${k} ${r.a}`);
  };
  const su = (w: ToWear) => {
    if (!w.da) return;
    const k = keyword(w.nome, cfg);
    if (w.da !== 'inv') passi.push(`get ${k} ${w.da}`);
    const cmd = useCommand(w, cfg);
    passi.push(`${cmd} ${k}`);
    if (cmd === 'hold') alt[`${cmd} ${k}`] = `wear ${k}`;
  };
  // `bracciale` dopo `braccialetto`: sia tra i pezzi da togliere sia tra quelli da prendere
  prefixSafe(
    togli.map((r, i) => ({ r, i })),
    (x) => k(x.r.nome),
  ).forEach(({ r, i }) => (!usato[i] || subito(r, i)) && giu(r));
  const ordine = prefixSafe(
    metti.map((w, wi) => ({ w, wi })),
    (x) => k(x.w.nome),
  );
  ordine.forEach(({ w, wi }) => {
    const r = coppia.get(wi);
    if (r) {
      giu(r);
      su(w);
    }
  });
  ordine.forEach(({ w, wi }) => !coppia.has(wi) && su(w));

  const usati = cfg.contenitori
    .map((c) => c.parola)
    .filter((k) => passi.some((p) => p.endsWith(` ${k}`)));
  return { passi, alt, mancanti, togli, metti, usati };
}
