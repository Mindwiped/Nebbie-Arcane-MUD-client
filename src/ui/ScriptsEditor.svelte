<script lang="ts">
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { EditorView, basicSetup } from 'codemirror';
  import { onMount } from 'svelte';
  import { newScriptId, type ScriptsFile, type UserScript } from '../core/scripts/scripts';

  /**
   * Script utente (Fase 5): elenco a sinistra, editor JavaScript a destra. "Salva" tiene le
   * modifiche e riavvia gli script attivi; "Prova" avvia subito lo script aperto.
   * L'API `nebbie` è descritta in docs/SCRIPT.md e nel riquadro in basso.
   */
  let {
    file,
    running,
    tema,
    onsave,
    ontry,
    onstop,
    onclose,
  }: {
    file: ScriptsFile;
    /** Id degli script accesi. */
    running: string[];
    tema: string;
    onsave: (f: ScriptsFile) => void;
    ontry: (s: UserScript) => void;
    onstop: (id: string) => void;
    onclose: () => void;
  } = $props();

  const EXAMPLE = `// Esempio: rialzati e avvisa quando finisci a terra; comando "cura <nome>".
nebbie.on('aTerra', (e) => {
  nebbie.echo('a terra (' + e.causa + '): mi rialzo');
  nebbie.send('stand');
});

nebbie.command('cura', (chi) => {
  // senza nome: su di te (nebbie.state.nome è il tuo personaggio, dal prompt)
  nebbie.send("cast 'cure light' " + (chi || nebbie.state.nome));
});

nebbie.onPrompt((s) => {
  // s.hp, s.hpMax, s.mp, s.mv, s.oro, s.stanza, s.inCombattimento…
});
`;

  // svelte-ignore state_referenced_locally
  let scripts = $state<UserScript[]>(structuredClone($state.snapshot(file.script) as UserScript[]));
  // svelte-ignore state_referenced_locally
  let currentId = $state<string | undefined>(file.script[0]?.id);
  const current = $derived(scripts.find((s) => s.id === currentId));
  let host = $state<HTMLDivElement>();
  let view: EditorView | undefined;
  let showHelp = $state(false);

  function mountEditor(code: string) {
    view?.destroy();
    view = undefined;
    if (!host) return;
    view = new EditorView({
      doc: code,
      parent: host,
      extensions: [
        basicSetup,
        javascript(),
        ...(tema === 'chiaro' ? [] : [oneDark]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && current) current.codice = u.state.doc.toString();
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    });
  }

  function select(id: string) {
    currentId = id;
    mountEditor(scripts.find((s) => s.id === id)?.codice ?? '');
  }

  function add() {
    const s: UserScript = {
      id: newScriptId(),
      nome: 'Nuovo script',
      codice: EXAMPLE,
      attivo: false,
    };
    scripts = [...scripts, s];
    select(s.id);
  }

  function remove() {
    if (!current) return;
    onstop(current.id);
    scripts = scripts.filter((s) => s.id !== current.id);
    const next = scripts[0]?.id;
    if (next) select(next);
    else {
      currentId = undefined;
      view?.destroy();
      view = undefined;
    }
  }

  onMount(() => {
    if (current) mountEditor(current.codice);
    return () => view?.destroy();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="sc-title" tabindex="-1">
  <header>
    <h2 id="sc-title">Script</h2>
    <button onclick={() => (showHelp = !showHelp)} class:on={showHelp}>API</button>
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>
  <div class="main">
    <aside>
      {#each scripts as s (s.id)}
        <button class="item" class:active={s.id === currentId} onclick={() => select(s.id)}>
          <span class="dot" class:on={running.includes(s.id)}>●</span>
          {s.nome}
          {#if s.attivo}<small>parte da solo</small>{/if}
        </button>
      {/each}
      <button class="add" onclick={add}>+ Nuovo script</button>
    </aside>
    <section>
      {#if current}
        <div class="row">
          <input class="name" bind:value={current.nome} aria-label="Nome dello script" />
          <label class="inline"
            ><input type="checkbox" bind:checked={current.attivo} /> parte da solo</label
          >
          {#if running.includes(current.id)}
            <button onclick={() => onstop(current.id)}>Ferma</button>
          {/if}
          <button
            class="primary"
            onclick={() => ontry($state.snapshot(current) as UserScript)}
            title="Avvia adesso il codice dell'editor (anche senza salvare)">Prova</button
          >
          <button class="danger" onclick={remove}>Elimina</button>
        </div>
      {:else}
        <p class="empty">Nessuno script. "+ Nuovo script" ne crea uno con un esempio.</p>
      {/if}
      <div class="editor" bind:this={host} class:hidden={!current}></div>
      {#if showHelp}
        <div class="help">
          <code>nebbie.send(cmd, …)</code> manda al MUD (con ; alias e abbreviazioni) ·
          <code>nebbie.echo(testo)</code> scrive nell'output ·
          <code>nebbie.onLine(/regex/ o 'testo', (m, riga) =&gt; …)</code> ·
          <code>nebbie.onPrompt((stato) =&gt; …)</code> ·
          <code>nebbie.on(evento, (dati) =&gt; …)</code> con eventi
          <code>stanza</code>, <code>mobUcciso</code>, <code>combattimento</code>,
          <code>aTerra</code>, <code>incantesimoFinito</code>, <code>messaggio</code> ·
          <code>nebbie.command('parola', (argomenti) =&gt; …)</code> comando tuo ·
          <code>nebbie.state</code> · <code>nebbie.after(ms, fn)</code>,
          <code>nebbie.every(ms, fn)</code>, <code>nebbie.cancel(id)</code>. I comandi mandati si
          vedono nell'output col nome dello script; oltre 40 in 10 s lo script si ferma. Dettagli in
          docs/SCRIPT.md.
        </div>
      {/if}
    </section>
  </div>
  <footer>
    <small class="dim">Gli script girano isolati: niente file, niente rete, niente password.</small>
    <span class="spacer"></span>
    <button onclick={onclose}>Annulla</button>
    <button
      class="primary"
      onclick={() => onsave({ versione: 1, script: $state.snapshot(scripts) as UserScript[] })}
      >Salva</button
    >
  </footer>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 10002;
    inset: 0;
    background: #0009;
  }
  .dialog {
    position: fixed;
    z-index: 10003;
    inset: 40px;
    margin: 0 auto;
    max-width: 1000px;
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
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  footer {
    border-top: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }
  .close {
    border: 0;
    background: none;
    color: var(--text-dim);
  }
  button.on {
    border-color: var(--accent);
  }
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  aside {
    width: 200px;
    border-right: 1px solid var(--border);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }
  .item {
    text-align: left;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }
  .item.active {
    background: var(--sel-bg);
    border-color: var(--sel-border);
  }
  .item small {
    width: 100%;
    color: var(--text-dim);
    font-size: 11px;
  }
  .dot {
    color: var(--text-dim);
    font-size: 10px;
  }
  .dot.on {
    color: var(--c-green);
  }
  .add {
    border: 0;
    background: none;
    color: var(--accent);
    text-align: left;
  }
  section {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  label.inline {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .editor {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
  }
  .editor.hidden {
    display: none;
  }
  .help {
    max-height: 30%;
    overflow-y: auto;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-dim);
  }
  .help code {
    font-family: var(--font-mono);
    color: var(--text);
  }
  .empty {
    color: var(--text-dim);
  }
  .danger {
    color: var(--c-red);
  }
  .dim {
    color: var(--text-dim);
  }
  .spacer {
    flex: 1;
  }
</style>
