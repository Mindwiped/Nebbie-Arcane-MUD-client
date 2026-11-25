<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import {
    containerNames,
    findRelic,
    searchRelics,
    statLine,
    type Relic,
    type RelicDb,
  } from '../../nebbie/relics/reliquiario';
  import { mobLine, searchMobs, type Mob, type MobSpawn } from '../../nebbie/relics/bestiario';

  /**
   * Pannello Reliquiario (richiesta del 2026-11-17): cerca negli oggetti identificati e mostra
   * l'eq dei pg con le statistiche dal database. I confronti e i pesi restano nella pagina
   * identi.html, che legge lo stesso file.
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  let vista = $state<'oggetti' | 'borse' | 'eq' | 'mob'>('oggetti');
  let qm = $state('');
  /** Filtro della sezione "Nelle borse": '' = tutti i contenitori. */
  let filtro = $state('');
  let modificaNomi = $state(false);
  let nomiTesto = $state('');
  let q = $state('');
  let aperto = $state<string | undefined>();
  let pgScelto = $state('');

  const r = $derived(sessionState.relics);
  // Il database non è reattivo: si rilegge quando cresce la versione.
  const db = $derived.by((): RelicDb => {
    void r.versione;
    return session.relics.db;
  });
  const risultati = $derived(searchRelics(db, q));
  const mobDb = $derived.by(() => {
    void r.versione;
    return session.relics.mobDb;
  });
  const nMob = $derived(Object.keys(mobDb.mob).length);
  const mobs = $derived(searchMobs(mobDb, qm));

  /** Va alla stanza di spawn col percorso dai file d'area (clic dell'utente). */
  function goSpawn(m: Mob, s: MobSpawn) {
    if (!s.percorso) return;
    void session.runPath({
      id: `mob:${m.vnum}:${s.stanza}`,
      zona: s.zona ?? m.zona ?? '',
      nome: `${m.nome} (${s.titolo ?? `#${s.stanza}`})`,
      nota: `dai file d'area, da ${mobDb.partenza?.titolo ?? 'Myst'}`,
      path: s.percorso,
      origine: 'mud',
      ...(s.porte ? { apriPorte: true } : {}),
    });
  }
  const list = (a: string[] | undefined) => (a?.length ? a.join(', ').toLowerCase() : '—');
  const pgs = $derived(Object.keys(db.pg).sort());
  const pg = $derived(
    pgs.includes(pgScelto) ? pgScelto : (pgs.find((p) => p === sessionState.promptName) ?? pgs[0]),
  );
  const eq = $derived((pg ? db.pg[pg].eq : []).map((e) => ({ ...e, o: findRelic(db, e.nome) })));
  const daIdentificare = $derived(eq.filter((e) => !e.o).length);

  const contenitori = $derived(containerNames(db));
  const nelleBorse = $derived(
    searchRelics(db, q, 1000, (o) => !!o.contenitore && (!filtro || o.contenitore === filtro)),
  );
  const perBorsa = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const o of Object.values(db.oggetti))
      if (o.contenitore) m[o.contenitore] = (m[o.contenitore] ?? 0) + 1;
    return m;
  });

  function editNames() {
    nomiTesto = contenitori.join(', ');
    modificaNomi = true;
  }
  function saveNames() {
    void session.relics.setContainers(nomiTesto.split(','));
    modificaNomi = false;
  }

  const fmt = (n: number | undefined) => (n === undefined ? '?' : n.toLocaleString('it-IT'));
  const toggle = (k: string) => (aperto = aperto === k ? undefined : k);
</script>

<div class="panel">
  {#if !r.cartella}
    <p class="dim pad">
      Reliquiario spento. Scegli la cartella di <code>identi.js</code> in Impostazioni →
      Reliquiario: da lì ogni identify e ogni <code>eq</code> si salvano nel database.
    </p>
  {:else}
    <div class="top">
      <button class:on={vista === 'oggetti'} onclick={() => (vista = 'oggetti')}>Oggetti</button>
      <button class:on={vista === 'borse'} onclick={() => (vista = 'borse')}>Nelle borse</button>
      <button class:on={vista === 'eq'} onclick={() => (vista = 'eq')}>Equipaggiamento</button>
      {#if nMob}<button class:on={vista === 'mob'} onclick={() => (vista = 'mob')}>Mob</button>{/if}
      <span class="count">{r.oggetti} oggetti</span>
      <button
        title="Rilegge identi.js (dopo una modifica con la pagina)"
        onclick={() => session.relics.reload()}>Ricarica</button
      >
    </div>
    {#if r.errore}<p class="err pad">{r.errore}</p>{/if}

    {#if vista === 'oggetti'}
      <div class="search">
        <input
          bind:value={q}
          placeholder="cerca: nome, flag, statistica (es. mana regen)"
          spellcheck="false"
        />
      </div>
      <div class="body">
        {#each risultati as o (o.chiave)}
          {@render riga(o, o.chiave, o.nome ?? o.chiave, o.slot)}
        {:else}
          <p class="dim pad">
            {q ? 'Nessun oggetto trovato.' : 'Nessun oggetto: identifica qualcosa.'}
          </p>
        {/each}
        {#if risultati.length === 200}<p class="dim pad">
            Solo i primi 200: restringi la ricerca.
          </p>{/if}
      </div>
    {:else if vista === 'borse'}
      <div class="search">
        <select bind:value={filtro} title="Contenitore">
          <option value="">tutti i contenitori</option>
          {#each contenitori as c (c)}<option value={c}>{c} ({perBorsa[c] ?? 0})</option>{/each}
        </select>
        <input bind:value={q} placeholder="cerca" spellcheck="false" />
        <button onclick={() => session.openRelicImport?.()}>Importa…</button>
      </div>
      <div class="search names">
        {#if modificaNomi}
          <input
            bind:value={nomiTesto}
            placeholder="contenitori, separati da virgola (es. korred, compendium)"
            spellcheck="false"
            onkeydown={(e) => e.key === 'Enter' && saveNames()}
          />
          <button class="primary" onclick={saveNames}>Salva</button>
          <button onclick={() => (modificaNomi = false)}>Annulla</button>
        {:else}
          <span class="dim">Contenitori: {contenitori.join(', ') || 'nessuno'}</span>
          <button onclick={editNames}>Modifica</button>
        {/if}
      </div>
      <div class="body">
        {#each nelleBorse as o (o.chiave)}
          {@render riga(o, o.chiave, o.nome ?? o.chiave, o.contenitore)}
        {:else}
          <p class="dim pad">
            {contenitori.length
              ? 'Nessun oggetto in questo contenitore. Importa i tuoi identify, o scegli il contenitore dalla scheda di un oggetto.'
              : 'Scrivi i nomi dei tuoi contenitori (Modifica), poi importa gli identify degli oggetti che tieni dentro.'}
          </p>
        {/each}
      </div>
    {:else if vista === 'mob'}
      <div class="search">
        <input
          bind:value={qm}
          placeholder="cerca: nome, zona, oggetto, sanctuary, aggressive, lvl>30…"
          spellcheck="false"
        />
        <span class="dim">{nMob} mob</span>
      </div>
      <div class="body">
        {#each mobs as m (m.vnum)}
          <button
            class="row"
            class:open={aperto === `m${m.vnum}`}
            onclick={() => toggle(`m${m.vnum}`)}
          >
            <span class="slot">liv {m.livello ?? '?'} · {m.zona ?? '?'}</span>
            <span class="name">{m.nome}</span>
            <span class="stats">{mobLine(m)}</span>
          </button>
          {#if aperto === `m${m.vnum}`}
            <div class="detail">
              {#if m.descrizione}<p class="flags">{m.descrizione}</p>{/if}
              <table>
                <tbody>
                  <tr><td>Parole chiave</td><td>{m.chiave} (#{m.vnum})</td></tr>
                  <tr
                    ><td>Livello · classe</td><td
                      >{m.livello ?? '?'}{m.classi?.length ? ` · ${list(m.classi)}` : ''}{m.attacchi
                        ? ` · ${m.attacchi} attacchi`
                        : ''}</td
                    ></tr
                  >
                  <tr
                    ><td>Razza · sesso · allin.</td><td
                      >{m.razza ?? '?'} · {m.sesso ?? '?'} · {m.allineamento ?? '?'}</td
                    ></tr
                  >
                  <tr
                    ><td>PF · AC · danno</td><td
                      >{m.pf ?? '?'} · {m.ac ?? '?'} · {m.danno ?? '?'}</td
                    ></tr
                  >
                  <tr><td>Incantesimi attivi</td><td>{list(m.incantesimi)}</td></tr>
                  <tr><td>Resistenze</td><td>{list(m.resistenze)}</td></tr>
                  <tr><td>Immunità</td><td>{list(m.immunita)}</td></tr>
                  <tr><td>Suscettibilità</td><td>{list(m.suscettibilita)}</td></tr>
                  <tr><td>Comportamento</td><td>{list(m.flag)}</td></tr>
                  {#if m.oro}<tr><td>Oro</td><td>{fmt(m.oro)}</td></tr>{/if}
                </tbody>
              </table>
              <h5>Dove nasce</h5>
              {#each m.spawn ?? [] as sp (sp.stanza)}
                <div class="spawn">
                  <span
                    >{sp.titolo ?? '?'}
                    <small>#{sp.stanza} · {sp.zona ?? '?'}{sp.max ? ` · max ${sp.max}` : ''}</small
                    ></span
                  >
                  {#if sp.percorso}
                    <code
                      title="Percorso a piedi da {mobDb.partenza?.titolo ?? 'Myst'}{sp.porte
                        ? ' (porte da aprire)'
                        : ''}">{sp.percorso}</code
                    >
                    <button
                      onclick={() => goSpawn(m, sp)}
                      title="Cammina fin lì (da {mobDb.partenza?.titolo ?? 'Myst'})">Vai</button
                    >
                  {:else}<small class="dim">non raggiungibile a piedi da Myst</small>{/if}
                </div>
              {:else}<p class="dim">Non compare nei reset delle zone.</p>{/each}
              {#if m.equip?.length}
                <h5>Indossa</h5>
                {#each m.equip as e, i (i)}<p class="flags">
                    {e.slot}: {e.nome ?? `#${e.vnum}`}
                  </p>{/each}
              {/if}
              {#if m.inventario?.length}
                <h5>Inventario</h5>
                {#each m.inventario as e, i (i)}<p class="flags">
                    {e.nome ?? `#${e.vnum}`}{#if e.contiene?.length}
                      — contiene {e.contiene.map((c) => c.nome ?? `#${c.vnum}`).join(', ')}{/if}
                  </p>{/each}
              {/if}
            </div>
          {/if}
        {:else}
          <p class="dim pad">Nessun mob trovato.</p>
        {/each}
        {#if mobs.length === 200}<p class="dim pad">Solo i primi 200: restringi la ricerca.</p>{/if}
      </div>
    {:else}
      <div class="search">
        {#if pgs.length}
          <select value={pg} onchange={(e) => (pgScelto = e.currentTarget.value)}>
            {#each pgs as p (p)}<option value={p}>{p}</option>{/each}
          </select>
          <span class="dim"
            >letto il {db.pg[pg!]?.aggiornato ?? '?'}{daIdentificare
              ? ` · ${daIdentificare} da identificare`
              : ''}</span
          >
        {/if}
      </div>
      <div class="body">
        {#each eq as e, i (e.slot + e.nome + i)}
          {#if e.o}
            {@render riga(e.o, `eq${i}`, e.nome, e.slot)}
          {:else}
            <div class="row">
              <span class="slot">{e.slot}</span>
              <span class="name">{e.nome}</span>
              <span class="todo">da identificare</span>
            </div>
          {/if}
        {:else}
          <p class="dim pad">Nessun pg: scrivi <code>eq</code> in gioco.</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#snippet riga(o: Relic, k: string, nome: string, slot: string | undefined)}
  <button class="row" class:open={aperto === k} onclick={() => toggle(k)}>
    <span class="slot">{slot ?? o.tipo}</span>
    <span class="name">{nome}</span>
    <span class="stats">{statLine(o)}</span>
  </button>
  {#if aperto === k}
    <div class="detail">
      <table>
        <tbody>
          <tr><td>Parole chiave</td><td>{o.parole ?? o.chiave}</td></tr>
          <tr><td>Tipo</td><td>{o.tipo || '?'}</td></tr>
          {#if o.ac}<tr><td>AC-apply</td><td>{o.ac}</td></tr>{/if}
          {#each Object.entries(o.stats) as [s, v] (s)}
            <tr><td>{s}</td><td>{v > 0 ? '+' : ''}{v}</td></tr>
          {/each}
          {#if o.dado}<tr><td>Danno</td><td>{o.dado} {o.tipoDanno ?? ''}</td></tr>{/if}
          {#if o.incantesimi}
            <tr
              ><td>Incantesimi</td><td
                >{o.incantesimi.join(', ')}{o.livello ? ` (liv. ${o.livello})` : ''}{o.cariche
                  ? `, ${o.cariche} cariche`
                  : ''}</td
              ></tr
            >
          {/if}
          <tr
            ><td>Peso · valore · rent</td><td
              >{fmt(o.peso)} · {fmt(o.valore)} · {fmt(o.rent)}{o.raro ? ' (raro)' : ''}</td
            ></tr
          >
          <tr><td>Indossato</td><td>{o.slot ?? 'non ancora visto addosso'}</td></tr>
          <tr><td>Aggiunto</td><td>{o.visto ?? '?'}</td></tr>
          <tr
            ><td>Contenitore</td><td
              ><select
                value={o.contenitore ?? ''}
                onchange={(e) => session.relics.setContainer(o.chiave, e.currentTarget.value)}
              >
                <option value="">nessuno</option>
                {#each contenitori as c (c)}<option value={c}>{c}</option>{/each}
              </select></td
            ></tr
          >
        </tbody>
      </table>
      <p class="flags">{o.flags.join(' ') || 'nessun flag'}</p>
      {#each o.poteri ?? [] as p (p)}<p class="flags">{p}</p>{/each}
      {#each o.extra as x, i (i)}<p class="flags">{x}</p>{/each}
      {#if o.wiki?.area || o.wiki?.mob}
        <p class="flags">
          {[o.wiki.area, o.wiki.location, o.wiki.mob].filter(Boolean).join(' · ')}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .pad {
    padding: 8px 10px;
    margin: 0;
  }
  .top,
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
  }
  .top {
    border-bottom: 1px solid var(--border);
  }
  .top .on {
    border-color: var(--c-gold);
    color: var(--c-gold);
  }
  .names {
    padding-top: 0;
  }
  .names .dim {
    flex: 1;
    font-size: 12px;
  }
  .count {
    flex: 1;
    text-align: right;
    color: var(--text-dim);
    font-size: 12px;
  }
  .search input {
    flex: 1;
    min-width: 0;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 110px minmax(120px, 1fr) 2fr;
    gap: 8px;
    width: 100%;
    padding: 3px 4px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover,
  .row.open {
    background: var(--bg-hover, #ffffff0d);
  }
  .slot {
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    color: var(--c-gold);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .todo {
    color: var(--c-red);
    font-size: 12px;
  }
  .detail {
    padding: 6px 8px 10px 20px;
    border-bottom: 1px solid var(--border);
  }
  .detail table {
    border-collapse: collapse;
  }
  .detail td {
    padding: 1px 12px 1px 0;
    vertical-align: top;
  }
  .detail td:first-child {
    color: var(--text-dim);
  }
  h5 {
    margin: 8px 0 2px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .spawn {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .spawn code {
    color: var(--c-gold);
    font-size: 11px;
    word-break: break-all;
  }
  .flags {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .dim {
    color: var(--text-dim);
  }
  .err {
    color: var(--c-red);
  }
</style>
