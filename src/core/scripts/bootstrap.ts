/**
 * Codice che gira nel Web Worker di ogni script utente (SPECIFICA Fase 5). Lo script vede solo
 * l'oggetto `nebbie`: niente finestra, niente file, niente portachiavi; la rete è chiusa dalla
 * CSP dell'app. Tutto quello che lo script manda al MUD passa dal client, che lo scrive
 * nell'output col nome dello script (niente di nascosto) e ne limita la quantità.
 *
 * Messaggi client → worker: `line`, `prompt`, `event`, `command`.
 * Messaggi worker → client: `send`, `echo`, `error`, `commands`, `ready`.
 */
export const BOOTSTRAP = String.raw`
'use strict';
const __post = (m) => self.postMessage(m);
const __lines = [];
const __prompts = [];
const __events = {};
const __commands = {};
let __state = {};
const __fail = (where, e) =>
  __post({ t: 'error', text: where + ': ' + (e && e.stack ? String(e.stack).split('\n')[0] : String(e)) });
const __call = (where, fn, ...args) => {
  try {
    fn(...args);
  } catch (e) {
    __fail(where, e);
  }
};
const nebbie = Object.freeze({
  /** Manda uno o più comandi al MUD (come scritti nella riga di comando: ; alias, abbreviazioni). */
  send(...cmds) {
    const list = cmds.flat().map((c) => String(c)).filter((c) => c.trim() !== '');
    if (list.length) __post({ t: 'send', cmds: list });
  },
  /** Scrive una riga nell'output del client (non va al MUD). */
  echo(text) {
    __post({ t: 'echo', text: String(text) });
  },
  /** Su ogni riga del MUD: pattern = RegExp o testo da cercare. fn(match, riga). */
  onLine(pattern, fn) {
    if (typeof fn !== 'function') throw new TypeError('onLine: serve una funzione');
    __lines.push({ pattern, fn });
  },
  /** A ogni prompt. fn(stato). */
  onPrompt(fn) {
    if (typeof fn !== 'function') throw new TypeError('onPrompt: serve una funzione');
    __prompts.push(fn);
  },
  /** Eventi del client: stanza, mobUcciso, combattimento, aTerra, incantesimoFinito, messaggio. */
  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('on: serve una funzione');
    (__events[name] = __events[name] || []).push(fn);
  },
  /** Comando tuo nella riga di comando: "parola argomenti" non va al MUD, chiama fn(argomenti). */
  command(word, fn) {
    const w = String(word).trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(w)) throw new TypeError('command: una parola senza spazi');
    if (typeof fn !== 'function') throw new TypeError('command: serve una funzione');
    __commands[w] = fn;
    __post({ t: 'commands', words: Object.keys(__commands) });
  },
  /** Stato dall'ultimo prompt: nome, hp, hpMax, mp, mpMax, mv, mvMax, oro, stanza, tank… */
  get state() {
    return __state;
  },
  /** Attese e ripetizioni (millisecondi). */
  after: (ms, fn) => setTimeout(() => __call('after', fn), ms),
  every: (ms, fn) => setInterval(() => __call('every', fn), Math.max(250, ms)),
  cancel: (id) => (clearTimeout(id), clearInterval(id)),
});
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.t === 'line') {
    for (const h of __lines) {
      let match = null;
      if (h.pattern instanceof RegExp) {
        h.pattern.lastIndex = 0;
        match = h.pattern.exec(m.text);
      } else if (m.text.includes(String(h.pattern))) match = [m.text];
      if (match) __call('onLine', h.fn, match, m.text);
    }
  } else if (m.t === 'prompt') {
    __state = Object.freeze(m.state);
    for (const fn of __prompts) __call('onPrompt', fn, __state);
  } else if (m.t === 'state') {
    // stato attuale senza un prompt (all'avvio e prima di un comando tuo)
    __state = Object.freeze(m.state);
  } else if (m.t === 'event') {
    for (const fn of __events[m.name] || []) __call('on ' + m.name, fn, m.data);
  } else if (m.t === 'command') {
    if (m.state) __state = Object.freeze(m.state);
    const fn = __commands[m.word];
    if (fn) __call(m.word, fn, m.args);
  }
};
self.onerror = (e) => {
  __fail('errore', e && e.message ? e.message : e);
  return true;
};
`;

/** Sorgente completo del worker: l'API e poi il codice dell'utente, in una sua funzione. */
export function workerSource(code: string): string {
  return (
    `${BOOTSTRAP}\ntry {\n(function (nebbie) {\n'use strict';\n${code}\n})(nebbie);\n` +
    `__post({ t: 'ready' });\n} catch (e) { __fail('avvio', e); }\n`
  );
}
