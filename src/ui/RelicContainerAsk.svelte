<script lang="ts">
  /**
   * Dopo un identify in gioco (richiesta del 2026-11-17): l'oggetto sta in un contenitore?
   * Riquadro piccolo in basso a destra, non blocca il gioco; più identify fanno la coda.
   */
  let {
    oggetto,
    altri,
    contenitori,
    onanswer,
  }: {
    oggetto: { nome: string; contenitore?: string };
    /** Quanti altri aspettano dopo questo. */
    altri: number;
    contenitori: string[];
    /** Contenitore scelto (vuoto = nessuno), oppure undefined = lascia com'è. */
    onanswer: (contenitore: string | undefined) => void;
  } = $props();

  const NUOVO = '\u0000nuovo';
  // svelte-ignore state_referenced_locally
  let scelta = $state(oggetto.contenitore ?? (contenitori.length ? contenitori[0] : NUOVO));
  let nuovo = $state('');
  const valore = $derived(scelta === NUOVO ? nuovo.trim() : scelta);
</script>

<div class="ask" role="dialog" aria-label="Contenitore dell'oggetto identificato">
  <p>
    Identificato <b>{oggetto.nome}</b>.
    {#if altri}<small>(+{altri})</small>{/if}
    È in un contenitore?
  </p>
  <div class="row">
    <select bind:value={scelta}>
      {#each contenitori as c (c)}<option value={c}>{c}</option>{/each}
      <option value={NUOVO}>nuovo contenitore…</option>
    </select>
    {#if scelta === NUOVO}
      <input
        bind:value={nuovo}
        placeholder="nome (es. korred)"
        spellcheck="false"
        onkeydown={(e) => e.key === 'Enter' && valore && onanswer(valore)}
      />
    {/if}
  </div>
  <div class="row end">
    <button onclick={() => onanswer('')} title="Non sta in un contenitore">No</button>
    <button onclick={() => onanswer(undefined)} title="Decidi dopo dal pannello Reliquiario"
      >Dopo</button
    >
    <button class="primary" disabled={!valore} onclick={() => onanswer(valore)}>Salva</button>
  </div>
</div>

<style>
  .ask {
    z-index: 9000;
    position: fixed;
    right: 16px;
    bottom: 120px;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--c-gold);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 10px 30px #0008;
    font-size: 13px;
  }
  p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row select,
  .row input {
    flex: 1;
    min-width: 0;
  }
  .end {
    justify-content: flex-end;
  }
</style>
