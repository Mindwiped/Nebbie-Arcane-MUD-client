import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NebbieParser } from '../parser/nebbieParser';
import { Mapper } from './mapper';
import { parseMap, seenOf } from './model';

/** Mapper con la registrazione accesa (come dopo l'interruttore MAPPER). */
function recMapper(): Mapper {
  const m = new Mapper(() => 0);
  m.registra = true;
  return m;
}

/** Rigioca un log: righe al parser, comandi e prompt a parser e mapper. */
function replay(path: string, m = recMapper()): Mapper {
  const parser = new NebbieParser((ev, data) => {
    if (ev === 'room') m.room(data as never);
    if (ev === 'moveFailed') m.moveFailed(data as never);
    if (ev === 'door') m.door(data as never);
  });
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const x = /^\d+\t([LPCS])\t(.*)$/.exec(line);
    if (!x) continue;
    const text = x[2]
      .replace(/\\(t|\\)/g, (_, c) => (c === 't' ? '\t' : '\\'))
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '');
    if (x[1] === 'L') parser.line(text);
    else if (x[1] === 'C') {
      parser.command(text);
      m.command(text);
    } else if (x[1] === 'P') {
      parser.prompt();
      m.prompt();
    }
  }
  return m;
}

const rooms = (m: Mapper) => Object.values(m.data.stanze);
const at = (m: Mapper, titolo: string) => rooms(m).filter((r) => r.titolo === titolo);

describe('mapper sui log veri', () => {
  it('stanze_reali: look, passi e run collegati con le coordinate giuste', () => {
    const m = replay('fixtures/stanze_reali.log');
    // Le porte viste solo con look (senza "Uscite visibili") non danno una prova positiva:
    // arrivandoci da un'altra parte del log (estratti non consecutivi) nasce un'altra stanza.
    expect(rooms(m).length).toBe(8);
    const porte = at(m, "Le porte della citta'")[0];
    const fuori = at(m, 'Fuori dalle porte di Myst')[0];
    expect(porte.uscite.s).toBe(fuori.id);
    expect(fuori.uscite.n).toBe(porte.id);
    expect([fuori.x - porte.x, fuori.y - porte.y]).toEqual([0, -1]);
    expect(m.current).toBeDefined();
  });

  it('mezzi di trasporto: spostamenti senza passo = isola o posizione sconosciuta', () => {
    const m = replay('fixtures/trasporti_porte_reale.log');
    const pos = rooms(m).map((r) => `${r.zona}:${r.x},${r.y},${r.z}`);
    expect(new Set(pos).size).toBe(pos.length); // mai due stanze nello stesso punto
    expect(m.data.zone.some((z) => z.tipo === 'isola')).toBe(true);
  });

  it('tornando indietro si riusa la stanza (andata e ritorno)', () => {
    const m = replay('fixtures/stanze_reali.log');
    const n = rooms(m).length;
    // rigiocare lo stesso log sulla stessa mappa (nuova sessione: posizione sconosciuta)
    // non aggiunge stanze
    m.cur = null;
    replay('fixtures/stanze_reali.log', m);
    expect(rooms(m).length).toBe(n);
  });

  it('percorso più breve con le porte', () => {
    const m = replay('fixtures/stanze_reali.log');
    const porte = at(m, "Le porte della citta'")[0];
    const fuori = at(m, 'Fuori dalle porte di Myst')[0];
    expect(m.path(porte.id, fuori.id)).toEqual(['s']);
    expect(m.path(fuori.id, porte.id)).toEqual(['n']);
  });

  it('lettura tollerante del file', () => {
    const m = replay('fixtures/stanze_reali.log');
    const again = parseMap(JSON.stringify(m.data));
    expect(again.stanze).toEqual(m.data.stanze);
    expect(again.prossima).toBe(m.data.prossima);
  });
});

describe('stanze identiche marcate con le monete', () => {
  const maze = (monete = 0) => ({
    titolo: 'Nel labirinto',
    righeDescrizione: ['Corridoi tutti uguali si perdono nel buio.', 'Le pareti sono umide.'],
    uscite: ['n', 'e', 's', 'w'] as never,
    usciteRiga: 'Uscite: Nord Est Sud Ovest',
    visibili: [],
    contenuti:
      monete === 0
        ? []
        : monete === 1
          ? ['One miserable gold coin.']
          : [`[ 1] One miserable gold coin.[${monete}]`],
    guardata: false,
  });

  function setup() {
    const m = recMapper();
    const drops: number[] = [];
    const infos: string[] = [];
    m.onMark = (n) => (drops.push(n), true);
    m.onInfo = (i) => infos.push(i.text);
    const walk = (dir: string, monete: number) => {
      m.command(dir);
      m.room(maze(monete));
      m.prompt();
    };
    m.room(maze()); // prima stanza: la mappa nasce qui
    return { m, drops, infos, walk };
  }

  it('marca 1, 2, 3… e riconosce le uscite illogiche dalle monete', () => {
    const { m, drops, infos, walk } = setup();
    const first = m.cur!;
    walk('e', 0); // gemella nuova: marcata con 1
    const a = m.cur!;
    expect(a).not.toBe(first);
    expect(drops).toEqual([1]);
    walk('e', 1); // vai a est e ti ritrovi nella stessa: 1 moneta → è "a"
    expect(m.cur).toBe(a);
    expect(m.data.stanze[a].uscite.e).toBe(a);
    expect(infos.some((t) => t.includes('1 monete per terra'))).toBe(true);
    walk('n', 0); // nessuna moneta: stanza nuova, marcata con 2
    const b = m.cur!;
    expect(b).not.toBe(a);
    expect(m.data.stanze[b].marca).toBe(2);
    expect(drops).toEqual([1, 2]);
    walk('s', 1); // indietro: 1 moneta, è "a"
    expect(m.cur).toBe(a);
    walk('w', 0); // torna alla prima (uscita nota), che non era marcata: ora la marco
    expect(m.cur).toBe(first);
    expect(m.data.stanze[first].marca).toBe(3);
    expect(drops).toEqual([1, 2, 3]);
  });

  it('le stanze uniche non si marcano mai, nemmeno ripassandoci (log reale del 2026-11-14)', () => {
    const m = recMapper();
    const drops: number[] = [];
    m.onMark = (n) => (drops.push(n), true);
    const room = (titolo: string) => ({
      ...maze(),
      titolo,
      righeDescrizione: [`Descrizione di ${titolo}.`],
    });
    m.room(room('La piazza'));
    for (const [dir, t] of [
      ['e', 'La cappella'],
      ['w', 'La piazza'],
      ['e', 'La cappella'],
    ]) {
      m.command(dir);
      m.room(room(t));
      m.prompt();
    }
    expect(drops).toEqual([]);
    expect(Object.values(m.data.stanze).some((r) => r.marca)).toBe(false);
  });

  it('caricando la mappa toglie le marche sbagliate', () => {
    const { m, walk } = setup();
    walk('e', 0);
    const data = structuredClone(m.data);
    data.stanze[99] = { ...data.stanze[1], id: 99, titolo: 'Unica', firma: 'unica|0', marca: 1 };
    // marca senza monete posate (durante un percorso, versione di prima): va tolta
    const twin = Object.values(data.stanze).find((r) => r.marca === 1 && r.id !== 99)!;
    data.stanze[98] = { ...twin, id: 98, x: 9, marca: 2, posate: undefined };
    const m2 = recMapper();
    m2.load(data);
    expect(m2.data.stanze[99].marca).toBeUndefined();
    expect(Object.values(m2.data.stanze).filter((r) => r.marca === 1)).toHaveLength(1);
  });

  it('con altri passi già in coda non marca (le monete cadrebbero più avanti)', () => {
    const { m, drops } = setup();
    m.command('e');
    m.command('e'); // scritti di fila: "e;e"
    m.room(maze());
    m.prompt();
    expect(drops).toEqual([]);
    m.room(maze());
    m.prompt();
    expect(drops).toEqual([1]); // l'ultimo passo, senza altri in coda: marca
  });

  it('se le monete non si possono posare (percorso) la stanza non viene marcata', () => {
    const m = recMapper();
    m.onMark = () => false;
    m.room(maze());
    m.command('e');
    m.room(maze());
    m.prompt();
    expect(Object.values(m.data.stanze).some((r) => r.marca)).toBe(false);
  });

  it('un mucchio di monete (non contabile) non viene usato; interruttore', () => {
    const { m, drops, walk } = setup();
    m.command('e');
    m.room({ ...maze(), contenuti: ['A pile of gold coins.'] });
    m.prompt();
    expect(drops).toEqual([]);
    m.data.noMonete = true;
    walk('n', 0);
    expect(drops).toEqual([]);
  });
});

describe('porte e nomi ripetuti (log reale del 2026-11-14)', () => {
  const ev = (titolo: string, riga: string, vis: [string, string][]) => ({
    titolo,
    righeDescrizione: [riga, 'Seconda riga.'],
    uscite: vis.map((v) => v[0]) as never,
    usciteRiga: '',
    visibili: vis.map(([dir, nome]) => ({ dir, nome })) as never,
    contenuti: [],
    guardata: false,
  });

  it('una porta chiusa (uscita in meno) non crea una stanza nuova', () => {
    const m = recMapper();
    const sentiero = ev('Il sentiero', 'Un sentiero.', [['e', 'una muraglia di rovi']]);
    m.room(sentiero);
    m.command('e'); // cancello aperto: N S E
    m.room(
      ev('una muraglia di rovi', 'Una siepe.', [
        ['n', 'una muraglia di rovi'],
        ['s', 'una muraglia di rovi'],
        ['e', 'la siepe'],
        ['w', 'Il sentiero'],
      ]),
    );
    m.prompt();
    const muraglia = m.cur;
    m.command('w');
    m.room(sentiero);
    m.prompt();
    m.command('e'); // cancello chiuso: l'uscita E sparisce
    m.room(
      ev('una muraglia di rovi', 'Una siepe.', [
        ['n', 'una muraglia di rovi'],
        ['s', 'una muraglia di rovi'],
        ['w', 'Il sentiero'],
      ]),
    );
    m.prompt();
    expect(m.cur).toBe(muraglia);
    expect(rooms(m)).toHaveLength(2);
  });

  it('se tutti i vicini hanno lo stesso nome non è una prova: niente salti altrove', () => {
    const campo = (vis: [string, string][]) => ev('il campo di battaglia', 'Erba e ossa.', vis);
    const tutti: [string, string][] = ['n', 'e', 's', 'w'].map((d) => [d, 'il campo di battaglia']);
    const m = recMapper();
    m.room(campo(tutti));
    const da = m.data.stanze[m.cur!];
    // una stanza identica lontana, senza uscita ovest nota: prima veniva riusata "per prova"
    const lontana = { ...da, id: 50, x: 20, y: 20, uscite: {} };
    m.data.stanze[50] = lontana;
    m.data.prossima = 51;
    expect(seenOf(campo(tutti)).firma).toBe(lontana.firma);
    m.command('e');
    m.room(campo(tutti));
    m.prompt();
    expect(m.cur).not.toBe(50);
    expect(m.data.stanze[m.cur!]).toMatchObject({ x: da.x + 1, y: da.y });
  });

  it('uscita illogica verso una stanza unica: si torna nella stessa, niente doppione', () => {
    const m = recMapper();
    const radura = ev('una piccola radura', 'Il bosco si apre.', [
      ['n', 'una muraglia di rovi'],
      ['w', 'una fitta boscaglia'],
    ]);
    m.room(radura);
    const r = m.cur;
    m.command('n');
    m.room(
      ev('una muraglia di rovi', 'Una siepe.', [
        ['e', 'una muraglia di rovi'],
        ['w', 'una piccola radura'],
      ]),
    );
    m.prompt();
    m.command('w'); // a ovest della muraglia c'è di nuovo la radura (non a sud-ovest)
    m.room(radura);
    m.prompt();
    expect(m.cur).toBe(r);
    expect(rooms(m)).toHaveLength(2);
  });
});

describe('registrazione a mano e isole (richiesta del 2026-11-15)', () => {
  const ev = (titolo: string, vis: [string, string][] = []) => ({
    titolo,
    righeDescrizione: [`Descrizione di ${titolo}.`],
    uscite: vis.map((v) => v[0]) as never,
    usciteRiga: '',
    visibili: vis.map(([dir, nome]) => ({ dir, nome })) as never,
    contenuti: [],
    guardata: false,
  });
  const walk = (m: Mapper, dir: string, e: ReturnType<typeof ev>) => {
    m.command(dir);
    m.room(e);
    m.prompt();
  };

  it('spento segue solo la posizione: non crea e non collega', () => {
    const m = recMapper();
    m.room(ev('La piazza', [['e', 'La strada']]));
    walk(m, 'e', ev('La strada', [['w', 'La piazza']]));
    m.stopRecording();
    const prima = JSON.stringify(m.data);
    walk(m, 'w', ev('La piazza', [['e', 'La strada']]));
    expect(m.current?.titolo).toBe('La piazza');
    walk(m, 'n', ev('Il bosco', [['s', 'La piazza']]));
    expect(m.cur).toBeNull(); // stanza sconosciuta: posizione persa, niente stanza nuova
    expect(JSON.stringify(m.data)).toBe(prima);
  });

  it('accendendo si sceglie la zona: esistente o nuova col nome dato', () => {
    const m = new Mapper(() => 0);
    const z = m.startRecording({ nuova: 'Myst' });
    m.room(ev('La piazza', [['e', 'La strada']]));
    expect(m.current?.zona).toBe(z);
    m.stopRecording();
    const z2 = m.startRecording({ nuova: 'Bosco' });
    walk(m, 'e', ev('La strada', [['w', 'La piazza']]));
    // dalla piazza (zona Myst) la stanza nuova va nella zona Bosco, al centro
    expect(m.current).toMatchObject({ zona: z2, x: 0, y: 0 });
    expect(m.startRecording({ zona: z })).toBe(z);
    expect(m.data.zone.map((x) => x.nome)).toEqual(['Myst', 'Bosco']);
  });

  it("stanza nuova in un'altra zona non vuota: ai margini, mai con le coordinate di partenza", () => {
    const m = new Mapper(() => 0);
    const msgs: string[] = [];
    m.onInfo = (i) => void msgs.push(i.text);
    const myst = m.startRecording({ nuova: 'Myst' });
    m.room(ev('La piazza', [['e', 'La strada']]));
    walk(
      m,
      'e',
      ev('La strada', [
        ['w', 'La piazza'],
        ['n', 'Il palazzo'],
      ]),
    );
    walk(m, 'e', ev('Il molo', [['w', 'La strada']]));
    m.stopRecording();
    const grecia = m.startRecording({ nuova: 'Grecia' });
    m.setCurrent(m.data.prossima - 3); // la piazza
    walk(m, 'n', ev('Il tempio', [['s', 'La piazza']]));
    const tempio = m.current!;
    expect(tempio).toMatchObject({ zona: grecia, x: 0, y: 0 }); // zona vuota: al centro
    m.setCurrent(m.data.prossima - 3); // la strada, ancora in Myst
    walk(m, 'n', ev('Il palazzo', [['s', 'La strada']]));
    // in Grecia c'è il tempio in (0,0): il palazzo va a destra, non in (1,1) come in Myst
    expect(m.current).toMatchObject({ zona: grecia, x: 2, y: 0 });
    expect(msgs.some((t) => t.includes('ai margini della zona "Grecia"'))).toBe(true);
    expect(m.data.stanze[tempio.id].zona).toBe(grecia);
    expect(myst).not.toBe(grecia);
  });

  it("sposta isola: tutte le stanze nella zona scelta, allineate all'uscita che le collega", () => {
    const m = recMapper();
    m.room(ev('La piazza', [['e', 'La strada']]));
    const main = m.current!.zona;
    m.command('recall'); // isola
    m.room(ev('Il tempio', [['e', 'Il chiostro']]));
    m.prompt();
    const isola = m.current!.zona;
    expect(isola).not.toBe(main);
    walk(m, 'e', ev('Il chiostro', [['w', 'Il tempio']]));
    // il chiostro sta a ovest della piazza: lo collego a mano come farebbe il mapper
    m.current!.uscite.e = Object.values(m.data.stanze).find((r) => r.titolo === 'La piazza')!.id;
    expect(m.moveArea(isola, main)).toBe(2);
    const by = (t: string) => Object.values(m.data.stanze).find((r) => r.titolo === t)!;
    expect(m.data.zone.some((z) => z.id === isola)).toBe(false);
    expect(by('Il tempio').zona).toBe(main);
    expect([by('Il chiostro').x, by('Il chiostro').y]).toEqual([
      by('La piazza').x - 1,
      by('La piazza').y,
    ]);
    expect([by('Il tempio').x]).toEqual([by('La piazza').x - 2]);
  });

  it('sposta isola senza collegamenti: accanto alle stanze della zona, mai sovrapposte', () => {
    const m = recMapper();
    m.room(ev('La piazza', [['e', 'La strada']]));
    walk(m, 'e', ev('La strada', [['w', 'La piazza']]));
    const main = m.current!.zona;
    m.command('recall');
    m.room(ev('Il tempio'));
    m.prompt();
    const isola = m.current!.zona;
    m.moveArea(isola, main);
    const pos = Object.values(m.data.stanze).map((r) => `${r.zona}:${r.x},${r.y},${r.z}`);
    expect(new Set(pos).size).toBe(pos.length);
  });
});

describe('strumenti della mappa', () => {
  const ev = (titolo: string, vis: [string, string][] = []) => ({
    titolo,
    righeDescrizione: [`Descrizione di ${titolo}.`],
    uscite: vis.map((v) => v[0]) as never,
    usciteRiga: '',
    visibili: vis.map(([dir, nome]) => ({ dir, nome })) as never,
    contenuti: [],
    guardata: false,
  });
  function three() {
    const m = recMapper();
    m.room(ev('La piazza', [['e', 'La strada']]));
    m.command('e');
    m.room(
      ev('La strada', [
        ['w', 'La piazza'],
        ['e', 'Il ponte'],
      ]),
    );
    m.prompt();
    m.command('e');
    m.room(ev('Il ponte', [['w', 'La strada']]));
    m.prompt();
    const by = (t: string) => Object.values(m.data.stanze).find((r) => r.titolo === t)!;
    return { m, by };
  }

  it('unisci: le uscite verso la stanza tolta puntano a quella tenuta', () => {
    const { m, by } = three();
    const ponte = by('Il ponte').id;
    // un doppione della piazza, collegato al ponte da nord
    m.data.stanze[90] = {
      ...by('La piazza'),
      id: 90,
      x: 5,
      uscite: { s: ponte },
      note: 'doppione',
      mob: ['un ratto'],
    };
    by('Il ponte').uscite.n = 90;
    expect(m.mergeRooms(by('La piazza').id, 90)).toBe(true);
    expect(m.data.stanze[90]).toBeUndefined();
    expect(by('Il ponte').uscite.n).toBe(by('La piazza').id);
    expect(by('La piazza').uscite.s).toBe(ponte);
    expect(by('La piazza')).toMatchObject({ note: 'doppione', mob: ['un ratto'] });
    expect(m.mergeRooms(1, 1)).toBe(false);
  });

  it('elimina: la stanza e le uscite che portavano lì; posizione persa se eri lì', () => {
    const { m, by } = three();
    const ponte = by('Il ponte').id;
    expect(m.cur).toBe(ponte);
    expect(m.deleteRoom(ponte)).toBe(true);
    expect(by('La strada').uscite.e).toBeUndefined();
    expect(m.cur).toBeNull();
  });

  it('note, mob uccisi (solo registrando) e ricerca', () => {
    const { m, by } = three();
    m.setNotes(by('La strada').id, ' fontana magica ', ['orco', ' orco', '']);
    expect(by('La strada')).toMatchObject({ note: 'fontana magica', mob: ['orco'] });
    m.mobSeen('il goblin'); // nel ponte, registrando
    m.stopRecording();
    m.mobSeen('il troll'); // spento: niente
    expect(by('Il ponte').mob).toEqual(['il goblin']);
    expect(m.search('fontana').map((r) => r.titolo)).toEqual(['La strada']);
    expect(m.search('goblin').map((r) => r.titolo)).toEqual(['Il ponte']);
    expect(m.search('piazza')[0].titolo).toBe('La piazza');
    expect(m.search(`#${by('Il ponte').id}`)[0].titolo).toBe('Il ponte');
    expect(m.search('niente di simile')).toEqual([]);
  });
});

describe('correzioni del 2026-11-15: monete sparite e isole', () => {
  const ev = (titolo: string, vis: [string, string][] = [], monete = 0) => ({
    titolo,
    righeDescrizione: [`Descrizione di ${titolo}.`],
    uscite: vis.map((v) => v[0]) as never,
    usciteRiga: '',
    visibili: vis.map(([dir, nome]) => ({ dir, nome })) as never,
    contenuti: monete ? [`[ 1] One miserable gold coin.[${monete}]`] : [],
    guardata: false,
  });
  const strada: [string, string][] = [
    ['e', 'la strada'],
    ['w', 'la strada'],
  ];

  it('monete sparite: la stanza marcata nel punto atteso si riusa e le monete si rimettono', () => {
    const m = recMapper();
    const drops: number[] = [];
    m.onMark = (n) => (drops.push(n), true);
    m.room(ev('La strada', strada));
    const a = m.current!;
    // gemella già marcata con 2 subito a est, senza uscite note (come la 123 vista dalla 122)
    m.data.stanze[50] = { ...a, id: 50, x: a.x + 1, uscite: {}, marca: 2, posate: true };
    m.data.prossima = 51;
    m.command('e');
    m.room(ev('La strada', strada)); // nessuna moneta: qualcuno le ha raccolte
    m.prompt();
    expect(m.cur).toBe(50);
    expect(drops).toEqual([2]); // rimesse le stesse 2 monete
    expect(Object.keys(m.data.stanze)).toHaveLength(2);
  });

  it("un'isola collegata camminando a una stanza nota si unisce alla sua zona", () => {
    const m = recMapper();
    m.room(ev('La piazza', [['e', 'Il ponte']]));
    const main = m.current!.zona;
    m.command('recall');
    m.room(ev('Il tempio', [['w', 'Il ponte']]));
    m.prompt();
    const isola = m.current!.zona;
    m.command('w');
    m.room(
      ev('Il ponte', [
        ['e', 'Il tempio'],
        ['w', 'La piazza'],
      ]),
    );
    m.prompt();
    expect(m.current!.zona).toBe(isola); // stanza nuova partendo dall'isola: resta nell'isola
    m.command('w');
    m.room(ev('La piazza', [['e', 'Il ponte']]));
    m.prompt();
    const by = (t: string) => Object.values(m.data.stanze).find((r) => r.titolo === t)!;
    expect(m.data.zone.some((z) => z.id === isola)).toBe(false);
    expect(by('Il tempio').zona).toBe(main);
    expect([by('Il ponte').x, by('Il ponte').y]).toEqual([
      by('La piazza').x + 1,
      by('La piazza').y,
    ]);
    expect(by('Il tempio').x).toBe(by('La piazza').x + 2);
  });
});

describe('sposta stanze in un altra zona (2026-11-16)', () => {
  /** Come la mappa reale: nella Foresta 2 stanze sue e un gruppo di 3 finito lì per sbaglio. */
  function mappa(): Mapper {
    const r = (id: number, zona: number, x: number, uscite: Record<string, number> = {}) => ({
      id,
      zona,
      x,
      y: 0,
      z: 0,
      titolo: `Stanza ${id}`,
      desc: '',
      firma: `f${id}`,
      uscite,
      viste: [],
      vicini: {},
    });
    const m = recMapper();
    m.load(
      parseMap(
        JSON.stringify({
          zone: [
            { id: 1, nome: 'Nebbie', tipo: 'mondo' },
            { id: 2, nome: 'Foresta', tipo: 'mondo' },
          ],
          stanze: {
            1: r(1, 1, 0),
            10: r(10, 2, 0, { e: 11 }),
            11: r(11, 2, 1, { w: 10 }),
            20: r(20, 2, 5, { e: 21, n: 1 }),
            21: r(21, 2, 6, { w: 20, e: 22 }),
            22: r(22, 2, 7, { w: 21 }),
          },
          prossima: 23,
        }),
      ),
    );
    return m;
  }

  it('il gruppo collegato resta nella sua zona (non segue le uscite verso altre zone)', () => {
    const m = mappa();
    expect(m.groupOf(21)).toEqual([20, 21, 22]);
    expect(m.groupOf(10)).toEqual([10, 11]);
  });

  it('gruppo in una zona nuova: stanze spostate, forma conservata, la Foresta tiene le sue', () => {
    const m = mappa();
    m.setCurrent(22);
    m.startRecording({ zona: 2 });
    const z = m.addZone('Regno di Agamennone');
    expect(m.moveRooms(m.groupOf(20), z)).toBe(3);
    const s = m.data.stanze;
    expect([s[20].zona, s[21].zona, s[22].zona]).toEqual([z, z, z]);
    expect([s[21].x - s[20].x, s[22].x - s[21].x]).toEqual([1, 1]);
    expect([s[10].zona, s[11].zona]).toEqual([2, 2]);
    // registravi e ti sei spostato con loro: le stanze nuove vanno nella zona nuova
    expect(m.zonaRegistra).toBe(z);
  });

  it('una stanza sola in una zona esistente, allineata alla sua uscita', () => {
    const m = mappa();
    expect(m.moveRooms([20], 1)).toBe(1);
    const s = m.data.stanze;
    expect(s[20]).toMatchObject({ zona: 1, x: s[1].x, y: s[1].y - 1 }); // a sud della 1
    expect(s[21].zona).toBe(2);
  });
});
