import { workerSource } from './bootstrap';

/**
 * Script utente (Fase 5): codice JavaScript dell'utente, ognuno nel suo Web Worker, con l'API
 * `nebbie` (docs/SCRIPT.md). Salvati in script.json; quelli attivi partono collegandosi.
 */
export interface UserScript {
  id: string;
  nome: string;
  codice: string;
  /** Parte da solo (collegandosi o salvando). */
  attivo: boolean;
}

export interface ScriptsFile {
  versione: 1;
  script: UserScript[];
}

export const emptyScripts = (): ScriptsFile => ({ versione: 1, script: [] });

export function newScriptId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Lettura tollerante di script.json. */
export function parseScripts(json: string | null): ScriptsFile {
  if (!json) return emptyScripts();
  const d = JSON.parse(json) as Partial<ScriptsFile>;
  const script: UserScript[] = [];
  for (const s of Array.isArray(d.script) ? d.script : []) {
    if (!s || typeof s.codice !== 'string') continue;
    script.push({
      id: typeof s.id === 'string' && s.id ? s.id : newScriptId(),
      nome: typeof s.nome === 'string' && s.nome.trim() ? s.nome.trim() : 'Script',
      codice: s.codice,
      attivo: s.attivo === true,
    });
  }
  return { versione: 1, script };
}

/** Il minimo di un Worker che serve all'host (nei test se ne usa uno finto). */
export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

export interface ScriptHostDeps {
  createWorker(source: string): WorkerLike;
  /** Comandi mandati da uno script (l'host li scrive nell'output col nome dello script). */
  send(script: string, raw: string): void;
  echo(script: string, text: string): void;
  /** Stato attuale (lo stesso dei prompt): allo script appena parte e con ogni comando tuo. */
  state?(): Record<string, unknown>;
  error(script: string, text: string): void;
  now(): number;
}

/** Oltre tanti comandi in così poco tempo lo script viene fermato (evita di inondare il MUD). */
export const MAX_COMMANDS = 40;
export const WINDOW_MS = 10_000;

interface Running {
  script: UserScript;
  worker: WorkerLike;
  /** Ora dei comandi recenti (limite). */
  sent: number[];
  commands: string[];
}

export class ScriptHost {
  private running = new Map<string, Running>();
  onChange?: () => void;

  constructor(private readonly deps: ScriptHostDeps) {}

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  get runningIds(): string[] {
    return [...this.running.keys()];
  }

  /** Nomi degli script accesi (anche quelli provati e non salvati). */
  get runningScripts(): UserScript[] {
    return [...this.running.values()].map((r) => r.script);
  }

  start(script: UserScript): void {
    this.stop(script.id, false);
    let worker: WorkerLike;
    try {
      worker = this.deps.createWorker(workerSource(script.codice));
    } catch (e) {
      this.deps.error(script.nome, `non parte: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const r: Running = { script, worker, sent: [], commands: [] };
    worker.onmessage = (ev) => this.message(r, ev.data as Record<string, unknown>);
    worker.onerror = (ev) => this.deps.error(script.nome, ev.message ?? 'errore');
    this.running.set(script.id, r);
    if (this.deps.state) worker.postMessage({ t: 'state', state: this.deps.state() });
    this.onChange?.();
  }

  stop(id: string, notify = true): void {
    const r = this.running.get(id);
    if (!r) return;
    r.worker.terminate();
    this.running.delete(id);
    if (notify) this.deps.echo(r.script.nome, 'fermato.');
    this.onChange?.();
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id, false);
  }

  /** Una riga completa del MUD. */
  line(text: string): void {
    this.broadcast({ t: 'line', text });
  }

  prompt(state: Record<string, unknown>): void {
    this.broadcast({ t: 'prompt', state });
  }

  event(name: string, data: unknown): void {
    this.broadcast({ t: 'event', name, data });
  }

  /** Un comando scritto dall'utente: se è di uno script lo gestisce lui (e non va al MUD). */
  command(word: string, args: string): boolean {
    const w = word.toLowerCase();
    let handled = false;
    for (const r of this.running.values()) {
      if (!r.commands.includes(w)) continue;
      r.worker.postMessage({ t: 'command', word: w, args, state: this.deps.state?.() });
      handled = true;
    }
    return handled;
  }

  private broadcast(m: unknown): void {
    for (const r of this.running.values()) r.worker.postMessage(m);
  }

  private message(r: Running, m: Record<string, unknown>): void {
    if (!this.running.has(r.script.id)) return;
    const nome = r.script.nome;
    if (m.t === 'send' && Array.isArray(m.cmds)) {
      const now = this.deps.now();
      r.sent = r.sent.filter((t) => now - t < WINDOW_MS);
      r.sent.push(...m.cmds.map(() => now));
      if (r.sent.length > MAX_COMMANDS) {
        this.deps.error(
          nome,
          `più di ${MAX_COMMANDS} comandi in ${WINDOW_MS / 1000} s: fermato per non inondare il MUD.`,
        );
        this.stop(r.script.id, false);
        return;
      }
      this.deps.send(nome, m.cmds.map(String).join(';'));
    } else if (m.t === 'echo') this.deps.echo(nome, String(m.text));
    else if (m.t === 'error') this.deps.error(nome, String(m.text));
    else if (m.t === 'commands' && Array.isArray(m.words)) {
      // Un comando appartiene a un solo script acceso: due che rispondono alla stessa parola
      // manderebbero i comandi due volte (successo davvero: tre copie dello stesso script).
      const words: string[] = [];
      for (const w of m.words.map(String)) {
        const owner = [...this.running.values()].find((o) => o !== r && o.commands.includes(w));
        if (owner)
          this.deps.error(
            nome,
            `il comando "${w}" è già dello script "${owner.script.nome}": ignorato.`,
          );
        else words.push(w);
      }
      r.commands = words;
    } else if (m.t === 'ready') this.deps.echo(nome, 'avviato.');
  }
}
