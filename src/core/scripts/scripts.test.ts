import { describe, expect, it } from 'vitest';
import {
  MAX_COMMANDS,
  ScriptHost,
  parseScripts,
  type UserScript,
  type WorkerLike,
} from './scripts';

/**
 * Worker finto: esegue davvero il sorgente del worker (API `nebbie` + codice dell'utente) in
 * questo processo, con i messaggi asincroni come in un Worker vero.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  dead = false;
  private inner: { onmessage?: (ev: { data: unknown }) => void; postMessage: (m: unknown) => void };

  constructor(source: string) {
    this.inner = {
      postMessage: (m) =>
        queueMicrotask(() => {
          if (!this.dead) this.onmessage?.({ data: m });
        }),
    };
    new Function('self', source)(this.inner);
  }

  postMessage(m: unknown): void {
    queueMicrotask(() => {
      if (!this.dead) this.inner.onmessage?.({ data: m });
    });
  }

  terminate(): void {
    this.dead = true;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const sent: string[] = [];
  const out: string[] = [];
  let now = 0;
  const host = new ScriptHost({
    createWorker: (src) => new FakeWorker(src),
    send: (nome, raw) => sent.push(`${nome}: ${raw}`),
    echo: (nome, t) => out.push(`${nome}: ${t}`),
    error: (nome, t) => out.push(`ERRORE ${nome}: ${t}`),
    now: () => now,
    state: () => ({ nome: 'Rigel', hp: 500 }),
  });
  const script = (codice: string, nome = 'prova'): UserScript => ({
    id: nome,
    nome,
    codice,
    attivo: true,
  });
  return { host, sent, out, script, advance: (ms: number) => (now += ms) };
}

describe('script utente', () => {
  it('onLine con RegExp e testo, send ed echo; ready all avvio', async () => {
    const { host, sent, out, script } = setup();
    host.start(
      script(`
        nebbie.onLine(/^(.+) ti dice '(.*)'/, (m) => nebbie.echo('da ' + m[1]));
        nebbie.onLine('ti manda a gambe', () => nebbie.send('stand'));
      `),
    );
    await flush();
    expect(out).toEqual(['prova: avviato.']);
    host.line("[Leoven] ti dice 'ciao'");
    host.line("Il troll ti manda a gambe all'aria.");
    await flush();
    expect(out).toContain('prova: da [Leoven]');
    expect(sent).toEqual(['prova: stand']);
  });

  it('onPrompt riceve lo stato; on per gli eventi; command per i comandi tuoi', async () => {
    const { host, sent, out, script } = setup();
    host.start(
      script(`
        nebbie.onPrompt((s) => { if (s.hp < s.hpMax / 3) nebbie.send('quaff rossa'); });
        nebbie.on('mobUcciso', (e) => nebbie.send('get all corpse'));
        nebbie.command('cura', (args) => nebbie.send('cast \\'cure light\\' ' + (args || 'me')));
      `),
    );
    await flush();
    host.prompt({ hp: 100, hpMax: 500 });
    host.event('mobUcciso', { nome: 'il goblin' });
    expect(host.command('cura', 'montero')).toBe(true);
    expect(host.command('look', '')).toBe(false);
    await flush();
    expect(sent).toEqual([
      'prova: quaff rossa',
      'prova: get all corpse',
      "prova: cast 'cure light' montero",
    ]);
    expect(out.filter((o) => o.startsWith('ERRORE'))).toEqual([]);
  });

  it('gli errori dello script si vedono e non lo fermano; errore di sintassi all avvio', async () => {
    const { host, out, script } = setup();
    host.start(script(`nebbie.onLine('x', () => { throw new Error('boom'); });`));
    await flush();
    host.line('x');
    await flush();
    expect(out.some((o) => o.includes('ERRORE prova: onLine: Error: boom'))).toBe(true);
    expect(host.isRunning('prova')).toBe(true);
    host.start(script(`nebbie.echo(nonEsiste);`, 'rotto'));
    await flush();
    expect(out.some((o) => o.startsWith('ERRORE rotto: avvio'))).toBe(true);
  });

  it('troppi comandi: lo script viene fermato', async () => {
    const { host, sent, out, script } = setup();
    host.start(
      script(`nebbie.onLine('via', () => { for (let i = 0; i < 50; i++) nebbie.send('n'); });`),
    );
    await flush();
    host.line('via');
    await flush();
    expect(sent.length).toBe(MAX_COMMANDS);
    expect(host.isRunning('prova')).toBe(false);
    expect(out.some((o) => o.includes('fermato per non inondare il MUD'))).toBe(true);
  });

  it('nello script non ci sono finestra, documento né Tauri', async () => {
    const { host, out, script } = setup();
    host.start(
      script(
        `nebbie.echo([typeof window, typeof document, typeof __TAURI_INTERNALS__].join(','));`,
      ),
    );
    await flush();
    expect(out).toContain('prova: undefined,undefined,undefined');
  });

  it('lettura tollerante di script.json', () => {
    const f = parseScripts(
      JSON.stringify({ script: [{ nome: ' A ', codice: 'x', attivo: true }, { nome: 'B' }, null] }),
    );
    expect(f.script).toHaveLength(1);
    expect(f.script[0]).toMatchObject({ nome: 'A', codice: 'x', attivo: true });
    expect(parseScripts(null).script).toEqual([]);
  });

  it('due script accesi non possono avere lo stesso comando (tre copie = tre cast)', async () => {
    const { host, sent, out, script } = setup();
    const code = "nebbie.command('cura', () => nebbie.send('cast'));";
    host.start(script(code, 'a'));
    await flush();
    host.start(script(code, 'b'));
    await flush();
    host.command('cura', '');
    await flush();
    expect(sent).toEqual(['a: cast']);
    expect(out.some((o) => o.includes('il comando "cura" è già dello script "a"'))).toBe(true);
  });

  it('lo stato c è già all avvio e con ogni comando, anche senza prompt (bug: undefined)', async () => {
    const { host, sent, script } = setup();
    host.start(
      script(
        `nebbie.command('cura', (chi) => nebbie.send('cast x ' + (chi || nebbie.state.nome)));`,
      ),
    );
    await flush();
    host.command('cura', '');
    await flush();
    expect(sent).toEqual(['prova: cast x Rigel']);
  });
});
