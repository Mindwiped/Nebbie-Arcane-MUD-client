import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plainSpans } from '../../core/spans';
import { compilePromptRegex, DEFAULT_PROMPT_REGEX, splitPrompts } from '../prompt/promptParser';
import { NebbieParser, normName, parseItem } from './nebbieParser';
import type { NebbieEvents } from './types';

type Ev = { [K in keyof NebbieEvents]: { type: K; data: NebbieEvents[K] } }[keyof NebbieEvents];

const promptRe = compilePromptRegex(DEFAULT_PROMPT_REGEX);

/** Fa passare un log di sessione nel parser come farebbe la sessione (prompt separati). */
function feedLog(path: string, clock = () => 0): Ev[] {
  const events: Ev[] = [];
  const parser = new NebbieParser(
    (type, data) => events.push({ type, data } as Ev),
    undefined,
    clock,
  );
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\d+\t([LPCS])\t(.*)$/.exec(line);
    if (!m) continue;
    const [, kind, raw] = m;
    // Il log scrive tab e barre come \t e \\; poi si tolgono i codici colore.
    const unescaped = raw.replace(/\\(t|\\)/g, (_, c) => (c === 't' ? '\t' : '\\'));
    // eslint-disable-next-line no-control-regex
    const text = unescaped.replace(/\x1b\[[0-9;]*m/g, '');
    if (kind === 'C') parser.command(text);
    if (kind !== 'L' && kind !== 'P') continue;
    for (const part of splitPrompts(plainSpans(text), promptRe)) {
      if (part.kind === 'prompt') parser.prompt();
      else if (kind === 'L') parser.line(part.text);
    }
  }
  return events;
}

const ofType = <K extends keyof NebbieEvents>(events: Ev[], type: K) =>
  events.filter((e) => e.type === type).map((e) => e.data as NebbieEvents[K]);

function feedLines(lines: string[]): Ev[] {
  const events: Ev[] = [];
  const parser = new NebbieParser((type, data) => events.push({ type, data } as Ev));
  for (const l of lines) {
    if (l === '>>') parser.prompt();
    else parser.line(l);
  }
  return events;
}

describe('stanze (fixture reale stanze_reali.log)', () => {
  const rooms = ofType(feedLog('fixtures/stanze_reali.log'), 'room');

  it('riconosce tutte le stanze con il titolo giusto', () => {
    expect(rooms.map((r) => r.titolo)).toEqual([
      "Le porte della citta'",
      'Fuori dalle porte di Myst',
      'Il Crocevia',
      // run: tre stanze di fila senza prompt in mezzo
      'La piazza delle statue',
      'La piazza del grande arco',
      'La piazza delle Nebbie',
      'Viale del Grifone',
      "Le porte della citta'",
    ]);
  });

  it('look senza "Uscite visibili": chiusa dal prompt, contenuti presi', () => {
    const [look] = rooms;
    expect(look.uscite).toEqual(['n', 'e', 's']);
    expect(look.visibili).toEqual([]);
    expect(look.contenuti).toEqual(['A pile of gold coins.', 'Una guardia scelta']);
    expect(look.righeDescrizione[0]).toMatch(/^Alti {2}bastioni/);
  });

  it('uscite visibili con i nomi delle stanze vicine', () => {
    const crocevia = rooms[2];
    expect(crocevia.uscite).toEqual(['n', 'e', 's', 'w', 'u']);
    expect(crocevia.visibili.map((v) => v.dir)).toEqual(['n', 'e', 's', 'w', 'u']);
    expect(crocevia.visibili[4]).toEqual({
      dir: 'u',
      nome: "La diligenza: l'area di carico di Myst",
    });
    expect(crocevia.contenuti).toEqual([
      "*Dwimmerlaik, il Signore di Morgul, uno dei terribili spettri dell'anello.",
    ]);
  });

  it('il separatore non finisce tra i contenuti e il mob con il numero sì', () => {
    const porte = rooms[7];
    expect(porte.contenuti).toEqual([
      "La ronda passa gridando 'Sono le 7 sette e tutto va bene!'",
      'Una guardia scelta [6]',
    ]);
  });

  it('fine del run', () => {
    const events = feedLog('fixtures/stanze_reali.log');
    expect(ofType(events, 'moveFailed')).toEqual([
      { motivo: 'fineRun', testo: 'Mi spiace, ma non riesci a correre ulteriormente.' },
    ]);
  });
});

describe('stanze: casi particolari', () => {
  it('"Uscite:" attaccata all\'ultima riga della descrizione', () => {
    const [room] = ofType(
      feedLines([
        'Una palude',
        "Acqua stagnante ovunque, e' facile smarrire l'orientamento Uscite: Nord Sud",
        '>>',
      ]),
      'room',
    );
    expect(room.titolo).toBe('Una palude');
    expect(room.uscite).toEqual(['n', 's']);
    expect(room.righeDescrizione).toEqual([
      "Acqua stagnante ovunque, e' facile smarrire l'orientamento",
    ]);
  });

  it('il titolo si riconosce dai nomi delle stanze vicine', () => {
    const rooms = ofType(
      feedLines([
        'Stanza A',
        'Uscite: Nord',
        '-----------------',
        'Uscite visibili:',
        'Nord  - Stanza Corta.',
        '-----------------',
        '>>',
        'Messaggio che non e una frase',
        'Stanza Corta.',
        'Uscite: Sud',
        '>>',
      ]),
      'room',
    );
    expect(rooms[1].titolo).toBe('Stanza Corta.');
  });

  it('look in una direzione: stanza segnata come guardata', () => {
    const events: Ev[] = [];
    let now = 1000;
    const parser = new NebbieParser(
      (type, data) => events.push({ type, data } as Ev),
      undefined,
      () => now,
    );
    parser.command('look nord');
    parser.line('Un corridoio');
    parser.line('Uscite: Sud');
    parser.prompt();
    now += 5000;
    parser.command('n');
    parser.line('Un corridoio');
    parser.line('Uscite: Sud');
    parser.prompt();
    expect(ofType(events, 'room').map((r) => r.guardata)).toEqual([true, false]);
  });
});

describe('combattimento (fixture reale combattimento_reale.log)', () => {
  const events = feedLog('fixtures/combattimento_reale.log');

  it('mob uccisi, con le ripetizioni (x6)', () => {
    expect(ofType(events, 'mobKilled')).toEqual([
      { nome: 'la Ronda', volte: 1 },
      { nome: 'una guardia scelta', volte: 6 },
      { nome: "Guerra il Cavaliere dell'Apocalisse", volte: 1 },
    ]);
  });

  it('esperienza singola e di zona', () => {
    expect(ofType(events, 'xpGained')).toEqual([{ punti: 10200, nemici: 7 }, { punti: 225000 }]);
  });

  it('monete raccolte, incantesimi lanciati e finiti, achievement', () => {
    expect(ofType(events, 'goldLooted')).toEqual([{ monete: 100000 }]);
    expect(ofType(events, 'spellCast').map((s) => s.nome)).toEqual([
      'chain lightning',
      'magic missile',
    ]);
    // Un'immagine distrutta in combattimento: non è la fine dell'incantesimo.
    expect(ofType(events, 'affectEnd')).toEqual([
      { nome: 'mirror images', avviso: false, parziale: true },
    ]);
    expect(ofType(events, 'achievement')[0]).toEqual({
      tipo: 'Race',
      numero: 50,
      nome: 'Ma due hobbit valgono uno o due?',
      valore: 1969,
      totale: 2500,
    });
  });
});

describe('liste (fixture reale eq_inv_reale.log)', () => {
  const events = feedLog('fixtures/eq_inv_reale.log');

  it('equipaggiamento completo e vuoto', () => {
    const [full, empty] = ofType(events, 'equipmentList');
    expect(full.righe).toHaveLength(22);
    expect(full.righe[1]).toEqual({
      pos: 2,
      slot: 'sul dito destro',
      nome: 'Un Anello dei nani',
      condizione: 'in condizioni eccellenti',
      note: ['ha un alone luminoso'],
      quantita: 1,
    });
    expect(full.righe[21]).toMatchObject({ slot: 'simbolo del clan', note: [] });
    expect(empty.righe).toEqual([]);
  });

  it('inventario con quantità in coda', () => {
    const [inv] = ofType(events, 'inventoryList');
    expect(inv.righe).toEqual([
      { pos: 1, nome: 'Ali di Farfalla', note: ['ha un alone luminoso'], quantita: 11 },
      {
        pos: 12,
        nome: 'Compendium Maleficarum',
        note: ['invisibile', 'ha un alone luminoso'],
        quantita: 1,
      },
    ]);
  });

  it("fine dell'armatura magica subito dopo la lista", () => {
    expect(ofType(events, 'affectEnd')).toEqual([{ nome: 'armor', avviso: false }]);
  });
});

describe('altri formati documentati', () => {
  it('passo impossibile e porta chiusa (forma documentata)', () => {
    const events = feedLines(['Non puoi andare da quella parte...', "La door e' chiusa."]);
    expect(ofType(events, 'moveFailed').map((m) => m.motivo)).toEqual(['muro', 'porta']);
  });

  it('fermata della diligenza', () => {
    const events = feedLines([
      'Ci siamo fermati presso Mordilnia.',
      'Per scendere qui, andare verso il basso.',
      'Prossima fermata: Myst.',
    ]);
    expect(ofType(events, 'transportStop')).toEqual([
      { mezzo: 'diligenza', fermata: 'Mordilnia', prossima: 'Myst' },
    ]);
  });

  it('avviso prima della fine di un incantesimo', () => {
    expect(ofType(feedLines(['La tua armatura magica vacilla.']), 'affectEnd')).toEqual([
      { nome: 'armor', avviso: true },
    ]);
  });

  it('riga di oggetto e nomi normalizzati', () => {
    expect(parseItem(3, 'Spada (in pessime condizioni) [2]')).toEqual({
      pos: 3,
      nome: 'Spada',
      condizione: 'in pessime condizioni',
      note: [],
      quantita: 2,
    });
    expect(normName('Le Porte  della citta. ')).toBe('le porte della citta');
  });
});

describe('score e att (fixture reale score_att_reale.log)', () => {
  const events = feedLog('fixtures/score_att_reale.log');

  it('score: massimi, esperienza, monete, livelli, posizione', () => {
    expect(ofType(events, 'score')).toEqual([
      {
        hp: 539,
        hpMax: 539,
        mp: 930,
        mpMax: 950,
        mv: 135,
        mvMax: 259,
        exp: 534366565,
        monete: 29640568,
        prossimoLivello: { M: -103366565, K: -103366565 },
        livelli: { M: 51, K: 51 },
        posizione: 'in piedi',
      },
    ]);
  });

  it('att: incantesimi attivi con la durata residua', () => {
    expect(ofType(events, 'affectsList')).toEqual([
      {
        incantesimi: [
          { nome: 'detect invisibility', durata: 99 },
          { nome: 'strength', durata: 80 },
          { nome: 'shield', durata: 37 },
          { nome: 'armor', durata: 4 },
        ],
      },
    ]);
  });

  it('le righe di att sul trasporto non sono scambiate per un inventario', () => {
    expect(ofType(events, 'inventoryList')).toEqual([]);
  });
});

describe('score e att incollati senza a capo', () => {
  // Come arrivano copiando dal terminale: tutto su una riga.
  const score =
    "Sei nato nel Giorno dei Martelli, 24^ del Mese dell'Inverno, nell'anno 853 dopo Nebbie.Hai 50 anni." +
    "Hai 539(539) hit, 930(950) mana e 135(259) movimento.Il tuo allineamento e': Simpatico" +
    "Hai effettuato 534.366.565 exp, ed hai 29.640.568 monete d'oro." +
    'Exp al prossimo livello: M:-103.366.565 K:-103.366.565 I tuoi livelli: M:51 K:51' +
    'Questo ti qualifica come Rigel The NecroMonger.Sei in piedi.';
  const att =
    "Il tuo equipaggiamento e' meglio di quanto credevo possibile!Spells attivi:--------------" +
    "Spell : 'detect invisibility' - 99Spell : 'strength' - 80Spell : 'shield' - 37Spell : 'armor' - 4";

  it('score', () => {
    const [s] = ofType(feedLines([score, '>>']), 'score');
    expect(s).toMatchObject({ hpMax: 539, mpMax: 950, mvMax: 259, monete: 29640568 });
    expect(s.livelli).toEqual({ M: 51, K: 51 });
    expect(s.posizione).toBe('in piedi');
  });

  it('att', () => {
    const [a] = ofType(feedLines([att, '>>']), 'affectsList');
    expect(a.incantesimi.map((i) => i.durata)).toEqual([99, 80, 37, 4]);
  });
});

describe('mezzi di trasporto e porte (fixture reale trasporti_porte_reale.log)', () => {
  const events = feedLog('fixtures/trasporti_porte_reale.log');
  const rooms = ofType(events, 'room');

  it('mongolfiera: torre, cestello senza riga Uscite, primo scalo', () => {
    expect(rooms.slice(0, 3).map((r) => r.titolo)).toEqual([
      'La cima della torre sbilenca',
      'dentro il cestello della Mongolfiera',
      "La mongolfiera: Citta' di Imrryr e foresta incantata",
    ]);
    expect(rooms[1].uscite).toEqual([]);
    expect(rooms[1].visibili).toEqual([]);
    expect(rooms[2].fermata).toEqual({
      mezzo: 'mongolfiera',
      fermata: "Citta' di Imrryr e foresta incantata",
    });
  });

  it('diligenza: fermate con titolo e prossima fermata', () => {
    const stops = rooms.filter((r) => r.fermata?.mezzo === 'diligenza');
    expect(stops.map((r) => r.titolo)).toEqual([
      "La diligenza: l'area di carico di Myst",
      'La diligenza: la Contea',
      'La diligenza: La Contea',
      'La diligenza: Mordilnia',
      'La diligenza: Mordilnia',
    ]);
    expect(ofType(events, 'transportStop').filter((s) => s.mezzo === 'diligenza')).toEqual([
      { mezzo: 'diligenza', fermata: "l'area di carico di Myst", prossima: 'La Contea' },
      { mezzo: 'diligenza', fermata: 'la Contea', prossima: 'Mordilnia' },
      { mezzo: 'diligenza', fermata: 'la Contea', prossima: 'Mordilnia' },
      { mezzo: 'diligenza', fermata: 'Mordilnia', prossima: 'New Thalos' },
      { mezzo: 'diligenza', fermata: 'Mordilnia', prossima: 'New Thalos' },
    ]);
  });

  it('porta chiusa (testo reale) e porte aperte o chiuse da te o da altri', () => {
    expect(ofType(events, 'moveFailed').filter((m) => m.motivo === 'porta')).toHaveLength(2);
    expect(ofType(events, 'door')).toEqual([
      { azione: 'chiusa' },
      { azione: 'chiusa' },
      { azione: 'aperta', chi: 'Il Califfo di New Thalos' },
      { azione: 'chiusa' },
      { azione: 'aperta', chi: 'The bodyguard' },
      { azione: 'chiusa' },
      { azione: 'aperta' },
    ]);
  });
});

describe('casi visti in gioco il 2026-11-13', () => {
  it('dopo il login le NEWS non diventano il titolo della prima stanza', () => {
    const events: Ev[] = [];
    const parser = new NebbieParser((type, data) => events.push({ type, data } as Ev));
    for (const l of [
      ' Controllate sempre le NEWS',
      "Server    3.7.2    Stabilita' del server e correzioni su interrupt, mana, rinomina",
      'Benvenuto su Nebbie Arcane',
    ])
      parser.line(l);
    parser.command('1');
    for (const l of [
      "Il conto della pensione e' di 14 monete.",
      'La zona notte',
      "Da  dietro  un  bancone  emerge  l'esile figura della locandiera, una donna",
      'Uscite: Basso',
    ])
      parser.line(l);
    parser.prompt();
    expect(ofType(events, 'room')[0].titolo).toBe('La zona notte');
  });

  it('porte con altri nomi e run in una direzione impossibile', () => {
    const events = feedLines([
      'Apri una frasca.',
      'Il mercante chiude la grata.',
      'Non ti pare il caso di correre in quella direzione.',
    ]);
    expect(ofType(events, 'door')).toEqual([
      { azione: 'aperta' },
      { azione: 'chiusa', chi: 'Il mercante' },
    ]);
    expect(ofType(events, 'moveFailed')).toEqual([
      { motivo: 'muro', testo: 'Non ti pare il caso di correre in quella direzione.' },
    ]);
  });
});
