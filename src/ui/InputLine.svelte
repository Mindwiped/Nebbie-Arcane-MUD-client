<script lang="ts">
  import type { Session, SessionState } from '../core/session';

  /**
   * Riga di comando. Invio manda e lascia il testo selezionato (si riscrive sopra o si
   * ripete con Invio); frecce su/giù scorrono i comandi precedenti, e se si è scritto
   * qualcosa di nuovo mostrano solo quelli che iniziano così; Tab completa con le parole
   * viste nell'output; Esc svuota. PagSu/PagGiù scorrono l'output.
   */
  let {
    session,
    sessionState,
    onpage,
  }: { session: Session; sessionState: SessionState; onpage?: (dir: 1 | -1) => void } = $props();

  let value = $state('');
  let input: HTMLInputElement;
  /** Il giocatore ha scritto qualcosa dopo l'ultimo invio: vale come prefisso di ricerca. */
  let typed = false;

  export function focus() {
    input?.focus();
  }

  async function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        // Percorso un passo alla volta in attesa: Invio sulla riga vuota fa il passo successivo.
        const seq = sessionState.sequence;
        if (value === '' && seq?.passoPasso && seq.stato !== 'corre') {
          session.nextStep();
          break;
        }
        const text = value;
        const wasPassword = sessionState.password;
        typed = false;
        await session.sendInput(text);
        if (wasPassword) value = '';
        else input.select();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (sessionState.password) break;
        const prev = session.history.prev(value, typed ? value : '');
        if (prev !== undefined) setValue(prev);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        if (sessionState.password) break;
        const next = session.history.next();
        if (next !== undefined) setValue(next);
        break;
      }
      case 'Tab': {
        e.preventDefault();
        if (sessionState.password) break;
        const done = session.completer.complete(value);
        if (done !== null) setValue(done);
        break;
      }
      case 'Escape':
        // Sulla riga vuota Esc è "Ferma tutto"; altrimenti cancella quello che hai scritto.
        if (value === '' && (sessionState.sequence?.stato === 'corre' || sessionState.recording))
          session.stopAll();
        value = '';
        typed = false;
        session.history.reset();
        break;
      case 'PageUp':
      case 'PageDown':
        e.preventDefault();
        onpage?.(e.key === 'PageUp' ? -1 : 1);
        break;
    }
  }

  function setValue(v: string) {
    value = v;
    requestAnimationFrame(() => input.setSelectionRange(v.length, v.length));
  }

  function onInput() {
    typed = value !== '';
    session.history.reset();
    session.completer.reset();
  }
</script>

<div class="input-line" class:password={sessionState.password}>
  <span class="label">{sessionState.password ? 'Password' : '>'}</span>
  <input
    bind:this={input}
    bind:value
    type={sessionState.password ? 'password' : 'text'}
    onkeydown={onKeydown}
    oninput={onInput}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    aria-label="Comando"
  />
</div>

<style>
  .input-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-panel);
  }
  .label {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .password .label {
    color: var(--c-gold);
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 4px 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px;
  }
  input::selection {
    background: var(--input-sel);
  }
</style>
