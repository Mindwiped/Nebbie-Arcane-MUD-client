import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/eventBus';
import type { ClientEvents } from '../../core/events';
import { Executor } from '../../core/sequence/executor';
import { parseEqsetConfig } from './legacyEqset';
import { parseItem } from '../parser/nebbieParser';
import {
  defaultGearConfig,
  fromEqset,
  needsContainers,
  parseGearConfig,
  placeOf,
  uniqueKeys,
  type GearConfig,
} from './config';
import { Gear, repairPlan } from './gear';
import { GearModel, parseGesture } from './model';
import { plan } from './plan';

const rows = (list: [string, string?][]) => list.map(([n, s], i) => parseItem(i + 1, n, s));

function cfgAB(): GearConfig {
  const cfg = defaultGearConfig();
  cfg.contenitori = [
    { parola: 'compendium', nome: 'compendium', dove: 'indossato', togliPerUsare: true },
    { parola: 'korred', nome: 'korred', dove: 'dentro', in: 'compendium' },
  ];
  cfg.chiavi = { 'Il focus a prisma instabile': 'prisma' };
  cfg.usa = { 'Il focus a prisma instabile': 'hold' };
  cfg.sets = {
    a: [
      { nome: 'Verdespina', slot: 'come luce' },
      { nome: 'Un Anello dei nani', slot: 'sul dito destro' },
    ],
    b: [
      { nome: 'Verdespina', slot: 'come luce' },
      { nome: 'Il focus a prisma instabile', slot: 'tenuto' },
    ],
  };
  return cfg;
}

describe('gesti (testi reali)', () => {
  it('riconosce togli, indossa, prendi, metti, posa', () => {
    expect(parseGesture('Smetti di usare un Anello dei nani.')).toEqual({
      tipo: 'togli',
      nome: 'un Anello dei nani',
    });
    expect(parseGesture('Indossi Anello Dorato Nanesco su un dito della mano destra.')).toEqual({
      tipo: 'indossa',
      nome: 'Anello Dorato Nanesco',
    });
    expect(parseGesture('Ti metti Compendium Maleficarum sulle spalle.')).toMatchObject({
      tipo: 'indossa',
      nome: 'Compendium Maleficarum',
    });
    expect(
      parseGesture("Prendi Ali di Farfalla da il corpo di L'Uomo della Medicina. (x3)"),
    ).toEqual({
      tipo: 'prendi',
      nome: 'Ali di Farfalla',
      da: "il corpo di L'Uomo della Medicina",
      n: 3,
    });
    expect(parseGesture('Metti Anello Dorato Nanesco in Compendium Maleficarum.')).toEqual({
      tipo: 'metti',
      nome: 'Anello Dorato Nanesco',
      in: 'Compendium Maleficarum',
      n: 1,
    });
    expect(parseGesture("Posi Lente dell'Individuazione.")).toMatchObject({ tipo: 'posa' });
    for (const [t, nome] of [
      ["Indossi un corpetto nebbioso d'argento.", "un corpetto nebbioso d'argento"],
      ["Usi Scudo d'Ebano.", "Scudo d'Ebano"],
      ["Ti avvolgi con Pelle d'orso bruno.", "Pelle d'orso bruno"],
      ['Prendi Verdespina in mano.', 'Verdespina'],
      ['Metti Guanti di cuoio borchiati sulle mani.', 'Guanti di cuoio borchiati'],
      [
        'Ti metti il bacinetto dalla cresta argentata in testa.',
        'il bacinetto dalla cresta argentata',
      ],
    ])
      expect(parseGesture(t)).toEqual({ tipo: 'indossa', nome });
    expect(
      parseGesture('Metti la corazza dalla piastra oscura in Borsa Inesauribile dei Korred.'),
    ).toMatchObject({
      tipo: 'metti',
      in: 'Borsa Inesauribile dei Korred',
    });
    expect(parseGesture("Non sembra che tu abbia un '2.ane'.")).toBeUndefined();
  });

  it('il modello segue i gesti tra una lettura e l altra', () => {
    const m = new GearModel(() => 1);
    m.setWorn(rows([['Un Anello dei nani (in condizioni eccellenti)', 'sul dito destro']]));
    m.setInventory(rows([['Compendium Maleficarum']]));
    m.setContainer(
      'Compendium Maleficarum',
      rows([['Anello Dorato Nanesco'], ['Ali di Farfalla[8]']]),
    );
    m.line('Smetti di usare un Anello dei nani.');
    m.line('Metti un Anello dei nani in Compendium Maleficarum.');
    m.line('Prendi Anello Dorato Nanesco da Compendium Maleficarum.');
    m.line('Indossi Anello Dorato Nanesco su un dito della mano destra.');
    m.line('Prendi Ali di Farfalla da Compendium Maleficarum. (x3)');
    const s = m.snapshot;
    expect(s.addosso.righe.map((r) => r.nome)).toEqual(['Anello Dorato Nanesco']);
    expect(s.addosso.toccato).toBe(true);
    expect(s.inventario.righe.map((r) => `${r.nome}×${r.quantita}`)).toEqual([
      'Compendium Maleficarum×1',
      'Ali di Farfalla×3',
    ]);
    expect(m.container('compendium')!.righe.map((r) => `${r.nome}×${r.quantita}`)).toEqual([
      'Ali di Farfalla×5',
      'Un Anello dei nani×1',
    ]);
  });
});

describe('configurazione', () => {
  it('il vecchio EqSet diventa due contenitori (compendium e borsa dentro)', () => {
    const old = parseEqsetConfig({
      borsa: 'korred',
      sets: { a: [{ nome: 'X', slot: 's' }] },
      posti: { X: 'borsa', Y: 'inv' },
    });
    const g = fromEqset(old);
    expect(g.contenitori).toEqual([
      { parola: 'compendium', nome: 'compendium', dove: 'indossato', togliPerUsare: true },
      { parola: 'korred', nome: 'korred', dove: 'dentro', in: 'compendium' },
    ]);
    expect(g.posti).toMatchObject({ X: 'korred', Y: 'inv' });
    expect(parseGearConfig(JSON.parse(JSON.stringify(g)))).toEqual(g);
  });
});

describe('piano', () => {
  it('toglie, ripone, prende dal contenitore, hold con alternativa wear', () => {
    const P = plan(
      cfgAB().sets.b,
      {
        eq: [
          { nome: 'Verdespina', slot: 'come luce', quantita: 1 },
          { nome: 'Un Anello dei nani', slot: 'sul dito destro', quantita: 1 },
          { nome: 'Compendium Maleficarum', slot: 'sulla schiena', quantita: 1 },
        ],
        inv: [],
        contenuti: {
          compendium: [{ nome: 'Il focus a prisma instabile', quantita: 1 }],
          korred: [],
        },
      },
      cfgAB(),
    );
    expect(P.passi).toEqual([
      'remove nani',
      'put nani compendium',
      'get prisma compendium',
      'hold prisma',
    ]);
    expect(P.alt).toEqual({ 'hold prisma': 'wear prisma' });
    expect(P.usati).toEqual(['compendium']);
  });

  it('borsa non letta: il pezzo si presume lì; letta e vuota: manca', () => {
    const base = { eq: [], inv: [] };
    const P1 = plan(cfgAB().sets.b, { ...base, contenuti: { compendium: [] } }, cfgAB());
    expect(P1.metti.find((w) => w.nome.startsWith('Il focus'))).toMatchObject({
      da: 'korred',
      presunto: true,
    });
    const P2 = plan(
      cfgAB().sets.b,
      { ...base, contenuti: { compendium: [], korred: [] } },
      cfgAB(),
    );
    expect(P2.mancanti).toHaveLength(2);
  });
});

describe('riparazione', () => {
  it('ripara i gruppi con danni, i doppi senza 2.', () => {
    const cfg = cfgAB();
    const worn = [
      {
        nome: 'Un Anello dei nani',
        quantita: 1,
        slot: 'a',
        condizione: 'in condizioni eccellenti',
      },
      { nome: 'Un Anello dei nani', quantita: 1, slot: 'b', condizione: 'graffiato' },
      { nome: 'Verdespina', quantita: 1, slot: 'come luce' },
      {
        nome: 'Compendium Maleficarum',
        quantita: 1,
        slot: 'sulla schiena',
        condizione: 'rovinato',
      },
    ];
    expect(repairPlan(worn, cfg).comandi).toEqual([
      'remove nani',
      'give nani fabbro',
      'remove nani',
      'give nani fabbro',
      'wear nani',
      'wear nani',
    ]);
  });
});

/** Finto MUD: ogni comando ha una risposta, poi il prompt. */
function mud(cfg: GearConfig, responses: Record<string, (bus: EventBus<ClientEvents>) => void>) {
  const bus = new EventBus<ClientEvents>();
  const sent: string[] = [];
  const infos: string[] = [];
  const ex = new Executor({
    send: async (cmd) => {
      sent.push(cmd);
      setTimeout(() => {
        (responses[cmd] ?? ((b) => b.emit('line', { text: 'Ok.', spans: [] })))(bus);
        ex.prompt({ inCombattimento: false });
      }, 0);
    },
    info: (t) => void infos.push(t),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  bus.on('line', ({ text }) => ex.event('line', text));
  for (const ev of ['equipmentList', 'inventoryList', 'containerList'] as const)
    bus.on(ev, (d) => ex.event(ev, d));
  const gear = new Gear({
    bus,
    executor: ex,
    info: (t) => void infos.push(t),
    connected: () => true,
  });
  gear.setConfig(cfg);
  return { bus, sent, infos, gear, ex };
}

const flush = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('cambio di set con un finto MUD', () => {
  function scenario(opts: { holdFails?: boolean; inBorsa?: boolean; getFails?: boolean } = {}) {
    let worn: 'a' | 'b' = 'a';
    let compendiumAddosso = true;
    const line = (b: EventBus<ClientEvents>, text: string) => b.emit('line', { text, spans: [] });
    const m = mud(cfgAB(), {
      eq: (b) =>
        b.emit('equipmentList', {
          righe: rows([
            ['Verdespina', 'come luce'],
            worn === 'a'
              ? ['Un Anello dei nani (in condizioni eccellenti)', 'sul dito destro']
              : ['Il focus a prisma instabile', 'tenuto'],
            ...(compendiumAddosso
              ? [['Compendium Maleficarum', 'sulla schiena'] as [string, string]]
              : []),
          ]),
        }),
      inv: (b) => b.emit('inventoryList', { righe: [] }),
      'remove compendium': (b) => {
        compendiumAddosso = false;
        line(b, 'Smetti di usare Compendium Maleficarum.');
      },
      'wear compendium': (b) => {
        compendiumAddosso = true;
        line(b, 'Ti metti Compendium Maleficarum sulle spalle.');
      },
      'exa compendium': (b) =>
        b.emit('containerList', {
          titolo: 'Compendium Maleficarum',
          righe: rows(
            opts.inBorsa
              ? [['Borsa Inesauribile dei Korred']]
              : [
                  ['Il focus a prisma instabile (ha un alone luminoso)'],
                  ['Borsa Inesauribile dei Korred'],
                ],
          ),
        }),
      'exa korred': (b) =>
        b.emit('containerList', {
          titolo: 'Borsa Inesauribile dei Korred',
          righe: rows([['Il focus a prisma instabile']]),
        }),
      ...(opts.getFails
        ? {
            'get prisma compendium': (b: EventBus<ClientEvents>) =>
              line(b, 'Non trovi nulla del genere.'),
          }
        : {}),
      'hold prisma': (b) => {
        if (opts.holdFails) line(b, 'Non puoi tenerlo.');
        else {
          worn = 'b';
          line(b, 'Impugni il focus.');
        }
      },
      'wear prisma': (b) => {
        worn = 'b';
        line(b, 'Indossi il focus.');
      },
    });
    return m;
  }

  it('legge, toglie il compendium, lo esamina, cambia, lo rimette e verifica', async () => {
    const { gear, sent, infos } = scenario();
    gear.command('eqset', 'b');
    await flush();
    expect(sent).toEqual([
      'eq',
      'inv',
      'remove compendium',
      'exa compendium',
      'remove nani',
      'put nani compendium',
      'get prisma compendium',
      'hold prisma',
      'wear compendium',
      'eq',
      'inv',
    ]);
    expect(infos.at(-1)).toBe('set b indossato.');
    expect(gear.state.attuale).toBe('b');
  });

  it('pezzo nella borsa: la tira fuori, la esamina e la rimette', async () => {
    const { gear, sent } = scenario({ inBorsa: true });
    gear.command('eqset', 'b');
    await flush();
    expect(sent).toEqual([
      'eq',
      'inv',
      'remove compendium',
      'exa compendium',
      'get korred compendium',
      'exa korred',
      'remove nani',
      'put nani compendium',
      'get prisma korred',
      'hold prisma',
      'put korred compendium',
      'wear compendium',
      'eq',
      'inv',
    ]);
  });

  it('hold fallito: prova wear', async () => {
    const { gear, sent, infos } = scenario({ holdFails: true });
    gear.command('eqset', 'b');
    await flush();
    expect(sent).toContain('wear prisma');
    expect(infos.some((i) => i.includes('hold prisma non riuscito, provo con wear prisma'))).toBe(
      true,
    );
    expect(infos.at(-1)).toBe('set b indossato.');
  });

  it('prova: mostra i comandi senza eseguirli e rimette il compendium', async () => {
    const { gear, sent, infos } = scenario();
    gear.command('eqset', 'prova b');
    await flush();
    expect(sent).toEqual(['eq', 'inv', 'remove compendium', 'exa compendium', 'wear compendium']);
    expect(infos).toContain(
      'remove nani, put nani compendium, get prisma compendium, hold prisma (o wear prisma)',
    );
  });

  it('un passo fallito ferma il cambio; chiudendolo i contenitori tornano a posto', async () => {
    const { gear, sent, ex } = scenario({ getFails: true });
    gear.command('eqset', 'b');
    await flush();
    expect(ex.state).toMatchObject({ stato: 'fermo', fallito: true });
    expect(sent.at(-1)).toBe('get prisma compendium');
    ex.close();
    await flush();
    expect(sent.at(-1)).toBe('wear compendium');
    expect(ex.state).toBeNull();
  });

  it('salva un set dall eq attuale (senza il compendium)', async () => {
    const saved: GearConfig[] = [];
    const { gear } = scenario();
    gear.onSave = (c) => saved.push(structuredClone(c));
    gear.command('eqset', 'salva caccia');
    await flush();
    expect(gear.cfg.sets.caccia.map((p) => p.nome)).toEqual(['Verdespina', 'Un Anello dei nani']);
    expect(saved).toHaveLength(1);
  });
});

describe('piano: doppi con la stessa parola chiave (log reale del 2026-11-13)', () => {
  it('due Verdespina, ne resta una: si tolgono entrambe e si rimette quella giusta', () => {
    const cfg = cfgAB();
    cfg.usa = { Verdespina: 'hold' };
    cfg.posti = { Verdespina: 'compendium' };
    const P = plan(
      [
        { nome: 'Verdespina', slot: 'come luce' },
        { nome: "Il grimorio argentato dell'indice", slot: 'tenuto' },
      ],
      {
        eq: [
          { nome: 'Verdespina', slot: 'come luce', quantita: 1 },
          { nome: 'Verdespina', slot: 'tenuto', quantita: 1 },
        ],
        inv: [],
        contenuti: {
          compendium: [{ nome: "Il grimorio argentato dell'indice", quantita: 1 }],
          korred: [],
        },
      },
      cfg,
    );
    expect(P.passi).toEqual([
      'remove verdespina',
      'remove verdespina',
      'put verdespina compendium',
      'get grimorio compendium',
      'hold grimorio',
      'hold verdespina',
    ]);
  });

  it('due anelli uguali da cambiare: come prima, a coppie', () => {
    const cfg = cfgAB();
    const P = plan(
      [
        { nome: 'Anello Dorato Nanesco', slot: 'sul dito destro' },
        { nome: 'Anello Dorato Nanesco', slot: 'sul dito sinistro' },
      ],
      {
        eq: [
          { nome: 'Un Anello dei nani', slot: 'sul dito destro', quantita: 1 },
          { nome: 'Un Anello dei nani', slot: 'sul dito sinistro', quantita: 1 },
        ],
        inv: [],
        contenuti: { compendium: [{ nome: 'Anello Dorato Nanesco', quantita: 2 }], korred: [] },
      },
      cfg,
    );
    expect(P.passi).toEqual([
      'remove nani',
      'put nani compendium',
      'get dorato compendium',
      'wear dorato',
      'remove nani',
      'put nani compendium',
      'get dorato compendium',
      'wear dorato',
    ]);
  });
});

describe('contenitori scelti per personaggio (2026-11-16)', () => {
  /** Un altro pg: un solo zaino in inventario, nomi diversi da compendium/korred. */
  function cfgZaino(destinazione?: string): GearConfig {
    const cfg = defaultGearConfig();
    cfg.contenitori = [{ parola: 'zaino', nome: 'zaino di cuoio', dove: 'inventario' }];
    if (destinazione) cfg.destinazione = destinazione;
    cfg.sets = { b: [{ nome: 'Verdespina', slot: 'come luce' }] };
    return cfg;
  }
  const reading = {
    eq: [{ nome: 'Un Anello dei nani', slot: 'come luce', quantita: 1 }],
    inv: [{ nome: 'Uno zaino di cuoio', quantita: 1 }],
    contenuti: { zaino: [{ nome: 'Verdespina', quantita: 1 }] },
  };

  it('un solo contenitore con un nome qualsiasi: prende e ripone lì', () => {
    const P = plan(cfgZaino().sets.b, reading, cfgZaino());
    expect(P.passi).toEqual([
      'remove nani',
      'put nani zaino',
      'get verdespina zaino',
      'wear verdespina',
    ]);
  });

  it('destinazione inventario: i pezzi tolti restano in inventario', () => {
    const cfg = cfgZaino('inv');
    expect(plan(cfg.sets.b, reading, cfg).passi).toEqual([
      'remove nani',
      'get verdespina zaino',
      'wear verdespina',
    ]);
    cfg.posti['Un Anello dei nani'] = 'zaino';
    expect(placeOf('Un Anello dei nani', cfg)).toBe('zaino');
    expect(placeOf('Altro', cfg)).toBe('inv');
  });

  it('la destinazione si salva; un pg mai impostato va chiesto', () => {
    const cfg = cfgZaino('zaino');
    expect(parseGearConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
    expect(needsContainers(cfg)).toBe(false);
    expect(needsContainers(defaultGearConfig())).toBe(true);
    const nessuno = defaultGearConfig();
    nessuno.destinazione = 'inv';
    expect(needsContainers(nessuno)).toBe(false);
    // Rigel (vecchia configurazione, nessuna destinazione): non chiede niente
    expect(needsContainers(cfgAB())).toBe(false);
  });

  it('pg nuovo: il cambio aspetta la scelta dei contenitori, poi parte', async () => {
    const cfg = defaultGearConfig();
    cfg.sets = { b: [{ nome: 'Verdespina', slot: 'come luce' }] };
    const m = mud(cfg, {});
    const asked: (string | undefined)[] = [];
    m.gear.onAskContainers = (s) => void asked.push(s);
    m.gear.change('b');
    await flush();
    expect(asked).toEqual(['b']);
    expect(m.sent).toEqual([]);
    m.gear.cancelContainers();
    m.gear.change('b');
    m.gear.setContainers([{ parola: 'sacca', nome: 'sacca', dove: 'indossato' }], 'sacca');
    await flush();
    expect(m.gear.cfg.destinazione).toBe('sacca');
    expect(m.sent[0]).toBe('eq'); // il cambio è partito
  });
});

describe('zaino e korred: parole chiave univoche e riordino (2026-11-24)', () => {
  it('parole chiave: niente doppioni anche come inizio di parola', () => {
    const vere: Record<string, string> = {
      'Guanti di cuoio borchiati': 'guanti cuoio borchiati',
      'I guanti dal palmo argentato': 'guanti nebbia palmo argentato',
      'I guanti dalla presa oscura': 'guanti varco presa oscura',
      "I coturni d'argento del drago": 'calzari coturni argento drago effimera',
      'I calzari dalla suola argentata': 'calzari nebbia suola argentata',
      'Braccialetti di granito': 'braccialetti granito',
    };
    const cfg = defaultGearConfig();
    cfg.chiavi = { 'Il focus a prisma instabile': 'prisma' };
    const nomi = [
      ...Object.keys(vere),
      'Bracciale dei Rintocchi Muti',
      'Bracciale dei Rintocchi Ultimi',
      'Il focus a prisma instabile',
      'Collare di radici',
      'Collare di radici',
    ];
    const r = uniqueKeys(nomi, (n) => vere[n]?.split(' '), cfg);
    expect(r.chiavi).toEqual({
      'Guanti di cuoio borchiati': 'cuoio',
      'I guanti dal palmo argentato': 'palmo',
      'I guanti dalla presa oscura': 'varco',
      'I calzari dalla suola argentata': 'suola',
      'Bracciale dei Rintocchi Muti': 'muti',
      'Bracciale dei Rintocchi Ultimi': 'ultimi',
    });
    // i due Bracciale non hanno parole chiave note: scelte dal nome
    expect(r.dubbi).toEqual(['Bracciale dei Rintocchi Muti', 'Bracciale dei Rintocchi Ultimi']);
    expect(r.irrisolti).toEqual([]);
  });

  function borse(): GearConfig {
    const cfg = defaultGearConfig();
    cfg.contenitori = [
      { parola: 'compendium', nome: 'compendium', dove: 'indossato', togliPerUsare: true },
      { parola: 'korred', nome: 'korred', dove: 'dentro', in: 'compendium' },
      { parola: 'zaino', nome: 'zaino', dove: 'dentro', in: 'compendium' },
    ];
    cfg.posti = {
      "Pelle d'orso bruno": 'zaino',
      'Scarponi chiodati': 'zaino',
      'Il tabarro rosso delle acque nere': 'korred',
    };
    cfg.sets = {
      default: [{ nome: 'Scarponi chiodati', slot: 'ai piedi' }],
      istanza: [{ nome: 'I sandali amaranto', slot: 'ai piedi' }],
    };
    cfg.posti['I sandali amaranto'] = 'korred';
    return cfg;
  }

  function borseMud(eqNome: string) {
    let compendium = true;
    const line = (b: EventBus<ClientEvents>, text: string) => b.emit('line', { text, spans: [] });
    return mud(borse(), {
      eq: (b) =>
        b.emit('equipmentList', {
          righe: rows([
            [eqNome, 'ai piedi'],
            ...(compendium
              ? [['Compendium Maleficarum', 'sulla schiena'] as [string, string]]
              : []),
          ]),
        }),
      inv: (b) => b.emit('inventoryList', { righe: [] }),
      'remove compendium': (b) => {
        compendium = false;
        line(b, 'Smetti di usare Compendium Maleficarum.');
      },
      'wear compendium': (b) => {
        compendium = true;
        line(b, 'Ti metti Compendium Maleficarum sulle spalle.');
      },
      'exa compendium': (b) =>
        b.emit('containerList', {
          titolo: 'Compendium Maleficarum',
          righe: rows([
            ['Uno zaino di pelle lavorata'],
            ['Borsa Inesauribile dei Korred'],
            ['Il tabarro rosso delle acque nere (in condizioni eccellenti)'],
            ["Pelle d'orso bruno"],
          ]),
        }),
      'exa korred': (b) =>
        b.emit('containerList', {
          titolo: 'Borsa Inesauribile dei Korred',
          righe: rows([['I sandali amaranto']]),
        }),
      'exa zaino': (b) =>
        b.emit('containerList', {
          titolo: 'Uno zaino di pelle lavorata',
          righe: rows([['Scarponi chiodati']]),
        }),
    });
  }

  it('eqset riordina: ogni pezzo nella sua borsa, poi tutto rimesso a posto', async () => {
    const { gear, sent, infos } = borseMud('I sandali amaranto');
    gear.command('eqset', 'riordina');
    await flush();
    expect(sent).toEqual([
      'eq',
      'inv',
      'remove compendium',
      'exa compendium',
      'get korred compendium',
      'exa korred',
      'get zaino compendium',
      'exa zaino',
      'get tabarro compendium',
      'put tabarro korred',
      'get pelle compendium',
      'put pelle zaino',
      'put zaino compendium',
      'put korred compendium',
      'wear compendium',
      'inv',
    ]);
    expect(infos).toContain('  Il tabarro rosso delle acque nere: compendium -> korred');
    expect(infos.at(-1)).toBe('borse riordinate.');
  });

  it('eqset riordina prova: solo l elenco, nessuno spostamento', async () => {
    const { gear, sent } = borseMud('I sandali amaranto');
    gear.command('eqset', 'riordina prova');
    await flush();
    expect(sent.filter((c) => c.startsWith('put ') && !c.endsWith(' compendium'))).toEqual([]);
    expect(sent.at(-1)).toBe('wear compendium');
  });

  it('cambio di set: il pezzo si cerca prima nella sua borsa (lo zaino), e il tolto va nel suo posto', async () => {
    const { gear, sent, infos } = borseMud('I sandali amaranto');
    gear.command('eqset', 'default');
    await flush();
    expect(sent).toEqual([
      'eq',
      'inv',
      'remove compendium',
      'exa compendium',
      'get zaino compendium',
      'exa zaino',
      'get korred compendium',
      'remove sandali',
      'put sandali korred',
      'get scarponi zaino',
      'wear scarponi',
      'put korred compendium',
      'put zaino compendium',
      'wear compendium',
      'eq',
      'inv',
    ]);
    void infos;
  });

  it('bracciale e braccialetto: prima il braccialetto, poi il bracciale (MUD a prefisso)', () => {
    const cfg = defaultGearConfig();
    cfg.contenitori = [
      { parola: 'compendium', nome: 'compendium', dove: 'indossato', togliPerUsare: true },
      { parola: 'korred', nome: 'korred', dove: 'dentro', in: 'compendium' },
      { parola: 'zaino', nome: 'zaino', dove: 'dentro', in: 'compendium' },
    ];
    cfg.chiavi = {
      'Bracciale dei Rintocchi Muti': 'bracciale',
      'Bracciale dei Rintocchi Ultimi': 'braccialetto',
    };
    cfg.usa = { 'Cero della Veglia Funebre': 'hold' };
    cfg.posti = {
      'Bracciale dei Rintocchi Muti': 'korred',
      'Bracciale dei Rintocchi Ultimi': 'korred',
      'Cero della Veglia Funebre': 'korred',
      'Braccialetti di granito': 'zaino',
      Verdespina: 'zaino',
    };
    const istanza = [
      { nome: 'Cero della Veglia Funebre', slot: 'come luce' },
      { nome: 'Bracciale dei Rintocchi Muti', slot: 'al polso destro' },
      { nome: 'Bracciale dei Rintocchi Ultimi', slot: 'al polso sinistro' },
    ];
    const P = plan(
      istanza,
      {
        eq: [
          { nome: 'Verdespina', slot: 'come luce', quantita: 1 },
          { nome: 'Braccialetti di granito', slot: 'al polso destro', quantita: 1 },
          { nome: 'Braccialetti di granito', slot: 'al polso sinistro', quantita: 1 },
        ],
        inv: [],
        contenuti: {
          compendium: [],
          zaino: [],
          korred: [
            { nome: 'Bracciale dei Rintocchi Muti', quantita: 1 },
            { nome: 'Bracciale dei Rintocchi Ultimi', quantita: 1 },
            { nome: 'Cero della Veglia Funebre', quantita: 1 },
          ],
        },
      },
      cfg,
    );
    const g = P.passi.filter((c) => c.startsWith('get '));
    expect(g.indexOf('get braccialetto korred')).toBeLessThan(g.indexOf('get bracciale korred'));
    expect(P.passi).toContain('hold cero');
    expect(P.alt['hold cero']).toBe('wear cero');
    expect(P.mancanti).toEqual([]);
  });

  it('da istanza a default (log del 2026-11-24): braccialetto tolto prima del bracciale', () => {
    const cfg = defaultGearConfig();
    cfg.contenitori = [
      { parola: 'compendium', nome: 'compendium', dove: 'indossato', togliPerUsare: true },
      { parola: 'korred', nome: 'korred', dove: 'dentro', in: 'compendium' },
      { parola: 'zaino', nome: 'zaino', dove: 'dentro', in: 'compendium' },
    ];
    cfg.chiavi = {
      'Bracciale dei Rintocchi Muti': 'bracciale',
      'Bracciale dei Rintocchi Ultimi': 'braccialetto',
    };
    cfg.posti = {
      'Bracciale dei Rintocchi Muti': 'korred',
      'Bracciale dei Rintocchi Ultimi': 'korred',
      'Braccialetti di granito': 'zaino',
    };
    const eq = [
      { nome: 'Bracciale dei Rintocchi Ultimi', slot: 'al polso destro', quantita: 1 },
      { nome: 'Bracciale dei Rintocchi Muti', slot: 'al polso sinistro', quantita: 1 },
    ];
    const zaino = [{ nome: 'Braccialetti di granito', quantita: 2 }];
    // anche con gli slot rovinati dal vecchio salvataggio (tutti e due "al polso destro")
    for (const sinistro of ['al polso sinistro', 'al polso destro']) {
      const def = [
        { nome: 'Braccialetti di granito', slot: 'al polso destro' },
        { nome: 'Braccialetti di granito', slot: sinistro },
      ];
      const P = plan(def, { eq, inv: [], contenuti: { compendium: [], korred: [], zaino } }, cfg);
      const rm = P.passi.filter((c) => c.startsWith('remove '));
      expect(rm).toEqual(['remove braccialetto', 'remove bracciale']);
      expect(P.passi.indexOf('remove bracciale')).toBeLessThan(
        P.passi.indexOf('wear braccialetti'),
      );
      expect(P.passi.filter((c) => c === 'wear braccialetti')).toHaveLength(2);
    }
  });

  it('bracciale da togliere con il braccialetto che resta: si toglie anche quello e si rimette', () => {
    const cfg = defaultGearConfig();
    cfg.chiavi = {
      'Bracciale dei Rintocchi Muti': 'bracciale',
      'Bracciale dei Rintocchi Ultimi': 'braccialetto',
    };
    const eq = [
      { nome: 'Bracciale dei Rintocchi Ultimi', slot: 'al polso destro', quantita: 1 },
      { nome: 'Bracciale dei Rintocchi Muti', slot: 'al polso sinistro', quantita: 1 },
    ];
    const set = [
      { nome: 'Bracciale dei Rintocchi Ultimi', slot: 'al polso destro' },
      { nome: 'Il polsino sinistro bianco', slot: 'al polso sinistro' },
    ];
    const P = plan(
      set,
      { eq, inv: [{ nome: 'Il polsino sinistro bianco', quantita: 1 }], contenuti: {} },
      cfg,
    );
    expect(P.passi.slice(0, 2)).toEqual(['remove braccialetto', 'remove bracciale']);
    expect(P.passi).toContain('wear braccialetto');
    expect(P.passi).toContain('wear polsino');
  });
});

describe('slot dei pezzi doppi', () => {
  it('a fine cambio ogni lobo prende il suo orecchio', async () => {
    const cfg = defaultGearConfig();
    cfg.sets = {
      x: [
        { nome: 'Lobo incancrenito', slot: "all'orecchio destro" },
        { nome: 'Lobo incancrenito', slot: "all'orecchio destro" },
        { nome: 'Verdespina', slot: 'come luce' },
      ],
    };
    cfg.destinazione = 'inv';
    let messo = false;
    const m = mud(cfg, {
      eq: (b) =>
        b.emit('equipmentList', {
          righe: rows([
            ['Lobo incancrenito', "all'orecchio destro"],
            ['Lobo incancrenito', "all'orecchio sinistro"],
            ...(messo ? [['Verdespina', 'come luce'] as [string, string]] : []),
          ]),
        }),
      inv: (b) => b.emit('inventoryList', { righe: messo ? [] : rows([['Verdespina']]) }),
      'wear verdespina': (b) => {
        messo = true;
        b.emit('line', { text: 'Ti metti Verdespina come luce.', spans: [] });
      },
    });
    m.gear.command('eqset', 'x');
    await flush();
    expect(m.gear.cfg.sets.x.map((p) => p.slot)).toEqual([
      "all'orecchio destro",
      "all'orecchio sinistro",
      'come luce',
    ]);
  });
});
