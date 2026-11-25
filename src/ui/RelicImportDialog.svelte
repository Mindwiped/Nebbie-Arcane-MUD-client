<script lang="ts">
  import { identifiesFromText } from '../nebbie/relics/reliquiario';
  import { MOD } from './platform';

  /**
   * Importa nel Reliquiario degli identify incollati (richiesta del 2026-11-17): per esempio un
   * documento con i copia-incolla degli oggetti presi dalle borse, tutti nello stesso contenitore.
   */
  let {
    contenitori,
    onimport,
    onclose,
  }: {
    contenitori: string[];
    /** `contenitore` vuoto = nessuno. */
    onimport: (testo: string, contenitore: string) => void;
    onclose: () => void;
  } = $props();

  const NUOVO = '\u0000nuovo';
  let testo = $state('');
  // svelte-ignore state_referenced_locally
  let scelta = $state(contenitori[0] ?? '');
  let nuovo = $state('');
  let erroreFile = $state('');

  const trovati = $derived(identifiesFromText(testo));
  const contenitore = $derived(scelta === NUOVO ? nuovo.trim() : scelta);
  const valido = $derived(trovati.length > 0 && (scelta !== NUOVO || !!contenitore));

  async function fromFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    erroreFile = '';
    if (!f) return;
    if (/\.(docx?|pages|rtf)$/i.test(f.name)) {
      erroreFile = `Dal documento: seleziona tutto (${MOD}A), copia (${MOD}C) e incolla qui sopra. Si leggono solo file di testo.`;
      return;
    }
    testo = await f.text();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="ri-title"
  tabindex="-1"
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <header><h2 id="ri-title">Importa identify nel Reliquiario</h2></header>
  <div class="body">
    <p>
      Incolla uno o più identify (righe da <code>Oggetto: '…'</code> in poi): da un documento, da un log,
      come vuoi. Testo in mezzo e righe vuote non danno fastidio.
    </p>
    <textarea
      bind:value={testo}
      spellcheck="false"
      placeholder="Oggetto: 'giubba runa tessuto instabile', Tipo di Oggetto ARMOR&#10;…"
    ></textarea>
    <div class="row">
      <input type="file" accept=".txt,.log,.md,text/plain" onchange={fromFile} />
    </div>
    {#if erroreFile}<p class="err">{erroreFile}</p>{/if}
    <div class="row">
      <label for="ri-cont">Sono nel contenitore</label>
      <select id="ri-cont" bind:value={scelta}>
        <option value="">nessuno</option>
        {#each contenitori as c (c)}<option value={c}>{c}</option>{/each}
        <option value={NUOVO}>nuovo contenitore…</option>
      </select>
      {#if scelta === NUOVO}
        <input bind:value={nuovo} placeholder="nome (es. korred)" spellcheck="false" />
      {/if}
    </div>
    <p class="dim">
      {#if !testo.trim()}Nessun testo.
      {:else if !trovati.length}Nessun identify trovato: serve la riga <code>Oggetto: '…'</code>.
      {:else}Trovati {trovati.length} identify: {trovati
          .slice(0, 6)
          .map((c) => c.chiave)
          .join(', ')}{trovati.length > 6 ? '…' : ''}{/if}
    </p>
  </div>
  <footer>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" disabled={!valido} onclick={() => onimport(testo, contenitore)}
      >Importa {trovati.length || ''}</button
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
    top: 60px;
    left: 0;
    right: 0;
    width: min(680px, calc(100% - 32px));
    max-height: calc(100% - 100px);
    display: flex;
    flex-direction: column;
    margin: 0 auto;
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
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    overflow-y: auto;
  }
  p {
    margin: 0;
  }
  textarea {
    min-height: 220px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    resize: vertical;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dim {
    color: var(--text-dim);
  }
  .err {
    color: var(--c-red);
  }
</style>
