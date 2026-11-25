import { describe, expect, it, vi } from 'vitest';
import { newAccount, newProfile } from '../nebbie/profiles/profiles';
import { emptyAutomation, newAlias, newTrigger } from './automation/model';
import type { Backend } from './backend';
import { emptyPathsFile, type PathEntry, type PathsFile } from '../nebbie/paths/paths';
import {
  defaultAutoConfig,
  migrateAutoConfig,
  parseAutoConfig,
  type AutoConfig,
} from '../nebbie/keep/autoConfig';
import { presetRules } from './rules/rules';
import { initialState, Session } from './session';
import { spansText } from './spans';
import type { ServerEvent, WireLine } from './types';

function setup() {
  let onEvent: (ev: ServerEvent) => void = () => {};
  const sent: string[] = [];
  const backend: Backend = {
    connect: vi.fn(async (_p, cb) => {
      onEvent = cb;
    }),
    send: vi.fn(async (t: string) => {
      sent.push(t);
    }),
    sendPassword: vi.fn(async () => {
      sent.push('<password dal portachiavi>');
    }),
    disconnect: vi.fn(async () => {}),
    startReplay: vi.fn(async () => {}),
    stopReplay: vi.fn(async () => {}),
  };
  const session = new Session(backend, initialState());
  session.setProfile({ ...newProfile('Rigel'), max: { hp: 500 } });
  const emit = (ev: ServerEvent) => onEvent(ev);
  const line = (text: string, partial = false): WireLine => ({ spans: [{ text }], partial });
  const shown = () =>
    session.output.lines.map(
      (l) => `${l.kind}:${spansText(l.spans)}${l.echo !== undefined ? `|${l.echo}` : ''}`,
    );
  return { session, backend, emit, line, sent, shown };
}

async function connected() {
  const t = setup();
  await t.session.connect();
  t.emit({ type: 'status', state: 'connected', message: 'Collegato.' });
  return t;
}

describe('Session', () => {
  it('senza profilo non si collega', async () => {
    const backend = { connect: vi.fn() } as unknown as Backend;
    const s = new Session(backend, initialState());
    await s.connect();
    expect(backend.connect).not.toHaveBeenCalled();
    expect(s.output.last?.kind).toBe('system');
  });

  it('passa i parametri del profilo al backend', async () => {
    const { session, backend } = setup();
    await session.connect();
    expect(backend.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'nebbie.nebbie.it', port: 4000, profile: 'Rigel' }),
      expect.any(Function),
    );
  });

  it('prompt con testo attaccato: barre aggiornate ed eventi', async () => {
    const { session, emit, line, shown } = await connected();
    const prompts = vi.fn();
    const lines = vi.fn();
    session.bus.on('prompt', prompts);
    session.bus.on('line', lines);

    emit({
      type: 'lines',
      lines: [line('Rigel H481 M493 V247 X-28602993 [T] */*>> Stai trasportando:')],
    });

    expect(shown()).toEqual([
      'system:Collegato.',
      'prompt:Rigel H481 M493 V247 X-28602993 [T] */*>>',
      'mud:Stai trasportando:',
    ]);
    expect(session.state.vitals.hp).toEqual({ value: 481, max: 500, maxSource: 'profilo' });
    expect(session.state.vitals.mv.maxSource).toBe('stimato');
    expect(session.state.promptName).toBe('Rigel');
    expect(prompts).toHaveBeenCalledOnce();
    expect(lines).toHaveBeenCalledWith(expect.objectContaining({ text: 'Stai trasportando:' }));
  });

  it('riga parziale non-prompt riunita al suo seguito', async () => {
    const { session, emit, line, shown } = await connected();
    const lines = vi.fn();
    session.bus.on('line', lines);
    emit({ type: 'lines', lines: [line('Uscite: No', true)] });
    emit({ type: 'lines', lines: [line('rd Est')] });
    expect(shown().slice(1)).toEqual(['mud:Uscite: Nord Est']);
    expect(lines).toHaveBeenCalledOnce();
  });

  it('comando: eco sul prompt, separatore e #n, evento commandSent', async () => {
    const { session, emit, line, sent, shown } = await connected();
    const cmds = vi.fn();
    session.bus.on('commandSent', cmds);
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X4>> ', true)] });
    await session.sendInput('#2 n;look');
    expect(sent).toEqual(['n', 'n', 'look']);
    expect(shown().slice(1)).toEqual(['prompt:Pg H1 M2 V3 X4>>|#2 n;look']);
    expect(cmds).toHaveBeenCalledTimes(3);
    expect(session.history.all).toEqual(['#2 n;look']);
  });

  it('password: niente eco, cronologia né separatori', async () => {
    const { session, emit, sent, shown } = await connected();
    emit({ type: 'serverEcho', on: true });
    await session.sendInput('segre;to');
    expect(sent).toEqual(['segre;to']);
    expect(session.history.all).toEqual([]);
    expect(shown()).toEqual(['system:Collegato.']);
  });

  it('non collegato: avvisa e non manda nulla', async () => {
    const { session, sent } = setup();
    await session.sendInput('look');
    expect(sent).toEqual([]);
    expect(session.output.last?.kind).toBe('system');
  });

  it('il replay non cambia lo stato della connessione', async () => {
    const { session } = setup();
    session.handle({ type: 'status', state: 'replay', message: 'Replay.' });
    expect(session.state.replaying).toBe(true);
    expect(session.state.conn).toBe('disconnected');
    session.handle({ type: 'status', state: 'replayEnded', message: 'Fine.' });
    expect(session.state.replaying).toBe(false);
  });

  it('profilo con un prompt diverso', async () => {
    const { session, emit, line } = await connected();
    session.setProfile({ ...newProfile('Altro'), promptRegex: String.raw`<(?<hp>\d+)hp>` });
    emit({ type: 'lines', lines: [line('<77hp> ciao')] });
    expect(session.state.vitals.hp.value).toBe(77);
  });
});

describe('Session: abbreviazioni degli incantesimi', () => {
  it('espande e mostra nell eco cosa è partito', async () => {
    const { session, emit, line, sent, shown } = await connected();
    const cmds = vi.fn();
    session.bus.on('commandSent', cmds);
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X4>> ', true)] });
    await session.sendInput('di rig;look');
    expect(sent).toEqual(["cast 'detect invisibility' rig", 'look']);
    expect(shown().slice(1)).toEqual([
      "prompt:Pg H1 M2 V3 X4>>|di rig;look → cast 'detect invisibility' rig; look",
    ]);
    expect(cmds).toHaveBeenCalledWith({ text: "cast 'detect invisibility' rig" });
    expect(session.history.all).toEqual(['di rig;look']);
  });

  it('disattivate nel profilo: il comando parte com è', async () => {
    const { session, sent } = await connected();
    session.setProfile({ ...newProfile('Guerriero'), abbreviazioni: false });
    await session.sendInput('port');
    expect(sent).toEqual(['port']);
  });

  it('mai sulla password', async () => {
    const { session, emit, sent } = await connected();
    emit({ type: 'serverEcho', on: true });
    await session.sendInput('mm');
    expect(sent).toEqual(['mm']);
  });
});

describe('Session: accesso automatico', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('utente, password dal portachiavi e scelta del pg, tutto scritto nell output', async () => {
    const t = setup();
    t.session.setAccount({ ...newAccount(), utente: 'account', accessoAutomatico: true }, true);
    await t.session.connect();
    t.emit({ type: 'status', state: 'connected', message: 'Collegato.' });
    t.emit({
      type: 'lines',
      lines: [t.line('Email o nome del personaggio su Nebbie Arcane? ', true)],
    });
    await flush();
    t.emit({ type: 'serverEcho', on: true });
    await flush();
    t.emit({ type: 'serverEcho', on: false });
    t.emit({
      type: 'lines',
      lines: ['', 'Scegli un personagggio', '4. Rigel The NecroMonger'].map((l) => t.line(l)),
    });
    t.emit({ type: 'lines', lines: [t.line('>', true)] });
    await flush();

    expect(t.sent).toEqual(['account', '<password dal portachiavi>', '4']);
    expect(t.backend.sendPassword).toHaveBeenCalledWith('nebbie.nebbie.it', 'account');
    // Il nome utente non va nel log di sessione.
    expect(t.backend.send).toHaveBeenCalledWith('account', false);
    const system = t.session.output.lines
      .filter((l) => l.kind === 'system')
      .map((l) => l.spans[0].text);
    expect(system.filter((s) => s.startsWith('Accesso automatico'))).toHaveLength(3);
    expect(t.session.history.all).toEqual([]);
  });

  it('spento: nessun invio automatico, ma un suggerimento (una volta sola)', async () => {
    const t = await connected();
    const prompt = () =>
      t.emit({
        type: 'lines',
        lines: [t.line('Email o nome del personaggio su Nebbie Arcane? ', true)],
      });
    prompt();
    t.emit({ type: 'lines', lines: [t.line('')] });
    prompt();
    await flush();
    expect(t.sent).toEqual([]);
    const hints = t.session.output.lines.filter((l) =>
      l.spans[0]?.text.startsWith('Accesso automatico spento'),
    );
    expect(hints).toHaveLength(1);
  });
});

describe('Session: eventi del testo di Nebbie', () => {
  it('stanza e uccisione arrivano sul bus, la stanza prima del prompt', async () => {
    const { session, emit, line } = await connected();
    const order: string[] = [];
    session.bus.on('room', (r) => order.push(`room:${r.titolo}`));
    session.bus.on('prompt', () => order.push('prompt'));
    session.bus.on('mobKilled', (m) => order.push(`kill:${m.nome}x${m.volte}`));
    emit({
      type: 'lines',
      lines: [
        line('Pg H1 M2 V3 X4 [T] */*>> Il Crocevia'),
        line("In  questo  punto  si  intersecano  le  piu'  importanti  strade"),
        line('Uscite: Nord Sud'),
        line('Il tuo sangue si gela al grido di morte di una guardia scelta. (x6)'),
        line('Pg H1 M2 V3 X4 [T] */*>> ', true),
      ],
    });
    expect(order).toEqual(['prompt', 'kill:una guardia sceltax6', 'room:Il Crocevia', 'prompt']);
  });
});

describe('Session: score', () => {
  it('score aggiorna subito le barre con i massimi veri, poi il prompt li usa', async () => {
    const { session, emit, line } = await connected();
    emit({
      type: 'lines',
      lines: [
        line("Sei nato nel Giorno dei Martelli, 24^ del Mese dell'Inverno."),
        line('Hai 539(539) hit, 930(950) mana e 135(259) movimento.'),
        line('Sei in piedi.'),
        line(''),
      ],
    });
    expect(session.state.vitals.mv).toEqual({ value: 135, max: 259, maxSource: 'score' });
    emit({ type: 'lines', lines: [line('Pg H500 M900 V140 X1 [T] */*>> ', true)] });
    expect(session.state.vitals.mv).toEqual({ value: 140, max: 259, maxSource: 'score' });
    // Il profilo del test ha hp max 500: lo score (539) ha la precedenza.
    expect(session.state.vitals.hp.max).toBe(539);
  });
});

describe('Session: effetti e combattimento dal prompt', () => {
  it('lettere degli effetti, tank e bersaglio', async () => {
    const { session, emit, line } = await connected();
    emit({
      type: 'lines',
      lines: [line('Pg H1 M2 V3 X-1 [FsTM] eccellente/graffiato>> ', true)],
    });
    expect(session.state.affetti?.map((a) => `${a.lettera}${a.inScadenza ? '-' : ''}`)).toEqual([
      'F',
      'S-',
      'T',
      'M',
    ]);
    expect(session.state.tank).toBe('eccellente');
    expect(session.state.target).toBe('graffiato');
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X-1 [] */*>> ', true)] });
    expect(session.state.affetti).toEqual([]);
    expect(session.state.tank).toBeUndefined();
  });
});

describe('Session: stato per i pannelli', () => {
  it('ultima stanza visitata (non quelle guardate) e incantesimi di att', async () => {
    const { session, emit, line } = await connected();
    emit({
      type: 'lines',
      lines: ['Il Crocevia', 'Uscite: Nord Sud'].map((l) => line(l)),
    });
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X4>> ', true)] });
    expect(session.state.room?.titolo).toBe('Il Crocevia');
    emit({
      type: 'lines',
      lines: ['Spells attivi:', "Spell : 'armor' - 4", ''].map((l) => line(l)),
    });
    expect(session.state.att?.incantesimi).toEqual([{ nome: 'armor', durata: 4 }]);
    expect(session.state.att?.letto).toBeGreaterThan(0);
  });
});

describe('Session: statistiche, timer e allarme furto', () => {
  it('XP dalla X del prompt, uccisioni con (x6), monete', async () => {
    const { session, emit, line } = await connected();
    emit({
      type: 'lines',
      lines: [
        line('Pg H1 M2 V3 X-132.811.939 [T] */*>> '),
        line('Il tuo sangue si gela al grido di morte di una guardia scelta. (x6)'),
        line("C'erano 100.000 monete."),
        line('Pg H1 M2 V3 X-132.817.037 [T] */*>> ', true),
      ],
    });
    expect(session.state.stats).toMatchObject({ xp: 5098, uccisi: 6, monete: 100_000 });
    session.resetStats();
    expect(session.state.stats).toMatchObject({ xp: 0, uccisi: 0 });
  });

  it('timer da att e fine dell incantesimo', async () => {
    const { session, emit, line } = await connected();
    emit({
      type: 'lines',
      lines: ['Spells attivi:', "Spell : 'armor' - 4", "Spell : 'shield' - 37", ''].map((l) =>
        line(l),
      ),
    });
    expect(session.state.timers.map((t) => t.nome)).toEqual(['armor', 'shield']);
    emit({ type: 'lines', lines: [line('La tua armatura magica si dissolve.')] });
    expect(session.state.timers.map((t) => t.nome)).toEqual(['shield']);
  });

  it('allarme furto se il prompt mostra l oro e cala senza comandi', async () => {
    const { session, emit, line } = await connected();
    session.setProfile({
      ...newProfile('Pg'),
      promptRegex: String.raw`H(?<hp>\d+) Oro:(?<oro>[\d.]+)>`,
    });
    emit({ type: 'lines', lines: [line('H10 Oro:50.000> ', true)] });
    emit({ type: 'lines', lines: [line('H10 Oro:20.000> ', true)] });
    const alarm = session.output.lines.find((l) => l.kind === 'alarm');
    expect(alarm?.spans[0].text).toBe(
      '[FURTO?] ti mancano 30.000 monete di tasca (da 50.000 a 20.000)',
    );
  });
});

describe('Session: tick dalle scadenze', () => {
  it('una scadenza vera fissa il tick, un immagine distrutta no', async () => {
    const { session, emit, line } = await connected();
    emit({ type: 'lines', lines: [line('La tua immagine illusoria svanisce.')] });
    expect(session.state.tick.ultimo).toBeUndefined();
    emit({ type: 'lines', lines: [line('La tua pelle torna normale.')] });
    expect(session.state.tick.ultimo).toBeGreaterThan(0);
  });
});

describe('Session: effetti dalle lettere del prompt (incantesimi e pozioni)', () => {
  it('il primo prompt fa da riferimento; poi lettere nuove avviano, sparite chiudono', async () => {
    const { session, emit, line } = await connected();
    session.setLearnedDurations({ sanctuary: 300_000, fireshield: 200_000 });
    const prompt = (flags: string) =>
      emit({ type: 'lines', lines: [line(`Pg H1 M2 V3 X4 [${flags}] */*>> `, true)] });
    prompt('T'); // riferimento: true sight era già attivo, nessun timer inventato
    expect(session.state.timers).toEqual([]);
    prompt('TS'); // pozione di sanctuary: niente "Pronunci le parole", ma la S compare
    expect(session.state.timers.map((t) => [t.nome, t.fonte])).toEqual([['sanctuary', 'prompt']]);
    prompt('Ts'); // in scadenza
    expect(session.state.timers[0].avviso).toBe(true);
    prompt('T'); // finita
    expect(session.state.timers).toEqual([]);
  });

  it('dopo una riconnessione le lettere presenti non sono effetti nuovi', async () => {
    const { session, emit, line } = await connected();
    session.setLearnedDurations({ fireshield: 200_000 });
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X4 [] */*>> ', true)] });
    emit({ type: 'status', state: 'disconnected', message: 'Disconnesso.' });
    emit({ type: 'status', state: 'connected', message: 'Collegato.' });
    emit({ type: 'lines', lines: [line('Pg H1 M2 V3 X4 [F] */*>> ', true)] });
    expect(session.state.timers).toEqual([]);
  });
});

describe('Session: tick dagli att ravvicinati', () => {
  it('una durata scesa tra due att vicini fissa il tick a metà (log reale 862 s / 902 s)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(862_100);
      const { session, emit, line } = await connected();
      const att = (shield: number) =>
        emit({
          type: 'lines',
          lines: ['Spells attivi:', `Spell : 'shield' - ${shield}`, ''].map((l) => line(l)),
        });
      att(9);
      expect(session.state.tick.ultimo).toBeUndefined();
      vi.setSystemTime(902_600);
      att(8);
      expect(session.state.tick.ultimo).toBe(882_350);
      // shield 8: fine al 9° scatto dopo la lettura = prossimo tick (957.350) + 8 tick
      expect(session.state.timers[0].fine).toBe(957_350 + 8 * 75_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Session: alias e trigger dell utente', () => {
  it('alias espanso prima delle abbreviazioni, eco con la freccia', async () => {
    const { session, sent, shown } = await connected();
    const f = emptyAutomation();
    f.alias.push({
      ...newAlias(f.gruppi[0].id),
      pattern: String.raw`mmm (\w+)`,
      azione: 'mm $1;mm $1',
    });
    session.setAutomation(f, undefined);
    await session.sendInput('mmm orco');
    expect(sent).toEqual(["cast 'magic missile' orco", "cast 'magic missile' orco"]);
    expect(shown().at(-1)).toContain(
      "mmm orco → cast 'magic missile' orco; cast 'magic missile' orco",
    );
  });

  it('trigger: comando scritto nell output, colore, nascondi', async () => {
    const { session, emit, line, sent } = await connected();
    const f = emptyAutomation();
    const g = f.gruppi[0].id;
    f.trigger.push({
      ...newTrigger(g),
      nome: 'monete',
      pattern: 'grido di morte',
      comando: 'get all.coin corp',
    });
    f.trigger.push({ ...newTrigger(g), pattern: 'Achievement', colore: '#ff0' });
    f.trigger.push({ ...newTrigger(g), pattern: 'squeaking', nascondi: true });
    session.setAutomation(f, undefined);
    emit({
      type: 'lines',
      lines: [
        line('Il tuo sangue si gela al grido di morte di la Ronda.'),
        line("Race Achievement #2 'Misantropo' 1047/10000."),
        line('You hear squeaking noises nearby'),
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['get all.coin corp']);
    const texts = session.output.lines.map((l) => l.spans.map((s) => s.text).join('') || l.echo);
    expect(texts).toContain('⚙ monete → get all.coin corp');
    expect(texts).not.toContain('You hear squeaking noises nearby');
    expect(session.output.lines.find((l) => l.colore)?.colore).toBe('#ff0');
  });
});

describe('Session: pulsanti', () => {
  it('manda come se fosse scritto, senza cronologia, con l etichetta nell output', async () => {
    const { session, sent, shown } = await connected();
    await session.sendFromButton('Attacco', 'mm orco;#2 n');
    expect(sent).toEqual(["cast 'magic missile' orco", 'n', 'n']);
    expect(session.history.all).toEqual([]);
    expect(shown().at(-1)).toBe("echo:|▶ Attacco → cast 'magic missile' orco; n; n");
  });

  it('non collegato: avvisa e non manda nulla', async () => {
    const { session, sent } = setup();
    await session.sendFromButton('X', 'look');
    expect(sent).toEqual([]);
  });
});

describe('Session: percorsi', () => {
  const P = (nome: string, path: string, extra: Partial<PathEntry> = {}): PathEntry => ({
    id: `t:${nome}`,
    zona: 'Skexie',
    nome,
    nota: '',
    path,
    origine: 'registrato',
    ...extra,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const room = (titolo: string) => [`${titolo}`, 'Una stanza.', 'Uscite: n s'];

  it('vai <nome>: un passo per volta, solo se il movimento porta in una stanza nuova', async () => {
    const { session, emit, line, sent, shown } = await connected();
    const saved: PathsFile[] = [];
    session.onPathsChanged = (f) => saved.push(f);
    session.setPaths({ ...emptyPathsFile(), percorsi: [P('Mantern2', '2w')] });
    await session.sendInput('vai mantern2');
    await tick();
    expect(sent).toEqual(['w']);
    expect(session.state.sequence).toMatchObject({ nome: 'Mantern2', passo: 1, totale: 2 });
    emit({
      type: 'lines',
      lines: [...room('Strada').map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
    });
    await tick();
    expect(sent).toEqual(['w', 'w']);
    emit({
      type: 'lines',
      lines: [...room('Piazza').map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
    });
    await tick();
    expect(session.state.sequence).toBeUndefined();
    expect(shown().at(-1)).toBe('system:Percorso Mantern2 finito.');
    expect(session.history.all).toEqual(['vai mantern2']);
    expect(saved.at(-1)?.usati['t:Mantern2']).toBeGreaterThan(0);
  });

  it('una porta chiusa ferma il percorso (riprendibile); la fine di un run no', async () => {
    const { session, emit, line, sent } = await connected();
    session.setPaths({ ...emptyPathsFile(), percorsi: [P('Prova', 'run e,n,n')] });
    await session.sendInput('vai prova');
    await tick();
    emit({
      type: 'lines',
      lines: [
        ...room('Strada').map((t) => line(t)),
        line('Mi spiace, ma non riesci a correre ulteriormente.'),
        line('Pg H1 M2 V3 X4>> ', true),
      ],
    });
    await tick();
    expect(sent).toEqual(['run e', 'n']);
    emit({ type: 'lines', lines: [line("La porta e' chiusa."), line('Pg H1 M2 V3 X4>> ', true)] });
    await tick();
    expect(session.state.sequence).toMatchObject({ stato: 'fermo', passo: 2, fallito: true });
    await session.sendInput('vai riprendi');
    await tick();
    expect(sent).toEqual(['run e', 'n', 'n']);
  });

  it('percorsi <zona>, vai <numero>, vai prova, vai stop', async () => {
    const { session, sent, shown } = await connected();
    await session.sendInput('percorsi astral');
    expect(shown().some((l) => l.includes('1. Myst'))).toBe(true);
    await session.sendInput('vai prova 2');
    expect(shown().at(-1)).toBe('system:Prova Ancient Road (3 comandi): u, n, e');
    await session.sendInput('vai 1');
    await tick();
    expect(sent).toEqual(['n']);
    await session.sendInput('vai stop');
    expect(session.state.sequence).toMatchObject({ stato: 'fermo' });
  });

  it('vai passo: un passo alla volta, vai avanti per il successivo', async () => {
    const { session, emit, line, sent } = await connected();
    session.setPaths({ ...emptyPathsFile(), percorsi: [P('Casa', 'n,e')] });
    await session.sendInput('vai passo casa');
    await tick();
    expect(sent).toEqual(['n']);
    emit({
      type: 'lines',
      lines: [...room('Strada').map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
    });
    expect(session.state.sequence).toMatchObject({ stato: 'pausa', passoPasso: true });
    await session.sendInput('vai avanti');
    await tick();
    expect(sent).toEqual(['n', 'e']);
  });

  it('vai passo: in pausa gli automatismi girano; il passo aspetta la loro risposta', async () => {
    // Log reale del 2026-11-18: rilanci e loot in coda per tutto il percorso, poi tutti insieme.
    const { session, emit, line, sent } = await connected();
    const prompt = () => 'Rigel H500 M400 V250 X4 G10 [] */*';
    vi.useFakeTimers({ toFake: ['Date'] });
    session.setAutoConfig(defaultAutoConfig(), () => {});
    await session.sendInput('mantieni armor {pg}');
    await session.sendInput('mantieni on');
    session.setPaths({ ...emptyPathsFile(), percorsi: [P('Casa', 'n,e')] });
    await session.sendInput('vai passo casa');
    await tick();
    emit({
      type: 'lines',
      lines: [...room('Strada').map((t) => line(t)), line(prompt(), true)],
    });
    expect(session.state.sequence).toMatchObject({ stato: 'pausa' });
    emit({
      type: 'lines',
      lines: [line('La tua armatura magica si dissolve.'), line(prompt(), true)],
    });
    expect(sent).toEqual(['n', "cast 'armor' Rigel"]); // subito, non a fine percorso
    await session.sendInput('vai avanti');
    await tick();
    expect(sent).toHaveLength(2); // il lancio non ha ancora risposto
    vi.setSystemTime(Date.now() + 3000);
    emit({ type: 'lines', lines: [line("Pronunci le parole, 'armor'."), line(prompt(), true)] });
    vi.useRealTimers();
    await tick();
    expect(sent).toEqual(['n', "cast 'armor' Rigel", 'e']);
  });

  it('lontano dalla stanza di partenza chiede conferma', async () => {
    const { session, emit, line, sent, shown } = await connected();
    session.setPaths({ ...emptyPathsFile(), percorsi: [P('Casa', 'n', { partenza: 'Piazza' })] });
    emit({
      type: 'lines',
      lines: [...room('Strada').map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
    });
    await session.sendInput('vai casa');
    expect(sent).toEqual([]);
    expect(shown().at(-1)).toContain('ripeti entro 15 secondi');
    await session.sendInput('vai casa');
    await tick();
    expect(sent).toEqual(['n']);
  });

  it('rec: registra camminando e salva compattando', async () => {
    const { session, emit, line } = await connected();
    const saved: PathsFile[] = [];
    session.onPathsChanged = (f) => saved.push(f);
    emit({
      type: 'lines',
      lines: [...room('Piazza').map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
    });
    await session.sendInput('rec');
    for (const [cmd, dove] of [
      ['n', 'Strada'],
      ['n', 'Bivio'],
      ['e', ''],
      ['w', 'Casa'],
    ]) {
      await session.sendInput(cmd);
      const risposta = dove ? room(dove) : ['Non puoi andare da quella parte.'];
      emit({
        type: 'lines',
        lines: [...risposta.map((t) => line(t)), line('Pg H1 M2 V3 X4>> ', true)],
      });
    }
    expect(session.state.recording?.passi).toEqual(['n', 'n', 'w']);
    await session.sendInput('rec fine Verso casa');
    expect(session.state.recording).toBeUndefined();
    expect(saved.at(-1)?.percorsi.at(-1)).toMatchObject({
      nome: 'Verso casa',
      path: '2n,w',
      partenza: 'Piazza',
      arrivo: 'Casa',
      origine: 'registrato',
    });
  });

  it('modificare un percorso del pacchetto crea una copia che lo sostituisce', async () => {
    const { session } = await connected();
    const myst = session.allPaths.find((p) => p.nome === 'Myst')!;
    const copia = session.savePath({ ...myst, path: 'n,n' });
    expect(copia.sostituisce).toBe(myst.id);
    expect(session.allPaths.filter((p) => p.nome === 'Myst')).toEqual([copia]);
    session.deletePath(copia);
    expect(session.allPaths.find((p) => p.nome === 'Myst')?.origine).toBe('pacchetto');
  });
});

describe('Session: oro', () => {
  it('le monete in tasca dal prompt finiscono nello stato (per la barra)', async () => {
    const { session, emit, line } = await connected();
    expect(session.state.oro).toBeUndefined();
    emit({
      type: 'lines',
      lines: [line('Rigel H539 M950 V257 X-134.499.587 G29.660.718 [T] */* ', true)],
    });
    expect(session.state.oro).toBe(29660718);
  });
});

describe('Session: segnaposto {pg}', () => {
  it('diventa il nome del personaggio (dal prompt, altrimenti dal profilo)', async () => {
    const { session, emit, line, sent } = await connected();
    await session.sendFromButton('Armor', "cast 'armor' {pg}");
    expect(sent.at(-1)).toBe("cast 'armor' Rigel");
    emit({ type: 'lines', lines: [line('Aldebaran H1 M2 V3 X4>> ', true)] });
    await session.sendInput('cast shield {PG}');
    expect(sent.at(-1)).toBe('cast shield Aldebaran');
  });
});

describe('Session: moduli', () => {
  it('comandi del client per i moduli e second wind nel gioco', async () => {
    const { session, shown } = await connected();
    await session.sendInput('fabbro si');
    expect(shown().at(-1)).toMatch(/\[Vestiario\] fabbro presente/);
    session.toggleModule('fabbro');
    expect(session.state.modules.fabbro).toBe(true);
    expect(session.gear.cfg.fabbro.automatico).toBe(true);
  });
});

describe('Session: automatismi', () => {
  const prompt = (mv = 250, extra = '') => `Rigel H500 M400 V${mv} X4 G10 [${extra}] */*`;

  it('regola second wind (migrata da moduli.json) e pannello delle azioni', async () => {
    const { session, emit, line, sent, shown } = await connected();
    session.setAutoConfig(migrateAutoConfig({ attivo: true, soglia: 70 }), () => {});
    expect(session.state.modules.regole).toBe(true);
    emit({ type: 'lines', lines: [line(prompt(50), true)] });
    expect(sent).toEqual(["cast 'second wind' Rigel"]);
    expect(shown().some((l) => l.includes('⚙ Regola "second wind con poco movimento"'))).toBe(true);
    expect(session.state.auto.azioni[0].testo).toContain("cast 'second wind' {pg}");
    session.toggleModule('regole');
    expect(session.state.modules.regole).toBe(false);
  });

  it('mantieni attivi: rilancia alla fine (messaggio del MUD) e impara il costo', async () => {
    const { session, emit, line, sent } = await connected();
    const saved: AutoConfig[] = [];
    session.setAutoConfig(defaultAutoConfig(), (c) => saved.push(structuredClone(c)));
    await session.sendInput('mantieni armor {pg}');
    await session.sendInput('mantieni on');
    emit({
      type: 'lines',
      lines: [line(prompt()), line('La tua armatura magica si dissolve.'), line(prompt(), true)],
    });
    expect(sent).toEqual(["cast 'armor' Rigel"]);
    emit({
      type: 'lines',
      lines: [
        line("Pronunci le parole, 'armor'."),
        line('Rigel H500 M385 V250 X4 G10 [] */*', true),
      ],
    });
    expect(saved.at(-1)?.costi).toEqual({ armor: 15 });
  });

  it('niente automatismi in mezzo a una sequenza: partono dopo', async () => {
    const { session, emit, line, sent } = await connected();
    session.setAutoConfig(migrateAutoConfig({ attivo: true, soglia: 70 }), () => {});
    session.setPaths({
      ...emptyPathsFile(),
      percorsi: [{ id: 't', zona: 'X', nome: 'P', nota: '', path: 'n', origine: 'utente' }],
    });
    await session.sendInput('vai p');
    await new Promise((r) => setTimeout(r, 0));
    emit({ type: 'lines', lines: [line('Strada'), line('Uscite: n s'), line(prompt(50), true)] });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['n', "cast 'second wind' Rigel"]);
  });
});

describe('Session: split delle monete del loot', () => {
  // log reale del 2026-11-18: loot dal cadavere e poi `split 10000` a mano
  const cfg = (attiva: boolean): AutoConfig => {
    const c = defaultAutoConfig();
    c.regole.attivo = true;
    for (const r of c.regole.voci) r.attiva = r.preset === 'split' && attiva;
    return c;
  };
  const p = 'Rigel H597 M851 V104 X-51.075.998 G21.356.945 [STMD] */*';

  it('divide col gruppo le monete prese dal cadavere', async () => {
    const { session, emit, line, sent } = await connected();
    session.setAutoConfig(cfg(true), () => {});
    emit({
      type: 'lines',
      lines: [
        line('Prendi gold coins da il corpo di Herrd Von Zarovich.'),
        line("C'erano 10.000 monete."),
        line(''),
        line(p, true),
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['split 10000']);
  });

  it('anche dalla polvere; spenta non manda niente', async () => {
    const t = await connected();
    t.session.setAutoConfig(cfg(false), () => {});
    const loot = [
      t.line('Prendi gold coins da a pile of dust and bones.'),
      t.line("C'erano 100.000 monete."),
      t.line(p, true),
    ];
    t.emit({ type: 'lines', lines: loot });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sent).toEqual([]);
    t.session.setAutoConfig(cfg(true), () => {});
    t.emit({ type: 'lines', lines: loot });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sent).toEqual(['split 100000']);
  });

  it('le monete non prese da un cadavere non si dividono', async () => {
    const { session, emit, line, sent } = await connected();
    session.setAutoConfig(cfg(true), () => {});
    emit({ type: 'lines', lines: [line("C'erano 500 monete."), line(p, true)] });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
  });

  it('nei profili esistenti la regola compare spenta', () => {
    const vecchio = { regole: { attivo: true, voci: [presetRules()[1]] } };
    const voci = parseAutoConfig(vecchio).regole.voci;
    expect(voci.map((r) => r.preset)).toEqual(['monete', 'split']);
    expect(voci[1].attiva).toBe(false);
  });
});

describe('Session: mappa e monete', () => {
  it('entrando in una stanza identica posa una moneta, una alla volta', async () => {
    const { session, emit, line, sent, shown } = await connected();
    const room = (extra: string[] = []) => [
      line('Nel labirinto'),
      line('Corridoi tutti uguali si perdono nel buio.'),
      line('Le pareti sono umide.'),
      line('Uscite: Nord Est Sud Ovest'),
      ...extra.map((t) => line(t)),
      line('Rigel H500 M400 V250 X4 G10 [] */*', true),
    ];
    // spento (come all'avvio) non crea niente
    await session.sendInput('look');
    emit({ type: 'lines', lines: room() });
    expect(Object.keys(session.mapper.data.stanze)).toHaveLength(0);
    await session.sendInput('mappa on Labirinto'); // zona nuova
    expect(session.state.modules.mapper).toBe(true);
    await session.sendInput('look');
    emit({ type: 'lines', lines: room() });
    expect(session.mapper.current?.zona).toBe(session.mapper.data.zone[0].id);
    expect(session.mapper.data.zone[0].nome).toBe('Labirinto');
    await session.sendInput('e');
    emit({ type: 'lines', lines: room() });
    expect(sent).toEqual(['look', 'look', 'e', 'drop 1 coin']);
    expect(shown().some((l) => l.includes('⚙ Mappa: marco la stanza con 1 monete'))).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); // il drop parte prima della risposta del MUD
    emit({
      type: 'lines',
      lines: [line('Posi una moneta.'), line('Rigel H500 M400 V250 X4 G9 [] */*', true)],
    });
    await session.sendInput('e');
    emit({ type: 'lines', lines: room(['One miserable gold coin.']) });
    const cur = session.mapper.current!;
    expect(cur.uscite.e).toBe(cur.id);
  });

  it('invisibilità rotta e immagini distrutte in combattimento non sono un tick (log del 2026-11-15)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const { session, emit, line } = await connected();
      const prompt = (flags: string, tail = '*/*') =>
        emit({
          type: 'lines',
          lines: [line(`Rigel H523 M1072 V256 X-163 G33 [${flags}] ${tail}`, true)],
        });
      prompt('fITM');
      vi.setSystemTime(1_010_000);
      emit({ type: 'lines', lines: [line('La tua armatura magica si dissolve.')] });
      prompt('fITM');
      expect(session.state.tick.ultimo).toBe(1_010_000);
      vi.setSystemTime(1_025_000); // 15 s dopo: attacchi, I e M spariscono
      prompt('fT', 'graffiato/eccellente');
      expect(session.state.tick.ultimo).toBe(1_010_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caduta: sfondo rosso sull azione fallita, verde quando ti rialzi (richiesta del 2026-11-15)', async () => {
    const { session, emit, line } = await connected();
    const find = (t: string) =>
      session.output.lines.find((l) => l.spans.map((x) => x.text).join('') === t);
    emit({
      type: 'lines',
      lines: [
        line('Provi a disarmare il goblin alchimista, ma fallisci miseramente.'),
        line('Rigel H539 M935 V208 X4 G3 [fsTM] graffiato/ferito', true),
      ],
    });
    expect(find('Provi a disarmare il goblin alchimista, ma fallisci miseramente.')?.sfondo).toBe(
      'rosso',
    );
    await session.sendInput('stand'); // in combattimento il MUD non risponde niente
    expect(session.output.lines.find((l) => l.echo === 'stand')?.sfondo).toBe('verde');
    // un altro "Sei in piedi." senza caduta: niente sfondo
    emit({ type: 'lines', lines: [line('Sei in piedi.')] });
    expect(find('Sei in piedi.')?.sfondo).toBeUndefined();
    emit({ type: 'lines', lines: [line("Il troll ti manda a gambe all'aria. [-20]")] });
    emit({ type: 'lines', lines: [line('Ti alzi.')] });
    expect(find('Ti alzi.')?.sfondo).toBe('verde');
    // stand non riuscito: il MUD lo dice alla prossima azione (log reale col Saladino)
    emit({ type: 'lines', lines: [line('Stai ancora annaspando per rialzarti!')] });
    expect(find('Stai ancora annaspando per rialzarti!')?.sfondo).toBe('rosso');
    await session.sendInput('stand');
    expect(session.output.lines.filter((l) => l.echo === 'stand').at(-1)?.sfondo).toBe('verde');
  });

  it('effetto finito nel prompt che apre il combattimento: nessun rilancio in mezzo (sir Goldblum)', async () => {
    const { session, emit, line, sent } = await connected();
    session.keep.enabled = true;
    session.keep.entries = [{ incantesimo: 'mirror images', bersaglio: '{pg}' }];
    const prompt = (flags: string, tail: string) =>
      emit({
        type: 'lines',
        lines: [line(`Rigel H508 M1072 V231 X-163 G33 [${flags}] ${tail}`, true)],
      });
    prompt('sITM', '*/*');
    emit({ type: 'lines', lines: [line('La tua immagine illusoria svanisce.')] });
    prompt('sIT', 'graffiato/eccellente'); // M sparita proprio quando inizia il combattimento
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([]);
    expect(session.keep.waiting[0]?.motivo).toContain('combattimento');
    emit({ type: 'lines', lines: [line('Pensavi di poter combattere da seduto?')] });
    emit({
      type: 'lines',
      lines: [line('Cerchi di accecare Alberique Du Migard, ma gli ammacchi appena il naso.')],
    });
    expect(
      session.output.lines.find((l) =>
        l.spans
          .map((x) => x.text)
          .join('')
          .startsWith('Cerchi di accecare'),
      )?.sfondo,
    ).toBe('rosso');
    emit({ type: 'lines', lines: [line('Prima forse dovresti alzarti, non credi?')] });
    expect(
      session.output.lines.find(
        (l) => l.spans.map((x) => x.text).join('') === 'Prima forse dovresti alzarti, non credi?',
      )?.sfondo,
    ).toBe('rosso');
    const red = session.output.lines.find(
      (l) => l.spans.map((x) => x.text).join('') === 'Pensavi di poter combattere da seduto?',
    );
    expect(red?.sfondo).toBe('rosso');
  });

  it('avvisi: messaggio privato e al gruppo, HP bassi una volta, caduta, collegamento perso', async () => {
    const { session, emit, line } = await connected();
    session.setProfile({ ...newProfile('Rigel'), max: { hp: 500 } });
    const alerts: string[] = [];
    session.onAlert = (tipo) => alerts.push(tipo);
    session.alertHp = 30;
    emit({ type: 'lines', lines: [line("[Leoven] ti dice 'ciao'")] });
    emit({ type: 'lines', lines: [line("[Montero] dice al gruppo 'andiamo'")] });
    const prompt = (hp: number) =>
      emit({ type: 'lines', lines: [line(`Rigel H${hp} M400 V250 X4 G10 [] */*`, true)] });
    prompt(400);
    prompt(120); // sotto il 30%
    prompt(100); // ancora sotto: nessun nuovo avviso
    prompt(200); // risale oltre 35%
    prompt(110); // di nuovo sotto
    emit({ type: 'lines', lines: [line("Il troll ti manda a gambe all'aria. [-20]")] });
    emit({ type: 'status', state: 'disconnected', message: 'Collegamento chiuso.' });
    expect(alerts).toEqual(['tell', 'gruppo', 'hp', 'hp', 'terra', 'disconnesso']);
    // disconnessione chiesta dall'utente: nessun avviso
    emit({ type: 'status', state: 'connected', message: 'Collegato.' });
    await session.disconnect();
    emit({ type: 'status', state: 'disconnected', message: 'Scollegato.' });
    expect(alerts.at(-1)).toBe('disconnesso');
    expect(alerts.filter((a) => a === 'disconnesso')).toHaveLength(1);
  });
});

describe('Reliquiario nella sessione (2026-11-17)', () => {
  it('identify ed eq finiscono in identi.js della cartella scelta', async () => {
    const t = await connected();
    let file: string | null = null;
    t.session.relicIo = {
      read: async () => file,
      write: async (_c, testo) => {
        file = testo;
      },
    };
    await t.session.relics.setFolder('/Users/x/MUD-Stuff');
    const asked: unknown[] = [];
    t.session.onAskRelicContainer = (o) => asked.push(o);
    const P = 'Rigel H490 M500 V255 X-1 [T] */* ';
    t.emit({
      type: 'lines',
      lines: [
        t.line('Smetti di usare il sigillo delle ombre.'),
        t.line(P, true),
        t.line("Oggetto: 'sigillo ombre', Tipo di Oggetto JEWEL"),
        t.line("L'oggetto e': METAL ARTIFACT"),
        t.line('Peso: 3, Valore: 20000, Costo di rent: 7500 [RARO]'),
        t.line("Ti puo' dare : HIT by 29"),
        t.line(P, true),
        t.line('Stai usando:'),
        t.line('[ 1] <sul dito destro>       Il sigillo delle ombre (ha un alone luminoso)'),
        t.line(P, true),
      ],
    });
    await t.session.relics.reload();
    const db = JSON.parse(file!.replace(/^window\.MUD_DB = /, '').replace(/;\s*$/, ''));
    expect(db.oggetti['sigillo ombre']).toMatchObject({
      nome: 'Il sigillo delle ombre',
      slot: 'sul dito destro',
      stats: { HIT: 29 },
    });
    expect(db.pg.Rigel.eq).toEqual([
      { slot: 'sul dito destro', nome: 'Il sigillo delle ombre' },
    ]);
    expect(t.session.state.relics.oggetti).toBe(1);
    expect(asked).toEqual([{ chiave: 'sigillo ombre', nome: 'Il sigillo delle ombre' }]);
    expect(t.shown().some((l) => l.includes('[Reliquiario] nuovo: Il sigillo delle ombre'))).toBe(
      true,
    );
  });
});
