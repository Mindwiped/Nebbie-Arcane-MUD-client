import { describe, expect, it } from 'vitest';
import {
  addIdentify,
  cleanName,
  emptyDb,
  containerNames,
  findRelic,
  identifiesFromText,
  IdentifyReader,
  parseDb,
  saveEquipment,
  searchRelics,
  serializeDb,
  statLine,
  type IdentifyCapture,
} from './reliquiario';
import { RelicStore, type RelicHost } from './store';

// Formato dell'identify di Nebbie (come nella wiki del gioco e nello script Mudlet "Identi").
const ANELLO = [
  "Oggetto: 'anello cristallo', Tipo di Oggetto ARMOR",
  "L'oggetto e': MAGIC ANTI-NEUTRAL ANTI-WARRIOR",
  'ANTI-MONK',
  'Peso: 2, Valore: 20.000, Costo di rent: 7500 [RARO]',
  'AC-apply di 5',
  "Ti puo' dare:",
  "Ti puo' dare : MANA by 28",
  "Ti puo' dare : MANA-REGEN by 13",
];
const SPADA = [
  "Oggetto: 'fire blade', Tipo di Oggetto WEAPON",
  "L'oggetto e': MAGIC ANTI-GOOD",
  'Peso: 40, Valore: 25000, Costo di rent: 12500 [RARO]',
  "Dado di danno: '2D8'",
  "Tipo di danno: 'SLASH'",
  "Ti puo' dare : HIT-N-DAM by 5",
];

function read(lines: string[], before: string[] = [], now = () => 1000) {
  const out: { c: IdentifyCapture; nome?: string }[] = [];
  const r = new IdentifyReader(now, (c, nome) => out.push({ c, nome }));
  for (const l of before) r.line(l);
  for (const l of lines) r.line(l);
  r.prompt();
  return out;
}

describe('Reliquiario: identify', () => {
  it('legge statistiche, flag su più righe, peso/valore/rent, AC', () => {
    const [{ c }] = read(ANELLO);
    expect(c).toMatchObject({
      chiave: 'anello cristallo',
      tipo: 'ARMOR',
      flags: ['MAGIC', 'ANTI-NEUTRAL', 'ANTI-WARRIOR', 'ANTI-MONK'],
      peso: 2,
      valore: 20000,
      rent: 7500,
      raro: true,
      ac: 5,
      stats: { MANA: 28, 'MANA-REGEN': 13 },
    });
    expect(c.extra).toEqual([]);
    const [{ c: s }] = read(SPADA);
    expect(s).toMatchObject({ dado: '2d8', tipoDanno: 'SLASH', stats: { 'HIT-N-DAM': 5 } });
  });

  it("il nome viene dall'ultimo oggetto tolto o preso, se compatibile e recente", () => {
    expect(read(ANELLO, ["Smetti di usare l'anello di cristallo."])[0].nome).toBe(
      "l'anello di cristallo",
    );
    let t = 0;
    const out: (string | undefined)[] = [];
    const r = new IdentifyReader(
      () => t,
      (_c, nome) => out.push(nome),
    );
    r.line('Prendi la spada di fuoco da uno zaino.');
    t = 200_000; // più di 3 minuti dopo
    for (const l of ANELLO) r.line(l);
    r.prompt();
    expect(out).toEqual([undefined]);
  });

  it("nel database: nome compatibile, posto dall'eq del pg, stesso oggetto aggiornato", () => {
    const db = emptyDb();
    db.pg.Rigel = { eq: [{ slot: 'sul dito destro', nome: "L'anello di cristallo" }] };
    const [{ c }] = read(ANELLO);
    const r = addIdentify(db, c, '2026-11-17', undefined, 'Rigel');
    expect(r.nuovo).toBe(true);
    expect(db.oggetti['anello cristallo']).toMatchObject({
      nome: "L'anello di cristallo",
      slot: 'sul dito destro',
      visto: '2026-11-17',
    });
    // lo stesso identify: aggiornato, non duplicato
    expect(addIdentify(db, read(ANELLO)[0].c, '2026-11-18').nuovo).toBe(false);
    // stesse parole chiave ma altre statistiche: un oggetto diverso
    const altro = read(ANELLO.map((l) => l.replace('MANA by 28', 'MANA by 30')))[0].c;
    expect(addIdentify(db, altro, '2026-11-18').chiave).toBe('anello cristallo (2)');
    expect(Object.keys(db.oggetti)).toHaveLength(2);
  });
});

describe('Reliquiario: eq e ricerca', () => {
  it("salva l'eq così com'è: i pezzi tolti spariscono, l'oggetto identificato resta", () => {
    const db = emptyDb();
    addIdentify(db, read(ANELLO)[0].c, '2026-11-17');
    const tutto = [
      { slot: 'come luce', nome: 'Verdespina' },
      { slot: 'davanti agli occhi', nome: "L'anello di cristallo" },
    ];
    saveEquipment(db, 'Rigel', tutto, '2026-11-17 10:00');
    expect(db.oggetti['anello cristallo'].slot).toBe('davanti agli occhi');
    saveEquipment(db, 'Rigel', [tutto[0]], '2026-11-17 10:01');
    expect(db.pg.Rigel.eq).toEqual([tutto[0]]);
    expect(db.oggetti['anello cristallo']).toMatchObject({
      nome: "L'anello di cristallo",
      slot: 'davanti agli occhi',
    });
  });

  it('trova gli oggetti per nome e cerca per statistica', () => {
    const db = emptyDb();
    addIdentify(db, read(ANELLO)[0].c, '2026-11-17', "l'anello di cristallo");
    addIdentify(db, read(SPADA)[0].c, '2026-11-17');
    expect(findRelic(db, "L'anello di cristallo (ha un alone luminoso)")?.chiave).toBe(
      'anello cristallo',
    );
    expect(findRelic(db, 'Una spada di fuoco')).toBeUndefined(); // "fire blade": nessuna parola in comune
    expect(searchRelics(db, 'mana-regen').map((o) => o.chiave)).toEqual(['anello cristallo']);
    expect(statLine(db.oggetti['fire blade'])).toBe('2d8 SLASH · HIT-N-DAM +5');
    expect(cleanName('Anello (luminoso) (ammaccato)')).toBe('Anello');
    // parola chiave di una parola sola (log reale del 2026-11-17)
    const cero = identifiesFromText(
      "Oggetto: 'cero', Tipo di Oggetto LIGHT\nProprietario: Rigel\nTi puo' dare : STR by 3",
    )[0];
    addIdentify(db, cero, '2026-11-17', 'Cero della Veglia Funebre');
    expect(db.oggetti.cero.nome).toBe('Cero della Veglia Funebre');
    delete db.oggetti.cero.nome;
    expect(findRelic(db, 'Cero della Veglia Funebre')?.chiave).toBe('cero');
    db.oggetti.elmo = {
      chiave: 'elmo',
      nome: 'Vikinghi Elmo Soti',
      tipo: 'ARMOR',
      flags: [],
      stats: { CON: 1 },
      extra: [],
    };
    expect(findRelic(db, "L'elmo con maschera oscura")).toBeUndefined();
  });

  it('file di Mudlet: tabelle vuote come [], campi della pagina conservati', () => {
    const db = parseDb(
      'window.MUD_DB = {"versione":1,"pg":[],"oggetti":{"rose":{"chiave":"rose","stats":[],"flags":["MAGIC"],"extra":[],"tipo":"LIGHT","categoria":"Luce"}}};\n',
    );
    expect(db.oggetti.rose.stats).toEqual({});
    expect(db.oggetti.rose.categoria).toBe('Luce');
    expect(db.pg).toEqual({});
    expect(parseDb(serializeDb(db))).toEqual(db);
    expect(() => parseDb('window.MUD_DB = {rotto')).toThrow();
  });
});

describe('Reliquiario: file', () => {
  function host(file: string | null) {
    const h = {
      file,
      writes: 0,
      infos: [] as string[],
      read: async () => h.file,
      write: async (_c: string, t: string) => {
        h.file = t;
        h.writes++;
      },
      info: (t: string) => void h.infos.push(t),
      now: () => new Date(2026, 10, 17, 9, 5).getTime(),
    };
    return h satisfies RelicHost;
  }

  it('rilegge il file prima di scrivere (modifiche della pagina nel frattempo)', async () => {
    const h = host(null);
    const s = new RelicStore(h);
    await s.setFolder('/tmp/reliquiario/');
    expect(s.cartella).toBe('/tmp/reliquiario');
    await s.identify(read(ANELLO)[0].c, undefined, 'Rigel');
    // la pagina aggiunge un oggetto a mano
    const d = parseDb(h.file);
    d.oggetti.rose = { chiave: 'rose', tipo: 'LIGHT', flags: [], stats: {}, extra: [] };
    h.file = serializeDb(d);
    await s.identify(read(SPADA)[0].c, undefined, 'Rigel');
    expect(Object.keys(parseDb(h.file).oggetti).sort()).toEqual([
      'anello cristallo',
      'fire blade',
      'rose',
    ]);
    expect(parseDb(h.file).aggiornato).toBe('2026-11-17 09:05');
    expect(h.infos.at(-1)).toBe('nuovo: fire blade (3 oggetti nel Reliquiario)');
  });

  it('file che non si legge: non lo sovrascrive; spento: non scrive', async () => {
    const h = host('window.MUD_DB = {rotto');
    const s = new RelicStore(h);
    await s.setFolder('/tmp/r');
    await s.identify(read(ANELLO)[0].c, undefined, undefined);
    expect(h.writes).toBe(0);
    expect(h.file).toBe('window.MUD_DB = {rotto');
    expect(s.errore).toContain('non lo tocco');
    const off = host(null);
    const s2 = new RelicStore(off);
    await s2.identify(read(ANELLO)[0].c, undefined, undefined);
    await s2.equipment('Rigel', [{ slot: 'come luce', nome: 'x' }]);
    expect(off.writes).toBe(0);
  });
});

// Esempio dell'utente (2026-11-17): documento con i copia-incolla degli identify delle borse.
const GIUBBA = `Oggetto: 'giubba runa tessuto instabile', Tipo di Oggetto ARMOR
L'oggetto e': RESISTANT ONLY-PRINCE PROCAREA-REWARD
Peso: 5, Valore: 1.200, Costo di rent: 0 
AC-apply di 7.
Caratteristiche: 
Ti puo' dare : SAVING_ALL by -1
Ti puo' dare : HIT by 10
Ti puo' dare : HIT-REGEN by 14
Ti puo' dare : SPELLPOWER by 1
Ti puo' dare : MANA by 46`;

describe('Reliquiario: importazione e contenitori', () => {
  it('legge più identify da un documento (righe vuote, testo in mezzo, prompt)', () => {
    const testo = `${GIUBBA}\n\n${ANELLO.join('\n')}\nRigel H490 M500 V255 X-1 [T] */*\nnota a caso\n${SPADA.join('\n')}`;
    const caps = identifiesFromText(testo);
    expect(caps.map((c) => c.chiave)).toEqual([
      'giubba runa tessuto instabile',
      'anello cristallo',
      'fire blade',
    ]);
    expect(caps[0]).toMatchObject({
      tipo: 'ARMOR',
      flags: ['RESISTANT', 'ONLY-PRINCE', 'PROCAREA-REWARD'],
      peso: 5,
      valore: 1200,
      rent: 0,
      raro: false,
      ac: 7,
      stats: { SAVING_ALL: -1, HIT: 10, 'HIT-REGEN': 14, SPELLPOWER: 1, MANA: 46 },
    });
    expect(caps[0].extra).toEqual([]);
    expect(caps[1].extra).toEqual([]); // il prompt chiude l'identify: "nota a caso" non entra
  });

  it('importa nel contenitore scelto; contenitore per oggetto e nomi salvati', async () => {
    let file: string | null = null;
    const s = new RelicStore({
      read: async () => file,
      write: async (_c, t) => {
        file = t;
      },
      info: () => {},
      now: () => 0,
    });
    await s.setFolder('/tmp/r');
    await s.setContainers(['compendium', ' korred ', 'Korred', '']);
    expect(s.db.contenitori).toEqual(['compendium', 'korred']);
    expect(await s.importText(`${GIUBBA}\n${SPADA.join('\n')}`, 'korred')).toEqual({
      nuovi: 2,
      aggiornati: 0,
    });
    expect(parseDb(file).oggetti['giubba runa tessuto instabile'].contenitore).toBe('korred');
    await s.setContainer('fire blade', 'zaino');
    expect(containerNames(s.db)).toEqual(['compendium', 'korred', 'zaino']);
    expect(
      searchRelics(s.db, '', 1, (o) => o.contenitore === 'zaino').map((o) => o.chiave),
    ).toEqual(['fire blade']);
    await s.setContainer('fire blade', '');
    expect(s.db.oggetti['fire blade'].contenitore).toBeUndefined();
    // un identify in gioco dello stesso oggetto non perde il contenitore
    const r = await s.identify(identifiesFromText(GIUBBA)[0], undefined, undefined);
    expect(r).toEqual({
      chiave: 'giubba runa tessuto instabile',
      nome: 'giubba runa tessuto instabile',
      contenitore: 'korred',
    });
    expect(await s.importText('niente identify qui', 'korred')).toEqual({
      nuovi: 0,
      aggiornati: 0,
    });
  });
});
