<script lang="ts">
  import { GLOBAL } from '../core/automation/model';
  import {
    newButton,
    SHORTCUTS,
    validateButton,
    type ActionButton,
    type ButtonsFile,
  } from '../core/buttons/model';
  import type { Profile } from '../nebbie/profiles/profiles';
  import { keyLabel } from './platform';

  /** Editor della barra pulsanti. Lavora su una copia: niente cambia finché non si salva. */
  let {
    file,
    profiles,
    onsave,
    onclose,
  }: {
    file: ButtonsFile;
    profiles: Profile[];
    onsave: (file: ButtonsFile) => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let buttons = $state<ActionButton[]>(($state.snapshot(file) as ButtonsFile).pulsanti);
  // svelte-ignore state_referenced_locally
  let currentId = $state<string | undefined>(buttons[0]?.id);

  const current = $derived(buttons.find((b) => b.id === currentId));
  const errors = $derived(current ? validateButton(current, buttons) : []);
  const allValid = $derived(buttons.every((b) => validateButton(b, buttons).length === 0));

  function scopeLabel(ambito: string): string {
    if (ambito === GLOBAL) return 'tutti';
    return profiles.find((p) => p.id === ambito)?.nome ?? 'profilo eliminato';
  }

  function add() {
    const b = newButton();
    buttons.push(b);
    currentId = b.id;
  }

  function remove() {
    const i = buttons.findIndex((b) => b.id === currentId);
    buttons = buttons.filter((b) => b.id !== currentId);
    currentId = buttons[Math.max(0, i - 1)]?.id;
  }

  function move(dir: -1 | 1) {
    const i = buttons.findIndex((b) => b.id === currentId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= buttons.length) return;
    [buttons[i], buttons[j]] = [buttons[j], buttons[i]];
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Pulsanti">
  <header>
    <h2>Barra pulsanti</h2>
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>

  <div class="body">
    <nav>
      {#each buttons as b (b.id)}
        <button
          class:active={b.id === currentId}
          class:invalid={validateButton(b, buttons).length > 0}
          onclick={() => (currentId = b.id)}
        >
          <span>{b.etichetta || '(senza etichetta)'}</span>
          <small>{scopeLabel(b.ambito)}{b.tasto ? ` · ${b.tasto}` : ''}</small>
        </button>
      {/each}
      <button class="add" onclick={add}>+ Nuovo pulsante</button>
    </nav>

    <section>
      {#if current}
        <label>
          <span>Etichetta</span>
          <input bind:value={current.etichetta} maxlength="30" />
        </label>
        <label>
          <span
            >Comando (come nella riga di comando: alias, <code>;</code>, <code>#3 n</code>,
            abbreviazioni)</span
          >
          <input
            bind:value={current.comando}
            spellcheck="false"
            placeholder="get all.coin corp;get all.coin dust"
          />
        </label>
        <div class="row">
          <label>
            <span>Scorciatoia</span>
            <select bind:value={current.tasto}>
              <option value="">nessuna</option>
              {#each SHORTCUTS as s (s)}<option value={s}>{keyLabel(s)}</option>{/each}
            </select>
          </label>
          <label>
            <span>Vale per</span>
            <select bind:value={current.ambito}>
              <option value={GLOBAL}>tutti i personaggi</option>
              {#each profiles as p (p.id)}<option value={p.id}>{p.nome}</option>{/each}
            </select>
          </label>
          <label>
            <span>Colore</span>
            <div class="color">
              <input
                type="color"
                value={current.colore || '#2a3442'}
                oninput={(e) => current && (current.colore = e.currentTarget.value)}
              />
              {#if current.colore}
                <button type="button" class="link" onclick={() => current && (current.colore = '')}
                  >togli</button
                >
              {/if}
            </div>
          </label>
        </div>
        <div class="row">
          <button onclick={() => move(-1)} title="Sposta a sinistra">◀</button>
          <button onclick={() => move(1)} title="Sposta a destra">▶</button>
          <span class="grow"></span>
          <button class="danger" onclick={remove}>Elimina</button>
        </div>
        {#if errors.length}
          <ul class="errors">
            {#each errors as e (e)}<li>{e}</li>{/each}
          </ul>
        {/if}
      {:else}
        <p class="hint">
          Crea un pulsante: un clic (o la scorciatoia F1-F12, {keyLabel('Alt+1')}-{keyLabel(
            'Alt+0',
          )}) manda il suo comando, scritto nell'output con l'etichetta. I comandi dei pulsanti non
          entrano nella cronologia.
        </p>
      {/if}
    </section>
  </div>

  <footer>
    <span class="grow"></span>
    <button onclick={onclose}>Annulla</button>
    <button
      class="primary"
      disabled={!allValid}
      onclick={() => onsave({ versione: 1, pulsanti: $state.snapshot(buttons) as ActionButton[] })}
      >Salva</button
    >
  </footer>
</div>

<style>
  .backdrop {
    z-index: 10000;
    position: fixed;
    inset: 0;
    background: #0009;
  }
  .dialog {
    z-index: 10001;
    position: fixed;
    inset: 60px;
    max-width: 760px;
    max-height: 560px;
    margin: auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 20px 60px #000a;
    font-size: 13px;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  footer {
    border-top: 1px solid var(--border);
    border-bottom: 0;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }
  .close {
    border: 0;
    background: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 200px 1fr;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  nav > button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    border-color: transparent;
    background: none;
  }
  nav > button small {
    color: var(--text-dim);
    font-size: 11px;
  }
  nav > button.active {
    background: var(--sel-bg);
    border-color: var(--sel-border);
  }
  nav > button.invalid span::after {
    content: ' ⚠';
    color: var(--c-gold);
  }
  .add {
    margin-top: 6px;
    color: var(--accent);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    overflow-y: auto;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label > span {
    color: var(--text-dim);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  input:not([type='color']) {
    font-family: var(--font-mono);
  }
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  input[type='color'] {
    width: 40px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    background: none;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .errors {
    margin: 0;
    padding: 8px 12px 8px 28px;
    border-radius: 6px;
    background: var(--err-bg);
    color: var(--err-text);
    font-size: 12px;
  }
  .danger {
    color: var(--c-red);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 11px;
  }
</style>
