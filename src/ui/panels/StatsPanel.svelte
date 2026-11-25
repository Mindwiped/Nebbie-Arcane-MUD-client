<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import { msToNextTick } from '../../nebbie/affects/tickClock';
  import { formatDuration, formatNumber, xpPerHour } from '../../nebbie/stats/sessionStats';

  /** Pannello Statistiche: durata, XP, XP/h, mob uccisi, monete raccolte, reset. */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const s = $derived(sessionState.stats);
  const nextTick = $derived(msToNextTick(sessionState.tick, now));
  const topMobs = $derived(
    Object.entries(s.perMob)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  );
</script>

<div class="panel">
  <div
    class="tick"
    title="Ricavato dalle scadenze degli incantesimi (tick stimato {Math.round(
      sessionState.tick.periodo / 100,
    ) / 10} s)"
  >
    <span>Tick</span>
    {#if nextTick === undefined}
      <em>in attesa della scadenza di un incantesimo</em>
    {:else}
      <b class:soon={nextTick <= 10_000}>~{Math.ceil(nextTick / 1000)} s</b>
    {/if}
  </div>
  <dl>
    <dt>Durata</dt>
    <dd>{formatDuration(now - s.inizio)}</dd>
    <dt>XP</dt>
    <dd>{formatNumber(s.xp)}</dd>
    <dt>XP/h</dt>
    <dd>{formatNumber(xpPerHour(s, now))}</dd>
    {#if s.xpPersa > 0}
      <dt>XP persa</dt>
      <dd class="bad">{formatNumber(s.xpPersa)}</dd>
    {/if}
    <dt>Mob uccisi</dt>
    <dd>{formatNumber(s.uccisi)}</dd>
    <dt>Monete raccolte</dt>
    <dd>{formatNumber(s.monete)}</dd>
    {#if s.oro !== undefined}
      {@const diff = s.oro - (s.oroIniziale ?? s.oro)}
      <dt>Oro in tasca</dt>
      <dd>{formatNumber(s.oro)}</dd>
      <dt>Variazione oro</dt>
      <dd class:bad={diff < 0} class:good={diff > 0}>
        {diff > 0 ? '+' : ''}{formatNumber(diff)}
      </dd>
    {/if}
  </dl>

  {#if topMobs.length}
    <h4>Uccisi in questa sessione</h4>
    <ul>
      {#each topMobs as [nome, n] (nome)}
        <li><span>{nome}</span><b>{n}</b></li>
      {/each}
    </ul>
  {/if}

  <button onclick={() => session.resetStats()}>Reset sessione</button>
</div>

<style>
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 13px;
  }
  .tick {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
    padding: 6px 8px;
    border-radius: 5px;
    background: var(--tag-purple-bg);
  }
  .tick span {
    color: var(--tag-purple-fg);
  }
  .tick b {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--c-purple-light);
  }
  .tick b.soon {
    color: var(--tag-amber-fg);
  }
  .tick em {
    color: var(--text-dim);
    font-size: 11px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 10px;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
    text-align: right;
    font-family: var(--font-mono);
  }
  .bad {
    color: var(--c-red);
  }
  .good {
    color: var(--c-green);
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ul {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 1px 0;
  }
  li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li b {
    font-weight: 500;
    font-family: var(--font-mono);
  }
</style>
