import { describe, expect, it } from 'vitest';
import { KeepActive, parseKeepEntry, type KeepHost } from './keepActive';

function setup(opts: { busy?: boolean } = {}) {
  let now = 1000;
  const casts: string[] = [];
  const infos: string[] = [];
  const timers: (() => void)[] = [];
  let busy = opts.busy ?? false;
  const host: KeepHost = {
    now: () => now,
    cast: (c, m) => void casts.push(`${c} | ${m}`),
    info: (t) => void infos.push(t),
    busy: () => busy,
    ready: () => true,
    later: (fn) => void timers.push(fn),
  };
  const k = new KeepActive(host);
  k.enabled = true;
  k.entries = [
    { incantesimo: 'armor', bersaglio: '{pg}' },
    { incantesimo: 'stone skin', bersaglio: '' },
    { incantesimo: 'shield', bersaglio: '{pg}' },
  ];
  return {
    k,
    casts,
    infos,
    timers,
    advance: (ms: number) => (now += ms),
    setBusy: (b: boolean) => (busy = b),
    get now() {
      return now;
    },
  };
}

describe('Mantieni attivi', () => {
  it("rilancia solo a fine incantesimo (con l'avviso è ancora attivo); ignora gli altri", () => {
    const { k, casts } = setup();
    k.wearOff('stone skin', true); // "vacilla": ancora attivo, il MUD non lo rilancerebbe
    k.wearOff('Armor', true);
    expect(casts).toEqual([]);
    k.wearOff('stone skin', false);
    k.wearOff('fireshield', false);
    expect(casts).toEqual(["cast 'stone skin' | stone skin finito"]);
  });

  it('spento per un solo incantesimo: non si rilancia, ma il ⟳ a mano sì', () => {
    const { k, casts } = setup();
    k.entries = k.entries.map((e) => (e.incantesimo === 'armor' ? { ...e, attivo: false } : e));
    k.wearOff('armor', false);
    expect(casts).toEqual([]);
    k.castNow('armor');
    expect(casts).toEqual(["cast 'armor' {pg} | armor a mano"]);
  });

  it('spento mentre aspettava il rilancio: esce dalla coda', () => {
    const { k, casts, setBusy } = setup();
    setBusy(true);
    k.wearOff('shield', false);
    expect(k.waiting.map((w) => w.nome)).toEqual(['shield']);
    k.entries = k.entries.map((e) => (e.incantesimo === 'shield' ? { ...e, attivo: false } : e));
    k.prune();
    setBusy(false);
    k.flush();
    expect(k.waiting).toEqual([]);
    expect(casts).toEqual([]);
    expect(parseKeepEntry({ incantesimo: 'shield', attivo: false })?.attivo).toBe(false);
    expect(parseKeepEntry({ incantesimo: 'shield' })).not.toHaveProperty('attivo');
  });

  it('nessun doppio lancio; riprova senza "Pronunci le parole", poi rinuncia', () => {
    const { k, casts, infos, advance, timers } = setup();
    k.wearOff('stone skin', false);
    k.wearOff('stone skin', false); // messaggio e lettera del prompt insieme
    expect(casts).toHaveLength(1);
    advance(9000);
    timers.shift()!();
    advance(9000);
    k.prompt(500);
    advance(9000);
    k.prompt(500);
    expect(casts).toHaveLength(3);
    expect(infos.at(-1)).toContain('rinuncio');
  });

  it('un lancio alla volta: il MUD li esegue in coda (log reale del 2026-11-16)', () => {
    const { k, casts, advance } = setup();
    // dispel magic: finiscono tutti insieme
    k.wearOff('armor', false);
    k.wearOff('stone skin', false);
    k.wearOff('shield', false);
    expect(casts).toEqual(["cast 'armor' {pg} | armor finito"]);
    advance(3000);
    k.prompt(500);
    expect(casts).toHaveLength(1); // armor non ha ancora risposto
    k.spellCast('armor');
    k.prompt(480);
    expect(casts.at(-1)).toContain("cast 'stone skin'");
    // 7 s in coda dietro ai comandi dell'utente: prima si riprovava e partiva due volte
    advance(7000);
    k.prompt(480);
    expect(casts).toHaveLength(2);
    k.spellCast('stone skin');
    k.prompt(440);
    k.spellCast('shield'); // il terzo arriva dopo il secondo
    k.prompt(400);
    expect(casts.map((c) => c.split(' | ')[0])).toEqual([
      "cast 'armor' {pg}",
      "cast 'stone skin'",
      "cast 'shield' {pg}",
    ]);
  });

  it('zona senza magia: niente tentativi a vuoto, riprova nella prossima stanza', () => {
    const { k, casts, advance } = setup();
    k.wearOff('stone skin', false);
    expect(casts).toHaveLength(1);
    k.noMagicZone(); // "Il mana si rifuta di scorrere in questa zona."
    advance(20_000);
    k.prompt(500);
    expect(casts).toHaveLength(1);
    expect(k.waiting[0]).toMatchObject({ tentativi: 0 });
    expect(k.waiting[0].motivo).toContain('zona senza magia');
    k.room();
    expect(casts).toHaveLength(2);
    expect(casts[1]).toBe("cast 'stone skin' | stone skin finito");
  });

  it('bersaglio che non si trova: rinuncia senza riprovare', () => {
    const { k, casts, infos, advance } = setup();
    k.wearOff('armor', false);
    k.wearOff('stone skin', false);
    advance(2000);
    k.targetMissing(); // "Non c'e' nessuno con quel nome qui."
    expect(infos.at(-1)).toContain('armor');
    expect(casts.at(-1)).toContain("cast 'stone skin'");
    expect(k.waiting.map((w) => w.nome)).toEqual(['stone skin']);
  });

  it('impara il costo dal prompt e aspetta i mana', () => {
    const { k, casts, advance } = setup();
    k.prompt(300);
    k.wearOff('stone skin', false);
    k.spellCast('stone skin');
    k.prompt(260);
    expect(k.costs).toEqual({ 'stone skin': 40 });
    // una misura più bassa (mana rigenerati nel frattempo) non abbassa il costo
    k.spellCast('stone skin');
    k.prompt(259);
    expect(k.costs).toEqual({ 'stone skin': 40 });
    k.prompt(30);
    advance(100);
    k.wearOff('stone skin', false);
    expect(casts).toHaveLength(1); // 30 < 40: aspetta
    expect(k.waiting[0].motivo).toContain('aspetto i mana');
    k.prompt(50);
    expect(casts).toHaveLength(2);
  });

  it('durante una sequenza aspetta, poi lancia', () => {
    const t = setup({ busy: true });
    t.k.wearOff('stone skin', false);
    expect(t.casts).toEqual([]);
    t.setBusy(false);
    t.k.flush();
    expect(t.casts).toHaveLength(1);
  });

  it('lettura tollerante (il vecchio campo quando si ignora)', () => {
    expect(parseKeepEntry({ incantesimo: ' fly ', quando: 30 })).toEqual({
      incantesimo: 'fly',
      bersaglio: '{pg}',
    });
    expect(parseKeepEntry({ incantesimo: '' })).toBeNull();
  });

  it('finito in combattimento: rilancia dopo la fine e il loot del cadavere', () => {
    const { k, casts, advance } = setup();
    k.fight(true);
    k.wearOff('stone skin', false);
    expect(k.waiting[0].motivo).toContain('aspetto la fine del combattimento e il loot');
    k.killed(); // "Il tuo sangue si gela al grido di morte di…"
    k.fight(false);
    expect(casts).toEqual([]); // combattimento finito, ma il loot non ancora
    advance(500);
    k.looted(); // "Prendi gold coins da il corpo di…"
    advance(500);
    k.looted();
    advance(1000);
    k.flush();
    expect(casts).toEqual([]); // loot ancora in corso
    advance(600);
    k.flush();
    expect(casts).toEqual(["cast 'stone skin' | stone skin finito"]);
  });

  it('mob ucciso ma niente loot: rilancia dopo qualche secondo; fuga: subito', () => {
    const t = setup();
    t.k.fight(true);
    t.k.wearOff('stone skin', false);
    t.k.killed();
    t.k.fight(false);
    t.advance(5000);
    t.k.flush();
    expect(t.casts).toEqual([]);
    t.advance(1100);
    t.k.flush();
    expect(t.casts).toHaveLength(1);
    // combattimento finito senza uccisioni (fuga): il rilancio parte subito
    t.k.spellCast('stone skin');
    t.k.fight(true);
    t.k.wearOff('armor', false);
    t.k.fight(false);
    expect(t.casts).toHaveLength(2);
  });

  it('loot mandato prima della fine del combattimento: aspetta le risposte anche col lag', () => {
    const { k, casts, advance } = setup();
    k.fight(true);
    k.wearOff('stone skin', false);
    k.killed();
    k.lootSent(); // get all.coin corp (parte alla morte del mob, prima del prompt)
    k.lootSent(); // get all.coin dust
    k.fight(false);
    advance(7000); // log reale con sir Goldblum: risposte dopo 7,5 s
    k.flush();
    expect(casts).toEqual([]);
    k.lootNone(); // "Non vedi nessun corp."
    advance(300);
    k.looted(); // "Prendi gold coins da a pile of dust and bones."
    advance(1000);
    k.flush();
    expect(casts).toEqual([]);
    advance(600);
    k.flush();
    expect(casts).toHaveLength(1);
  });

  it('risposte del loot che non arrivano: al massimo 15 s', () => {
    const { k, casts, advance } = setup();
    k.fight(true);
    k.wearOff('stone skin', false);
    k.killed();
    k.lootSent();
    k.fight(false);
    advance(14000);
    k.flush();
    expect(casts).toEqual([]);
    advance(1100);
    k.flush();
    expect(casts).toHaveLength(1);
  });
});
