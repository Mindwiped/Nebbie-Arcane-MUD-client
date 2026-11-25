<script lang="ts">
  import type { SessionState } from '../../core/session';
  import type { Dir } from '../../nebbie/parser/types';

  /** Pannello Stanza: titolo, uscite (con le porte chiuse), mob e oggetti, descrizione. */
  let { sessionState }: { sessionState: SessionState } = $props();

  const NAMES: Record<Dir, string> = {
    n: 'Nord',
    s: 'Sud',
    e: 'Est',
    w: 'Ovest',
    u: 'Alto',
    d: 'Basso',
    ne: 'Nordest',
    nw: 'Nordovest',
    se: 'Sudest',
    sw: 'Sudovest',
  };

  const room = $derived(sessionState.room);

  /** Uscite da mostrare: le visibili (con il nome della stanza), altrimenti quelle di `Uscite:`. */
  const exits = $derived.by(() => {
    if (!room) return [];
    if (room.visibili.length) {
      return room.visibili.map((v) => ({
        dir: NAMES[v.dir],
        nome: v.nome,
        // Le porte chiuse mancano da "Uscite:" ma compaiono nelle "Uscite visibili".
        chiusa: !room.uscite.includes(v.dir),
      }));
    }
    return room.uscite.map((d) => ({ dir: NAMES[d], nome: '', chiusa: false }));
  });

  let showDescription = $state(false);
</script>

<div class="panel">
  {#if room}
    <h3>{room.titolo}</h3>
    <ul class="exits">
      {#each exits as e (e.dir)}
        <li class:closed={e.chiusa}>
          <b>{e.dir}</b>
          {#if e.nome}<span>{e.nome}</span>{/if}
          {#if e.chiusa}<em>porta chiusa</em>{/if}
        </li>
      {/each}
    </ul>
    {#if room.contenuti.length}
      <h4>Qui</h4>
      <ul class="contents">
        {#each room.contenuti as c, i (i)}<li>{c}</li>{/each}
      </ul>
    {/if}
    {#if room.righeDescrizione.length}
      <button class="link" onclick={() => (showDescription = !showDescription)}>
        {showDescription ? 'Nascondi descrizione' : 'Mostra descrizione'}
      </button>
      {#if showDescription}
        <p class="description">{room.righeDescrizione.join(' ').replace(/\s+/g, ' ')}</p>
      {/if}
    {/if}
  {:else}
    <p class="empty">Nessuna stanza ancora: muoviti o scrivi <code>look</code>.</p>
  {/if}
</div>

<style>
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 13px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--c-blue);
  }
  h4 {
    margin: 12px 0 4px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .exits li {
    display: flex;
    gap: 8px;
    padding: 2px 0;
  }
  .exits b {
    width: 64px;
    flex: none;
    color: var(--c-green);
    font-weight: 500;
  }
  .exits .closed b {
    color: var(--c-gold);
  }
  .exits em {
    color: var(--c-gold);
    font-size: 11px;
  }
  .contents li {
    padding: 2px 0;
    color: var(--c-gold);
  }
  .description {
    margin: 6px 0 0;
    color: var(--text-dim);
    line-height: 1.45;
  }
  .empty {
    color: var(--text-dim);
  }
  .link {
    margin-top: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
</style>
