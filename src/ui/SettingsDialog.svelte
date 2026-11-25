<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import {
    ALERT_LABELS,
    TEMI,
    defaultSettings,
    type AlertKind,
    type Settings,
    type Tema,
  } from '../core/settings';

  /**
   * Impostazioni (Fase 6): aspetto (tema, testo, scala) e avvisi (suono e notifica per evento).
   * Le modifiche si vedono subito; "Salva" le tiene, "Annulla" torna a com'era.
   */
  let {
    settings,
    onpreview,
    ontest,
    onsave,
    onclose,
  }: {
    settings: Settings;
    /** Applica senza salvare (anteprima). */
    onpreview: (s: Settings) => void;
    ontest: (k: AlertKind) => void;
    onsave: (s: Settings) => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<Settings>(structuredClone($state.snapshot(settings) as Settings));
  const kinds = Object.keys(ALERT_LABELS) as AlertKind[];

  $effect(() => {
    onpreview($state.snapshot(draft) as Settings);
  });

  function reset() {
    // la cartella del Reliquiario non è un'impostazione d'aspetto: resta
    draft = { ...defaultSettings(), reliquiario: draft.reliquiario };
  }

  async function chooseRelics() {
    try {
      const d = await open({
        directory: true,
        title: 'Cartella di identi.js (Reliquiario)',
        defaultPath: draft.reliquiario || undefined,
      });
      if (typeof d === 'string') draft.reliquiario = d;
    } catch {
      // fuori dall'app (browser di sviluppo): il percorso si scrive a mano
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="set-title"
  tabindex="-1"
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <header>
    <h2 id="set-title">Impostazioni</h2>
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>
  <div class="body">
    <section>
      <h3>Aspetto</h3>
      <label
        >Tema
        <select bind:value={draft.tema}>
          {#each Object.entries(TEMI) as [k, nome] (k)}<option value={k as Tema}>{nome}</option
            >{/each}
        </select></label
      >
      <label
        >Testo dell'output
        <input type="range" min="10" max="28" bind:value={draft.testo} />
        <span class="val">{draft.testo} px</span></label
      >
      <label
        >Scala dell'interfaccia
        <input type="range" min="70" max="160" step="5" bind:value={draft.scala} />
        <span class="val">{draft.scala}%</span></label
      >
    </section>
    <section>
      <h3>Avvisi</h3>
      <div class="row">
        <label class="inline"><input type="checkbox" bind:checked={draft.suoni} /> Suoni</label>
        <label class="inline"
          ><input type="checkbox" bind:checked={draft.notifiche} /> Notifiche di sistema (solo con la
          finestra non in primo piano)</label
        >
      </div>
      <table>
        <thead><tr><th></th><th>Suono</th><th>Notifica</th><th></th></tr></thead>
        <tbody>
          {#each kinds as k (k)}
            <tr>
              <td
                >{ALERT_LABELS[k]}{#if k === 'hp'}
                  sotto
                  <input
                    class="num"
                    type="number"
                    min="5"
                    max="90"
                    bind:value={draft.sogliaHp}
                  />%{/if}</td
              >
              <td><input type="checkbox" bind:checked={draft.avvisi[k].suono} /></td>
              <td><input type="checkbox" bind:checked={draft.avvisi[k].notifica} /></td>
              <td><button onclick={() => ontest(k)} title="Ascolta il suono">▶</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
    <section>
      <h3>Reliquiario</h3>
      <p class="hint">
        Il database degli oggetti della pagina <code>identi.html</code>: ogni identify e ogni
        <code>eq</code> si salvano in <code>identi.js</code> nella cartella scelta. Vuota = spento.
      </p>
      <div class="row">
        <input
          class="path"
          bind:value={draft.reliquiario}
          placeholder="nessuna cartella (spento)"
          spellcheck="false"
        />
        <button onclick={chooseRelics}>Scegli…</button>
        {#if draft.reliquiario}<button onclick={() => (draft.reliquiario = '')}>Spegni</button>{/if}
      </div>
    </section>
  </div>
  <footer>
    <button onclick={reset}>Predefinite</button>
    <span class="spacer"></span>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" onclick={() => onsave($state.snapshot(draft) as Settings)}>Salva</button
    >
  </footer>
</div>

<style>
  .backdrop {
    position: fixed;
    z-index: 10000;
    inset: 0;
    background: #0009;
  }
  .dialog {
    position: fixed;
    z-index: 10001;
    top: 60px;
    left: 0;
    right: 0;
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 100px);
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
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .close {
    border: 0;
    background: none;
    color: var(--text-dim);
  }
  .body {
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  section label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  section label input[type='range'] {
    flex: 1;
  }
  .val {
    width: 52px;
    text-align: right;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-bottom: 8px;
  }
  label.inline {
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    font-weight: normal;
    color: var(--text-dim);
    font-size: 11px;
    text-align: center;
  }
  td {
    padding: 3px 4px;
    border-top: 1px solid var(--border);
  }
  td:not(:first-child) {
    text-align: center;
  }
  .num {
    width: 48px;
  }
  .spacer {
    flex: 1;
  }
  .hint {
    margin: 0 0 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .path {
    flex: 1;
    min-width: 0;
  }
</style>
