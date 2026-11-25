<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import type { GearList } from '../../nebbie/gear/model';
  import { compare } from '../../nebbie/gear/plan';
  import { findRelic, statLine } from '../../nebbie/relics/reliquiario';

  /**
   * Pannello Equipaggiamento (SPECIFICA 5.3): set con confronto e un clic per indossarli,
   * cosa hai addosso con la condizione, inventario e contenitori, riparazione dal fabbro.
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  let newSet = $state('');
  let openSet = $state<string | undefined>();

  const g = $derived(sessionState.gear);
  // La configurazione non è reattiva: si rilegge quando cambia lo stato del vestiario.
  const sets = $derived.by(() => {
    void sessionState.gear;
    const cfg = session.gear.cfg;
    const worn = g?.modello.addosso.righe ?? [];
    return Object.keys(cfg.sets)
      .sort()
      .map((nome) => ({
        nome,
        pezzi: cfg.sets[nome],
        diff: compare(cfg.sets[nome], worn, cfg),
      }));
  });
  const busy = $derived(
    sessionState.sequence !== undefined && sessionState.sequence.stato !== 'fermo',
  );
  const letto = $derived(g?.modello.addosso.letto !== undefined);

  function age(l: GearList | undefined): string {
    if (!l?.letto) return 'mai letto';
    const s = Math.round((Date.now() - l.letto) / 1000);
    const t = s < 60 ? 'adesso' : s < 3600 ? `${Math.round(s / 60)} min fa` : "più di un'ora fa";
    return l.toccato ? `${t}, poi cambiato` : t;
  }

  /** Statistiche dal Reliquiario (se acceso e se l'oggetto è stato identificato). */
  function relic(nome: string): string {
    void sessionState.relics.versione;
    if (!sessionState.relics.cartella) return '';
    const o = findRelic(session.relics.db, nome);
    return o ? statLine(o) || 'identificato, nessuna statistica' : 'non nel Reliquiario';
  }

  function cond(c?: string): string {
    if (!c) return '';
    if (c === 'in condizioni eccellenti') return 'ok';
    if (/buon|graffi|ammacc/.test(c)) return 'mid';
    return 'bad';
  }

  function saveCurrent() {
    const n = newSet.trim().toLowerCase();
    if (!n || /\s/.test(n)) return;
    session.gear.saveSet(n);
    newSet = '';
  }

  function del(nome: string) {
    if (confirm(`Eliminare il set "${nome}"?`)) session.gear.deleteSet(nome);
  }
</script>

<div class="panel">
  <div class="top">
    <span class="current">
      {#if g?.attuale}set <b>{g.attuale}</b>
      {:else if g?.vicino}vicino a <b>{g.vicino}</b> ({g.distanza} diversi)
      {:else}set non rilevato{/if}
    </span>
    {#if g?.fabbro}<span class="smith" title="C'è il fabbro nella stanza">🔨 fabbro</span>{/if}
    <button disabled={busy} onclick={() => session.gear.refresh()} title="Rilegge eq e inventario"
      >Aggiorna</button
    >
    {#if g && g.daRiparare > 0}
      <button
        class:primary={g.fabbro}
        disabled={busy}
        onclick={() => session.gear.repair()}
        title={g.fabbro ? 'Ripara i pezzi rovinati' : 'Nessun fabbro qui'}
        >Ripara ({g.daRiparare})</button
      >
    {/if}
  </div>

  <div class="body">
    <section>
      <h4>Set</h4>
      {#each sets as s (s.nome)}
        {@const worn = letto && s.diff.mancano.length === 0 && s.diff.inPiu.length === 0}
        <div class="set" class:worn>
          <button
            class="set-name"
            onclick={() => (openSet = openSet === s.nome ? undefined : s.nome)}
          >
            <span class="arrow">{openSet === s.nome ? '▾' : '▸'}</span>
            {s.nome}
            <small>
              {#if !letto}{s.pezzi.length} pezzi
              {:else if worn}indossato
              {:else}{s.diff.mancano.length} da mettere, {s.diff.inPiu.length} da togliere{/if}
            </small>
          </button>
          <button
            disabled={busy || worn}
            class="primary"
            onclick={() => session.gear.change(s.nome)}>Indossa</button
          >
          <button disabled={busy} onclick={() => session.gear.change(s.nome, { prova: true })}
            >Prova</button
          >
        </div>
        {#if openSet === s.nome}
          <ul class="pieces">
            {#each s.pezzi as p, i (p.nome + i)}
              <li class:missing={letto && s.diff.mancano.includes(p.nome)}>
                <span class="slot">{p.slot ?? ''}</span>
                <span class="name">{p.nome}</span>
                <button
                  class="x"
                  title="Togli dal set"
                  onclick={() => session.gear.removePiece(s.nome, i)}>✕</button
                >
              </li>
            {/each}
            {#if letto && s.diff.inPiu.length}
              <li class="extra">in più addosso: {s.diff.inPiu.join(', ')}</li>
            {/if}
            <li><button class="link" onclick={() => del(s.nome)}>Elimina il set</button></li>
          </ul>
        {/if}
      {:else}
        <p class="dim">Nessun set. Indossa quello che vuoi e salvalo qui sotto.</p>
      {/each}
      <div class="save">
        <input bind:value={newSet} placeholder="nome del set (una parola)" spellcheck="false" />
        <button disabled={busy || !newSet.trim() || /\s/.test(newSet.trim())} onclick={saveCurrent}
          >Salva quello che indosso</button
        >
      </div>
    </section>

    <section>
      <h4>Addosso <small>{age(g?.modello.addosso)}</small></h4>
      {#if g?.modello.addosso.righe.length}
        <table>
          <tbody>
            {#each g.modello.addosso.righe as r, i (r.nome + i)}
              <tr>
                <td class="slot">{r.slot ?? '?'}</td>
                <td title={relic(r.nome)}>{r.nome}</td>
                <td class="cond {cond(r.condizione)}" title={r.condizione ?? ''}
                  >{r.condizione ? r.condizione.replace(/^in condizioni /, '') : ''}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="dim">Scrivi eq o premi Aggiorna.</p>
      {/if}
    </section>

    <section>
      <h4>Inventario <small>{age(g?.modello.inventario)}</small></h4>
      {#if g?.modello.inventario.righe.length}
        <ul class="items">
          {#each g.modello.inventario.righe as r, i (r.nome + i)}
            <li title={relic(r.nome)}>{r.nome}{r.quantita > 1 ? ` ×${r.quantita}` : ''}</li>
          {/each}
        </ul>
      {:else}
        <p class="dim">{g?.modello.inventario.letto ? 'Vuoto.' : 'Non ancora letto.'}</p>
      {/if}
    </section>

    {#each Object.entries(g?.modello.contenitori ?? {}) as [nome, l] (nome)}
      <section>
        <h4>{nome} <small>{age(l)}</small></h4>
        <ul class="items">
          {#each l.righe as r, i (r.nome + i)}
            <li>{r.nome}{r.quantita > 1 ? ` ×${r.quantita}` : ''}</li>
          {:else}
            <li class="dim">Vuoto.</li>
          {/each}
        </ul>
      </section>
    {/each}
    <p class="dim help">
      <button onclick={() => session.gear.askContainers()}>Contenitori…</button>
      Parole chiave e posti dei singoli oggetti: <code>eqset aiuto</code>.
    </p>
  </div>
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
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .current {
    flex: 1;
    min-width: 0;
  }
  .smith {
    color: var(--c-gold);
    font-size: 12px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 10px 10px;
  }
  section {
    margin-top: 8px;
  }
  h4 {
    margin: 0 0 4px;
    color: var(--c-blue);
    font-weight: 500;
  }
  h4 small,
  small,
  .dim {
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 400;
  }
  .dim {
    margin: 2px 0;
  }
  .set {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .set-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    border: 0;
    background: none;
    text-align: left;
    padding: 2px 0;
  }
  .set.worn .set-name {
    color: var(--c-green);
  }
  .arrow {
    width: 10px;
    color: var(--text-dim);
  }
  button {
    padding: 1px 8px;
    font-size: 12px;
  }
  .pieces {
    margin: 0 0 6px 16px;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }
  .pieces li {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 1px 0;
  }
  .pieces li.missing .name {
    color: var(--c-gold);
  }
  .extra {
    color: var(--text-dim);
  }
  .slot {
    color: var(--text-dim);
    min-width: 110px;
    font-size: 11px;
  }
  .name {
    flex: 1;
  }
  .x {
    border: 0;
    background: none;
    color: var(--text-dim);
    padding: 0 4px;
  }
  .link {
    border: 0;
    background: none;
    color: var(--text-dim);
    text-decoration: underline;
    padding: 0;
  }
  .save {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .save input {
    flex: 1;
    min-width: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  td {
    padding: 1px 4px 1px 0;
    vertical-align: top;
  }
  td.slot {
    white-space: nowrap;
  }
  .cond {
    white-space: nowrap;
    font-size: 11px;
  }
  .cond.ok {
    color: var(--c-green);
  }
  .cond.mid {
    color: var(--c-gold);
  }
  .cond.bad {
    color: var(--c-red);
  }
  .items {
    margin: 0;
    padding-left: 16px;
    font-size: 12px;
  }
  .help {
    margin-top: 12px;
  }
</style>
