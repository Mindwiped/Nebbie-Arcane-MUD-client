<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Profile } from '../nebbie/profiles/profiles';
  import type { SessionState } from '../core/session';

  let {
    profiles,
    selectedId = $bindable(),
    sessionState,
    autoLogin,
    ontoggleautologin,
    onconnect,
    ondisconnect,
    oneditprofiles,
    onreplay,
    onstopreplay,
    children,
  }: {
    profiles: Profile[];
    selectedId: string | undefined;
    sessionState: SessionState;
    autoLogin: boolean;
    ontoggleautologin: () => void;
    onconnect: () => void;
    ondisconnect: () => void;
    oneditprofiles: () => void;
    onreplay: (speed: number) => void;
    onstopreplay: () => void;
    /** Controlli aggiuntivi dopo "Profili…" (es. il menu dei pannelli). */
    children?: Snippet;
  } = $props();

  let speed = $state(1);

  const busy = $derived(sessionState.conn === 'connected' || sessionState.conn === 'connecting');
  const statusText = $derived(
    sessionState.replaying
      ? 'Replay in corso'
      : {
          connecting: 'Connessione…',
          connected: 'Collegato',
          disconnected: 'Scollegato',
          replay: 'Replay',
          replayEnded: 'Scollegato',
        }[sessionState.conn],
  );
</script>

<header class="bar">
  <span class="brand">Nebbie Client</span>

  <label class="field">
    <span>Personaggio</span>
    <select bind:value={selectedId} disabled={busy || profiles.length === 0}>
      {#if profiles.length === 0}
        <option value={undefined}>nessun profilo</option>
      {/if}
      {#each profiles as p (p.id)}
        <option value={p.id}>{p.nome}</option>
      {/each}
    </select>
  </label>

  {#if busy}
    <button onclick={ondisconnect}>Scollega</button>
  {:else}
    <button class="primary" onclick={onconnect} disabled={!selectedId}>Collega</button>
  {/if}
  <button onclick={oneditprofiles}>Profili…</button>
  {@render children?.()}
  <label class="field toggle" title="Manda utente e password e sceglie il personaggio dal menu">
    <input type="checkbox" checked={autoLogin} onchange={ontoggleautologin} disabled={busy} />
    <span>Accesso automatico</span>
  </label>

  <span class="sep"></span>

  {#if sessionState.replaying}
    <button onclick={onstopreplay}>Ferma replay</button>
  {:else}
    <label class="field">
      <span>Velocità</span>
      <select bind:value={speed}>
        <option value={1}>1×</option>
        <option value={4}>4×</option>
        <option value={20}>20×</option>
        <option value={0}>subito</option>
      </select>
    </label>
    <button onclick={() => onreplay(speed)} title="Riproduce un log di sessione senza collegarsi">
      Replay log…
    </button>
  {/if}

  <span class="status {sessionState.replaying ? 'replay' : sessionState.conn}">
    <i></i>{statusText}{#if sessionState.promptName && sessionState.conn === 'connected'}
      · {sessionState.promptName}{/if}
  </span>
</header>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    font-size: 13px;
  }
  .bar :global(button),
  .field {
    white-space: nowrap;
  }
  .brand {
    white-space: nowrap;
    font-weight: 600;
    letter-spacing: 0.04em;
    margin-right: 6px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }
  .sep {
    flex: 1;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }
  .status i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6b7280;
  }
  .status.connected i {
    background: #4ade80;
  }
  .status.connecting i {
    background: #facc15;
  }
  .status.replay i {
    background: var(--accent);
  }
</style>
