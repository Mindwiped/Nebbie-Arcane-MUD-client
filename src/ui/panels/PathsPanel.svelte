<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import {
    BUILTIN_PATHS,
    compactPath,
    expandPath,
    filterPaths,
    groupByZone,
    invertPath,
    newPathId,
    pathSize,
    type PathEntry,
  } from '../../nebbie/paths/paths';

  /**
   * Pannello Percorsi (SPECIFICA 5.2): preferiti, usati di recente, zone richiudibili e
   * ricerca; dettaglio con Vai, Prova, Inverti, Modifica, Duplica, Elimina; registratore.
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  let query = $state('');
  let open = $state<Record<string, boolean>>({});
  let selectedId = $state<string | undefined>();
  /** Percorso in modifica (nuovo, copia, inverso o esistente) e avvisi da mostrare. */
  let draft = $state<PathEntry | undefined>();
  let draftDubbi = $state<string[]>([]);
  let recName = $state('');
  let recZone = $state('');
  let recNote = $state('');

  // `session.allPaths` e `pathsData` cambiano con pathsVersion.
  const data = $derived.by(() => {
    void sessionState.pathsVersion;
    const all = session.allPaths;
    const file = session.pathsData;
    const byId = new Map(all.map((p) => [p.id, p]));
    return {
      all,
      favs: file.preferiti.map((id) => byId.get(id)).filter((p) => p !== undefined),
      recent: Object.entries(file.usati)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(id))
        .filter((p) => p !== undefined)
        .slice(0, 5),
      hidden: file.nascosti.filter((id) => BUILTIN_PATHS.some((p) => p.id === id)).length,
      favSet: new Set(file.preferiti),
    };
  });
  const zones = $derived(groupByZone(filterPaths(data.all, query)));
  const total = $derived(zones.reduce((n, z) => n + z.voci.length, 0));
  const selected = $derived(data.all.find((p) => p.id === selectedId));
  const busy = $derived(
    sessionState.sequence !== undefined && sessionState.sequence.stato !== 'fermo',
  );
  const rec = $derived(sessionState.recording);

  function isOpen(zona: string): boolean {
    return query.trim() !== '' || open[zona] === true;
  }

  function go(p: PathEntry, passoPasso = false) {
    selectedId = p.id;
    void session.runPath(p, { passoPasso });
  }

  function edit(p: PathEntry) {
    draft = { ...p };
    draftDubbi = [];
  }

  function duplicate(p: PathEntry) {
    const copy: PathEntry = { ...p, id: newPathId(), nome: `${p.nome} (copia)`, origine: 'utente' };
    delete copy.sostituisce;
    draft = copy;
    draftDubbi = [];
  }

  function invert(p: PathEntry) {
    const inv = invertPath(expandPath(p.path));
    draft = {
      id: newPathId(),
      zona: p.zona,
      nome: `${p.nome} (ritorno)`,
      nota: p.nota,
      path: compactPath(inv.passi),
      origine: 'utente',
      ...(p.arrivo ? { partenza: p.arrivo } : {}),
      ...(p.partenza ? { arrivo: p.partenza } : {}),
    };
    draftDubbi = inv.dubbi;
  }

  function newPath() {
    draft = { id: newPathId(), zona: '', nome: '', nota: '', path: '', origine: 'utente' };
    draftDubbi = [];
  }

  function saveDraft() {
    if (!draft || !draft.nome.trim() || !draft.path.trim()) return;
    const clean: PathEntry = {
      ...draft,
      nome: draft.nome.trim(),
      zona: draft.zona.trim() || 'Registrati',
      path: compactPath(expandPath(draft.path)),
    };
    for (const k of ['info', 'troppo', 'partenza', 'arrivo'] as const) {
      const v = clean[k]?.trim();
      if (v) clean[k] = v;
      else delete clean[k];
    }
    if (!clean.apriPorte) delete clean.apriPorte;
    const saved = session.savePath(clean);
    selectedId = saved.id;
    draft = undefined;
  }

  function remove(p: PathEntry) {
    const what = p.origine === 'pacchetto' ? 'Nascondere' : 'Eliminare';
    if (!confirm(`${what} il percorso "${p.nome}"?`)) return;
    session.deletePath(p);
    selectedId = undefined;
  }

  function saveRecording() {
    const saved = session.recFinish({ nome: recName, zona: recZone, nota: recNote });
    if (saved) {
      selectedId = saved.id;
      recName = recZone = recNote = '';
    }
  }

  const ORIGINE: Record<PathEntry['origine'], string> = {
    pacchetto: 'dal pacchetto Mudlet',
    registrato: 'registrato',
    utente: 'scritto a mano',
    mud: "dai file d'area del MUD",
  };
</script>

{#snippet entry(p: PathEntry)}
  <li>
    <button
      class="entry"
      class:selected={selectedId === p.id}
      title={[p.path, p.info, p.troppo].filter(Boolean).join('\n')}
      onclick={() => (selectedId = p.id)}
      ondblclick={() => go(p)}
    >
      <span class="name"
        >{data.favSet.has(p.id) ? '★ ' : ''}{p.nome}{p.origine === 'pacchetto'
          ? ''
          : p.origine === 'mud'
            ? ' ◆'
            : ' ●'}</span
      >
      {#if p.nota}<span class="note">{p.nota}</span>{/if}
    </button>
  </li>
{/snippet}

<div class="panel">
  <div class="top">
    <div class="search">
      <input bind:value={query} placeholder="Cerca percorso, zona, nota…" spellcheck="false" />
      <button title="Scrivi un percorso a mano" onclick={newPath}>＋</button>
      {#if !rec}
        <button
          class="rec-btn"
          title="Registra un percorso camminando"
          onclick={() => session.recStart()}>● Registra</button
        >
      {/if}
    </div>

    {#if rec}
      <div class="rec">
        <div class="rec-head">
          <span class="dot" class:paused={rec.pausa}>●</span>
          {rec.pausa ? 'In pausa' : 'Registrazione'} · {rec.passi.length} passi
          {#if rec.partenza}<small>da {rec.partenza}</small>{/if}
        </div>
        <code class="steps">{compactPath(rec.passi) || 'cammina: i passi compaiono qui'}</code>
        {#each rec.avvisi as a (a)}<p class="warn">{a}</p>{/each}
        <div class="row">
          <button onclick={() => session.recUndo()} disabled={rec.passi.length === 0}
            >Togli ultimo</button
          >
          <button onclick={() => session.recPause(!rec.pausa)}
            >{rec.pausa ? 'Riprendi' : 'Pausa'}</button
          >
          <button onclick={() => confirm('Scartare la registrazione?') && session.recDiscard()}
            >Scarta</button
          >
        </div>
        <div class="form">
          <input bind:value={recName} placeholder="Nome (obbligatorio)" />
          <input bind:value={recZone} placeholder="Zona (vuoto = Registrati)" />
          <input bind:value={recNote} placeholder="Nota" />
          <button
            class="primary"
            disabled={!recName.trim() || rec.passi.length === 0}
            onclick={saveRecording}>Salva percorso</button
          >
        </div>
      </div>
    {/if}
  </div>

  {#if draft}
    <div class="editor">
      <h4>{draft.origine === 'pacchetto' ? 'Modifica (diventa una tua copia)' : 'Percorso'}</h4>
      {#each draftDubbi as d (d)}<p class="warn">⚠ {d}</p>{/each}
      <label>Nome <input bind:value={draft.nome} /></label>
      <label>Zona <input bind:value={draft.zona} placeholder="Registrati" /></label>
      <label>Nota <input bind:value={draft.nota} /></label>
      <label
        >Passi <textarea
          bind:value={draft.path}
          rows="3"
          spellcheck="false"
          placeholder="3n,open frasca,2w,run e"></textarea></label
      >
      <label>Parte da <input bind:value={draft.partenza} placeholder="titolo della stanza" /></label
      >
      <label>Arriva in <input bind:value={draft.arrivo} placeholder="titolo della stanza" /></label>
      <label>Note lunghe <textarea bind:value={draft.info} rows="2"></textarea></label>
      <label>Avvertenze <input bind:value={draft.troppo} placeholder="es. zona aggressiva" /></label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={draft.apriPorte} /> Apri le porte chiuse da solo (un tentativo)</label
      >
      <div class="row">
        <button
          class="primary"
          disabled={!draft.nome.trim() || !draft.path.trim()}
          onclick={saveDraft}>Salva</button
        >
        <button onclick={() => (draft = undefined)}>Annulla</button>
      </div>
    </div>
  {:else}
    <div class="list">
      {#if !query.trim() && data.favs.length}
        <div class="section">Preferiti</div>
        <ul>
          {#each data.favs as p (p.id)}{@render entry(p)}{/each}
        </ul>
      {/if}
      {#if !query.trim() && data.recent.length}
        <div class="section">Usati di recente</div>
        <ul>
          {#each data.recent as p (p.id)}{@render entry(p)}{/each}
        </ul>
      {/if}
      {#each zones as z (z.zona)}
        <div class="zone">
          <button class="zone-title" onclick={() => (open[z.zona] = !isOpen(z.zona))}>
            <span class="arrow">{isOpen(z.zona) ? '▾' : '▸'}</span>
            {z.zona} <small>{z.voci.length}</small>
          </button>
          {#if isOpen(z.zona)}
            <ul>
              {#each z.voci as p (p.id)}{@render entry(p)}{/each}
            </ul>
          {/if}
        </div>
      {:else}
        <p class="empty">Nessun percorso trovato.</p>
      {/each}
      {#if data.hidden > 0}
        <button class="link" onclick={() => session.restoreHiddenPaths()}
          >Mostra i {data.hidden} percorsi del pacchetto nascosti</button
        >
      {/if}
    </div>

    <div class="detail">
      {#if selected}
        {@const size = pathSize(selected.path)}
        <div class="title">
          <b>{selected.nome}</b>
          <button class="star" title="Preferito" onclick={() => session.toggleFavorite(selected)}
            >{data.favSet.has(selected.id) ? '★' : '☆'}</button
          >
        </div>
        <small
          >{selected.zona} · {ORIGINE[selected.origine]}{selected.sostituisce
            ? ' (copia modificata)'
            : ''} · {size.movimenti} movimenti, {size.comandi} comandi</small
        >
        {#if selected.nota}<p>{selected.nota}</p>{/if}
        {#if selected.partenza || selected.arrivo}
          <p class="dim">
            {selected.partenza ? `da ${selected.partenza}` : ''}
            {selected.arrivo ? `→ ${selected.arrivo}` : ''}
          </p>
        {/if}
        {#if selected.troppo}<p class="warn">⚠ {selected.troppo}</p>{/if}
        {#if selected.info}<p class="info">{selected.info}</p>{/if}
        <code class="steps">{selected.path}</code>
        <div class="row">
          <button class="primary" disabled={busy} onclick={() => go(selected)}>Vai</button>
          <button
            disabled={busy}
            title="Un passo alla volta: Invio sulla riga vuota per il passo successivo"
            onclick={() => go(selected, true)}>A passi</button
          >
          <button onclick={() => session.previewPath(selected)}>Prova</button>
          <button onclick={() => invert(selected)}>Inverti</button>
          <button onclick={() => edit(selected)}>Modifica</button>
          <button onclick={() => duplicate(selected)}>Duplica</button>
          <button onclick={() => remove(selected)}
            >{selected.origine === 'pacchetto' ? 'Nascondi' : 'Elimina'}</button
          >
        </div>
      {:else}
        <small>{total} percorsi · doppio clic per partire · ● tuoi · ★ preferiti</small>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .search {
    display: flex;
    gap: 6px;
  }
  .search input {
    flex: 1;
    min-width: 0;
  }
  .rec-btn,
  .rec .dot {
    color: var(--c-red);
  }
  .rec .dot.paused {
    color: var(--text-dim);
  }
  .rec {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--danger-border);
    border-radius: 4px;
  }
  .rec-head small {
    color: var(--text-dim);
    margin-left: 6px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .steps {
    display: block;
    padding: 4px 6px;
    background: var(--bg-sunken);
    border-radius: 3px;
    font-size: 12px;
    word-break: break-word;
    max-height: 6em;
    overflow-y: auto;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .warn {
    margin: 0;
    color: var(--c-gold);
    font-size: 12px;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 6px;
  }
  .section {
    padding: 4px 4px 2px;
    color: var(--c-gold);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .zone-title {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    border: 0;
    background: none;
    color: var(--c-blue);
    text-align: left;
    font-weight: 500;
  }
  .zone-title small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .arrow {
    width: 10px;
    color: var(--text-dim);
  }
  ul {
    margin: 0 0 4px 16px;
    padding: 0;
    list-style: none;
  }
  .entry {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 2px 6px;
    border-color: transparent;
    background: none;
    text-align: left;
  }
  .entry.selected {
    background: var(--on-bg);
    border-color: var(--on-border);
  }
  .note {
    color: var(--text-dim);
    font-size: 11px;
  }
  .link {
    margin: 6px 4px;
    border: 0;
    background: none;
    color: var(--text-dim);
    text-decoration: underline;
    font-size: 11px;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    max-height: 45%;
    overflow-y: auto;
  }
  .detail p {
    margin: 0;
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .star {
    border: 0;
    background: none;
    color: var(--c-gold);
    font-size: 16px;
    padding: 0 4px;
  }
  .dim,
  small,
  .empty {
    color: var(--text-dim);
    font-size: 11px;
  }
  .info {
    white-space: pre-wrap;
    font-size: 12px;
  }
  .editor {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
  }
  .editor h4 {
    margin: 0;
  }
  .editor label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .editor label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .editor input,
  .editor textarea {
    font-size: 13px;
  }
  textarea {
    font-family: var(--font-mono);
    resize: vertical;
  }
</style>
