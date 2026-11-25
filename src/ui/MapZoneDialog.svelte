<script lang="ts">
  import type { MapArea } from '../nebbie/map/model';

  /**
   * Accendendo il MAPPER: le stanze nuove vanno in una zona già esistente o in una zona nuova
   * con il nome scelto (richiesta dell'utente del 2026-11-15).
   */
  let {
    zone,
    attuale,
    onstart,
    onclose,
  }: {
    zone: MapArea[];
    /** Zona della stanza in cui sei (proposta come zona esistente). */
    attuale?: number;
    onstart: (scelta: { zona: number } | { nuova: string }) => void;
    onclose: () => void;
  } = $props();

  const mondo = $derived(
    zone.filter((z) => z.tipo === 'mondo').sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
  );
  // svelte-ignore state_referenced_locally
  let modo = $state<'esistente' | 'nuova'>(mondo.length ? 'esistente' : 'nuova');
  // svelte-ignore state_referenced_locally
  let zona = $state<number | undefined>(mondo.find((z) => z.id === attuale)?.id ?? mondo[0]?.id);
  let nome = $state('');
  let input = $state<HTMLInputElement>();

  const ok = $derived(modo === 'esistente' ? zona !== undefined : nome.trim() !== '');

  function start() {
    if (!ok) return;
    onstart(modo === 'esistente' ? { zona: zona! } : { nuova: nome.trim() });
  }

  $effect(() => {
    if (modo === 'nuova') input?.focus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="mz-title"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
    if (e.key === 'Enter') start();
  }}
>
  <header><h2 id="mz-title">Accendi il mapper</h2></header>
  <div class="body">
    <p>Le stanze che scopri da adesso fanno parte di una zona che hai già?</p>
    <label class:off={!mondo.length}>
      <input type="radio" bind:group={modo} value="esistente" disabled={!mondo.length} />
      Sì, aggiungile alla zona
      <select bind:value={zona} disabled={modo !== 'esistente' || !mondo.length}>
        {#each mondo as z (z.id)}<option value={z.id}>{z.nome}</option>{/each}
      </select>
    </label>
    <label>
      <input type="radio" bind:group={modo} value="nuova" />
      No, crea una zona nuova:
      <input
        bind:this={input}
        type="text"
        placeholder="nome della zona"
        bind:value={nome}
        onfocus={() => (modo = 'nuova')}
      />
    </label>
    <small
      >Con il mapper spento la mappa non cambia: segue solo la tua posizione sulle stanze già note.</small
    >
  </div>
  <footer>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" disabled={!ok} onclick={start}>Accendi</button>
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
    top: 120px;
    left: 0;
    right: 0;
    width: min(460px, calc(100% - 32px));
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
  }
  p {
    margin: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  label.off {
    opacity: 0.5;
  }
  label select,
  label input[type='text'] {
    flex: 1;
    min-width: 0;
  }
  small {
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
