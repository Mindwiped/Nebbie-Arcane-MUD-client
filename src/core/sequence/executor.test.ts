import { describe, expect, it } from 'vitest';
import { pathJudge } from '../../nebbie/paths/moves';
import { Executor, type SequenceSpec, type StepJudge } from './executor';

function setup() {
  const sent: string[] = [];
  const infos: string[] = [];
  const timers: (() => void)[] = [];
  const ex = new Executor({
    send: async (c) => void sent.push(c),
    info: (t) => void infos.push(t),
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const prompt = async (inCombattimento = false) => {
    ex.prompt({ inCombattimento });
    await tick();
  };
  return { ex, sent, infos, timers, tick, prompt };
}

/** Giudice che fallisce se vede la riga "no". */
const failOnNo = (): StepJudge => {
  let bad = false;
  return {
    on: (ev, data) => void (ev === 'line' && data === 'no' && (bad = true)),
    prompt: () => (bad ? { ok: false, motivo: 'no' } : { ok: true }),
  };
};

const room = { titolo: 'X', guardata: false };

describe('Executor', () => {
  it('un passo al prompt del precedente, poi finisce', async () => {
    const { ex, sent, infos, prompt, tick } = setup();
    let done = false;
    ex.start({
      nome: 'P',
      categoria: 'percorso',
      passi: [{ cmd: 'n' }, { cmd: 'e' }],
      onFinish: () => (done = true),
    });
    await tick();
    expect(sent).toEqual(['n']);
    expect(ex.state).toMatchObject({ passo: 1, totale: 2, stato: 'corre' });
    await prompt();
    expect(sent).toEqual(['n', 'e']);
    await prompt();
    expect(ex.state).toBeNull();
    expect(done).toBe(true);
    expect(infos.at(-1)).toBe('Percorso P finito.');
  });

  it('un movimento senza stanza nuova o contro un muro ferma la sequenza; riprendi e salta', async () => {
    const { ex, sent, prompt, tick } = setup();
    ex.start({
      nome: 'P',
      categoria: 'percorso',
      passi: ['n', 'e', 's'].map((cmd) => ({ cmd, judge: pathJudge(cmd) })),
    });
    await tick();
    ex.event('room', room);
    await prompt();
    ex.event('moveFailed', { motivo: 'muro', testo: 'Non puoi andare da quella parte.' });
    await prompt();
    expect(ex.state).toMatchObject({ passo: 2, stato: 'fermo', fallito: true });
    expect(ex.state?.motivo).toContain('Non puoi andare');
    expect(ex.busy).toBe(false);
    ex.resume();
    await tick();
    expect(sent).toEqual(['n', 'e', 'e']);
    await prompt(); // nessuna stanza
    expect(ex.state?.motivo).toContain('nessuna stanza nuova');
    ex.skip();
    await tick();
    expect(sent.at(-1)).toBe('s');
  });

  it('porta chiusa con "apri le porte": open e un nuovo tentativo, una volta', async () => {
    const { ex, sent, prompt, tick } = setup();
    const porta = { motivo: 'porta', testo: "La porta e' chiusa." };
    ex.start({
      nome: 'P',
      categoria: 'percorso',
      passi: [{ cmd: 'n', judge: pathJudge('n', { porte: true }) }],
    });
    await tick();
    ex.event('moveFailed', porta);
    await prompt();
    expect(sent).toEqual(['n', 'open n']);
    await prompt();
    expect(sent).toEqual(['n', 'open n', 'n']);
    ex.event('moveFailed', porta);
    await prompt();
    expect(ex.state).toMatchObject({ stato: 'fermo' });
  });

  it('alternativa, nuovi tentativi e passi da saltare', async () => {
    const { ex, sent, prompt, tick } = setup();
    const spec: SequenceSpec = {
      nome: 'b',
      categoria: 'cambio di set',
      passi: [
        { cmd: 'hold x', alt: 'wear x', judge: failOnNo },
        { cmd: 'cast a', seFallisce: { ritenta: 1 }, judge: failOnNo },
        { cmd: 'get y', seFallisce: 'salta', judge: failOnNo },
        { cmd: 'look' },
      ],
    };
    ex.start(spec);
    await tick();
    ex.event('line', 'no');
    await prompt();
    expect(sent.at(-1)).toBe('wear x');
    await prompt();
    ex.event('line', 'no');
    await prompt();
    expect(sent.slice(-2)).toEqual(['cast a', 'cast a']);
    await prompt();
    ex.event('line', 'no');
    await prompt();
    expect(sent.at(-1)).toBe('look');
    await prompt();
    expect(ex.state).toBeNull();
  });

  it('combattimento: si ferma dopo il passo riuscito e riparte dal successivo', async () => {
    const { ex, sent, prompt, tick } = setup();
    ex.start({
      nome: 'P',
      categoria: 'percorso',
      fermaInCombattimento: true,
      passi: [{ cmd: 'n' }, { cmd: 'e' }],
    });
    await tick();
    await prompt(true);
    expect(ex.state).toMatchObject({
      stato: 'fermo',
      passo: 2,
      motivo: expect.stringContaining('combattimento'),
    });
    expect(sent).toEqual(['n']);
    ex.resume();
    await tick();
    expect(sent).toEqual(['n', 'e']);
  });

  it('pausa, nessuna risposta, una sequenza alla volta', async () => {
    const { ex, sent, prompt, tick, timers } = setup();
    ex.start({ nome: 'P', categoria: 'percorso', passi: [{ cmd: 'n' }, { cmd: 'e' }] });
    await tick();
    expect(ex.start({ nome: 'Q', categoria: 'percorso', passi: [{ cmd: 'w' }] })).toBe(false);
    ex.pause();
    await prompt();
    expect(sent).toEqual(['n']);
    expect(ex.state).toMatchObject({ stato: 'pausa', passo: 2 });
    ex.resume();
    await tick();
    expect(sent).toEqual(['n', 'e']);
    timers.at(-1)!();
    expect(ex.state?.motivo).toContain('nessuna risposta');
    // Una sequenza ferma non blocca la successiva.
    expect(ex.start({ nome: 'Q', categoria: 'percorso', passi: [{ cmd: 'w' }] })).toBe(true);
  });

  it('stop mentre un passo aspetta: la risposta conta, riprendi va avanti', async () => {
    const { ex, sent, prompt, tick } = setup();
    ex.start({ nome: 'P', categoria: 'percorso', passi: [{ cmd: 'n' }, { cmd: 'e' }] });
    await tick();
    ex.stop();
    await prompt();
    expect(sent).toEqual(['n']);
    expect(ex.state).toMatchObject({ stato: 'fermo', passo: 2 });
    ex.resume();
    await tick();
    expect(sent).toEqual(['n', 'e']);
  });

  it('un passo alla volta: dopo ogni passo aspetta next(); la porta resta nello stesso passo', async () => {
    const { ex, sent, prompt, tick } = setup();
    let done = false;
    ex.start({
      nome: 'P',
      categoria: 'percorso',
      passoPasso: true,
      passi: [
        { cmd: 'n' },
        { cmd: 'e', judge: failOnNo, seFallisce: { ritenta: 1 } },
        { cmd: 's' },
      ],
      onFinish: () => (done = true),
    });
    await tick();
    expect(sent).toEqual(['n']); // il primo passo parte subito
    await prompt();
    expect(ex.state).toMatchObject({ stato: 'pausa', passo: 2, passoPasso: true });
    // in pausa tra un passo e l'altro gli automatismi girano (log reale del 2026-11-18)
    expect(ex.busy).toBe(true);
    expect(ex.blocking).toBe(false);
    ex.next();
    expect(ex.blocking).toBe(true);
    await tick();
    ex.event('line', 'no'); // fallisce: il ritentativo fa parte dello stesso passo
    await prompt();
    expect(sent).toEqual(['n', 'e', 'e']);
    await prompt();
    expect(ex.state).toMatchObject({ stato: 'pausa', passo: 3 });
    ex.setStepMode(false); // "Tutto": i passi rimasti di fila
    await tick();
    expect(sent).toEqual(['n', 'e', 'e', 's']);
    await prompt();
    expect(done).toBe(true);
  });
});
