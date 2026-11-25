<script lang="ts">
  import {
    DEFAULT_TABLE,
    importAll,
    type AllRow,
    type SpellTable,
  } from '../nebbie/spells/abbreviations';

  /**
   * Abbreviazioni degli incantesimi (richiesta dell'utente del 2026-11-15): `mm` → `cast 'magic
   * missile'`, `doorw` → `doorway` (psionici, comando diretto). Si modificano, aggiungono,
   * tolgono, e si importano dall'elenco `ALL` del MUD. "Salva" le tiene, "Annulla" no.
   */
  let {
    table,
    allRows,
    onsave,
    onclose,
  }: {
    table: SpellTable;
    /** Righe dell'ultimo elenco ALL visto nell'output. */
    allRows: AllRow[];
    onsave: (t: SpellTable) => void;
    onclose: () => void;
  } = $props();

  interface Row {
    id: number;
    abbr: string;
    nome: string;
    diretto: boolean;
  }
  let nextId = 1;
  const toRows = (t: SpellTable): Row[] =>
    Object.entries(t)
      .map(([abbr, v]) => ({ id: nextId++, abbr, nome: v.nome, diretto: v.diretto === true }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(toRows(table));
  let query = $state('');
  let message = $state('');

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.abbr.includes(q) || r.nome.includes(q)) : rows;
  });

  /** Problemi che impediscono il salvataggio: abbreviazioni vuote, con spazi o doppie. */
  const problems = $derived.by(() => {
    // mappe temporanee, ricalcolate a ogni cambio: non serve che siano reattive
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const out = new Map<number, string>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Map<string, number>();
    for (const r of rows) {
      const a = r.abbr.trim().toLowerCase();
      if (!a) out.set(r.id, 'abbreviazione vuota');
      else if (/\s/.test(a)) out.set(r.id, 'niente spazi');
      else if (!r.nome.trim()) out.set(r.id, 'incantesimo vuoto');
      else if (seen.has(a)) {
        out.set(r.id, `"${a}" c'è già`);
        out.set(seen.get(a)!, `"${a}" c'è già`);
      } else seen.set(a, r.id);
    }
    return out;
  });

  function toTable(): SpellTable {
    const t: SpellTable = {};
    for (const r of rows)
      t[r.abbr.trim().toLowerCase()] = {
        nome: r.nome.trim().toLowerCase(),
        ...(r.diretto ? { diretto: true } : {}),
      };
    return t;
  }

  function add() {
    query = '';
    rows = [{ id: nextId++, abbr: '', nome: '', diretto: false }, ...rows];
  }

  function remove(id: number) {
    rows = rows.filter((r) => r.id !== id);
  }

  function importList() {
    if (problems.size) return (message = 'Sistema prima le righe segnate in rosso.');
    const { table: t, aggiunte } = importAll(toTable(), allRows);
    rows = toRows(t);
    message = aggiunte.length
      ? `${aggiunte.length} abbreviazioni nuove: ${aggiunte.map(([a, v]) => `${a} = ${v.nome}`).join(', ')}`
      : "Nessun incantesimo nuovo nell'elenco ALL.";
  }

  function restore() {
    rows = toRows({ ...DEFAULT_TABLE });
    message = 'Tabella predefinita ripristinata (non ancora salvata).';
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="sp-title"
  tabindex="-1"
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <header>
    <h2 id="sp-title">Abbreviazioni incantesimi</h2>
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>
  <div class="tools">
    <input type="search" placeholder="cerca abbreviazione o incantesimo" bind:value={query} />
    <button onclick={add}>+ Nuova</button>
    <button
      onclick={importList}
      disabled={!allRows.length}
      title={allRows.length
        ? "Aggiunge gli incantesimi dell'elenco ALL che non hanno ancora un'abbreviazione"
        : 'Scrivi ALL nel gioco e scorri tutte le pagine'}>Importa da ALL ({allRows.length})</button
    >
  </div>
  <p class="hint">
    Scrivi l'abbreviazione nella riga di comando, con o senza bersaglio: <code>mm orco</code> →
    <code>cast 'magic missile' orco</code>. "Diretto" = comando senza <code>cast</code> (poteri
    psionici: <code>doorw niobe</code> → <code>doorway niobe</code>). Valgono per i personaggi con
    le abbreviazioni attive (Profili…).
  </p>
  {#if message}<p class="msg">{message}</p>{/if}
  <div class="list">
    <table>
      <thead><tr><th>Abbreviazione</th><th>Incantesimo</th><th>Diretto</th><th></th></tr></thead>
      <tbody>
        {#each shown as r (r.id)}
          <tr class:bad={problems.has(r.id)} title={problems.get(r.id) ?? ''}>
            <td><input class="abbr" bind:value={r.abbr} spellcheck="false" /></td>
            <td><input bind:value={r.nome} spellcheck="false" /></td>
            <td class="c"><input type="checkbox" bind:checked={r.diretto} /></td>
            <td class="c"
              ><button class="x" onclick={() => remove(r.id)} title="Elimina">✕</button></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <footer>
    <button onclick={restore}>Predefinite</button>
    <small class="count">{rows.length} abbreviazioni</small>
    <span class="spacer"></span>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" disabled={problems.size > 0} onclick={() => onsave(toTable())}
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
    inset: 50px;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 20px 60px #000a;
    font-size: 13px;
  }
  header,
  footer,
  .tools {
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
  .tools input {
    flex: 1;
    min-width: 0;
  }
  .hint,
  .msg {
    margin: 0 16px 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .msg {
    color: var(--c-green);
    max-height: 4.5em;
    overflow-y: auto;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--bg-panel);
    text-align: left;
    font-weight: normal;
    font-size: 11px;
    color: var(--text-dim);
    padding: 4px;
  }
  td {
    padding: 2px 4px;
    border-top: 1px solid var(--border);
  }
  td input:not([type='checkbox']) {
    width: 100%;
    padding: 3px 6px;
    font-family: var(--font-mono);
  }
  .abbr {
    max-width: 120px;
  }
  .c {
    text-align: center;
    width: 60px;
  }
  tr.bad td {
    background: var(--err-bg);
  }
  .x {
    border: 0;
    background: none;
    color: var(--text-dim);
    padding: 2px 6px;
  }
  .count {
    color: var(--text-dim);
  }
  .spacer {
    flex: 1;
  }
  code {
    font-family: var(--font-mono);
  }
</style>
