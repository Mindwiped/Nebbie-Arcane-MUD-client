<script lang="ts">
  import { AutomationEngine } from '../core/automation/engine';
  import {
    GLOBAL,
    newAlias,
    newGroup,
    newTrigger,
    validateAlias,
    validateTrigger,
    type Alias,
    type AutomationFile,
    type AutomationGroup,
    type Trigger,
  } from '../core/automation/model';
  import type { Profile } from '../nebbie/profiles/profiles';

  /**
   * Editor di alias, trigger e gruppi. Lavora su una copia: niente cambia finché non si salva.
   */
  let {
    file,
    profiles,
    activeProfileId,
    onsave,
    onclose,
    onspells,
    onscripts,
  }: {
    file: AutomationFile;
    profiles: Profile[];
    activeProfileId: string | undefined;
    onsave: (file: AutomationFile) => void;
    onclose: () => void;
    /** Apre le abbreviazioni degli incantesimi. */
    onspells?: () => void;
    /** Apre gli script utente. */
    onscripts?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const initial = $state.snapshot(file) as AutomationFile;
  let gruppi = $state<AutomationGroup[]>(initial.gruppi);
  let alias = $state<Alias[]>(initial.alias);
  let trigger = $state<Trigger[]>(initial.trigger);

  // svelte-ignore state_referenced_locally
  let groupId = $state(gruppi[0].id);
  let tab = $state<'alias' | 'trigger'>('alias');
  let itemId = $state<string | undefined>();
  let sample = $state('');
  let confirmDelete = $state(false);

  const group = $derived(gruppi.find((g) => g.id === groupId) ?? gruppi[0]);
  const groupAliases = $derived(alias.filter((a) => a.gruppo === group.id));
  const groupTriggers = $derived(trigger.filter((t) => t.gruppo === group.id));
  const currentAlias = $derived(tab === 'alias' ? alias.find((a) => a.id === itemId) : undefined);
  const currentTrigger = $derived(
    tab === 'trigger' ? trigger.find((t) => t.id === itemId) : undefined,
  );
  const errors = $derived(
    currentAlias
      ? validateAlias(currentAlias)
      : currentTrigger
        ? validateTrigger(currentTrigger)
        : [],
  );
  const allValid = $derived(
    alias.every((a) => validateAlias(a).length === 0) &&
      trigger.every((t) => validateTrigger(t).length === 0),
  );

  function scopeLabel(ambito: string): string {
    if (ambito === GLOBAL) return 'tutti i personaggi';
    return profiles.find((p) => p.id === ambito)?.nome ?? 'profilo eliminato';
  }

  /** Prova sul campo: espande il comando o controlla la riga con la sola voce selezionata. */
  const sampleResult = $derived.by(() => {
    if (!sample.trim()) return null;
    const one = (a: Alias[], t: Trigger[]) => {
      const e = new AutomationEngine();
      e.load(
        { versione: 1, gruppi: [{ ...group, attivo: true, ambito: GLOBAL }], alias: a, trigger: t },
        undefined,
      );
      return e;
    };
    try {
      if (currentAlias) {
        const out = one([{ ...currentAlias, attivo: true }], []).expand(sample);
        return out
          ? { ok: true, text: `→ ${out.join('; ')}` }
          : { ok: false, text: 'Non corrisponde.' };
      }
      if (currentTrigger) {
        const r = one([], [{ ...currentTrigger, attivo: true }]).matchLine(sample);
        const hit = r.fires.length || r.colore || r.nascondi;
        if (!hit) return { ok: false, text: 'Non corrisponde.' };
        const parts = [];
        if (r.fires.length) parts.push(`manda: ${r.fires[0].comandi.join('; ')}`);
        if (r.colore) parts.push(`colore ${r.colore}`);
        if (r.nascondi) parts.push('nasconde la riga');
        return { ok: true, text: parts.join(' · ') };
      }
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
    return null;
  });

  function addGroup() {
    const g = newGroup('Nuovo gruppo', GLOBAL);
    gruppi.push(g);
    groupId = g.id;
    itemId = undefined;
  }

  function removeGroup() {
    if (gruppi.length <= 1) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    confirmDelete = false;
    const id = group.id;
    gruppi = gruppi.filter((g) => g.id !== id);
    alias = alias.filter((a) => a.gruppo !== id);
    trigger = trigger.filter((t) => t.gruppo !== id);
    groupId = gruppi[0].id;
    itemId = undefined;
  }

  function addItem() {
    if (tab === 'alias') {
      const a = newAlias(group.id);
      alias.push(a);
      itemId = a.id;
    } else {
      const t = newTrigger(group.id);
      trigger.push(t);
      itemId = t.id;
    }
    sample = '';
  }

  function removeItem() {
    if (tab === 'alias') alias = alias.filter((a) => a.id !== itemId);
    else trigger = trigger.filter((t) => t.id !== itemId);
    itemId = undefined;
  }

  function save() {
    if (!allValid) return;
    onsave({
      versione: 1,
      gruppi: $state.snapshot(gruppi) as AutomationGroup[],
      alias: $state.snapshot(alias) as Alias[],
      trigger: $state.snapshot(trigger) as Trigger[],
    });
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Automazioni">
  <header>
    <h2>Automazioni: alias e trigger</h2>
    {#if onspells}<button onclick={onspells}>Abbreviazioni incantesimi…</button>{/if}
    {#if onscripts}<button onclick={onscripts}>Script…</button>{/if}
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>

  <div class="body">
    <nav>
      <div class="nav-title">Gruppi</div>
      {#each gruppi as g (g.id)}
        <button
          class:active={g.id === groupId}
          class:off={!g.attivo}
          onclick={() => {
            groupId = g.id;
            itemId = undefined;
            confirmDelete = false;
          }}
        >
          <span>{g.nome || '(senza nome)'}</span>
          <small>{scopeLabel(g.ambito)}{g.attivo ? '' : ' · spento'}</small>
        </button>
      {/each}
      <button class="add" onclick={addGroup}>+ Nuovo gruppo</button>
    </nav>

    <section>
      <div class="group-form">
        <label class="grow">
          <span>Nome del gruppo</span>
          <input bind:value={group.nome} />
        </label>
        <label>
          <span>Vale per</span>
          <select bind:value={group.ambito}>
            <option value={GLOBAL}>tutti i personaggi</option>
            {#each profiles as p (p.id)}
              <option value={p.id}>{p.nome}{p.id === activeProfileId ? ' (attivo)' : ''}</option>
            {/each}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={group.attivo} /> Attivo
        </label>
        <label
          class="check"
          title="Mostra un pulsante per accenderlo e spegnerlo nella barra in alto"
        >
          <input type="checkbox" bind:checked={group.interruttore} /> Interruttore in alto
        </label>
        <button class="danger" onclick={removeGroup} disabled={gruppi.length <= 1}>
          {confirmDelete ? 'Conferma' : 'Elimina gruppo'}
        </button>
      </div>

      <div class="tabs">
        <button
          class:active={tab === 'alias'}
          onclick={() => ((tab = 'alias'), (itemId = undefined))}
          >Alias ({groupAliases.length})</button
        >
        <button
          class:active={tab === 'trigger'}
          onclick={() => ((tab = 'trigger'), (itemId = undefined))}
          >Trigger ({groupTriggers.length})</button
        >
      </div>

      <div class="items">
        <ul>
          {#each tab === 'alias' ? groupAliases : groupTriggers as item (item.id)}
            {@const bad =
              tab === 'alias'
                ? validateAlias(item as Alias).length > 0
                : validateTrigger(item as Trigger).length > 0}
            <li>
              <input type="checkbox" bind:checked={item.attivo} title="Attivo" />
              <button
                class:active={item.id === itemId}
                class:invalid={bad}
                onclick={() => ((itemId = item.id), (sample = ''))}
              >
                {item.nome || item.pattern || '(nuovo)'}
              </button>
            </li>
          {/each}
          <li>
            <button class="add" onclick={addItem}
              >+ {tab === 'alias' ? 'Nuovo alias' : 'Nuovo trigger'}</button
            >
          </li>
        </ul>

        <div class="form">
          {#if currentAlias}
            <label>
              <span>Nome (facoltativo)</span>
              <input bind:value={currentAlias.nome} />
            </label>
            <label>
              <span
                >Quando scrivo (regex: <code>(\w+)</code> cattura una parola in
                <code>$1</code>)</span
              >
              <input bind:value={currentAlias.pattern} spellcheck="false" placeholder="kk (\w+)" />
            </label>
            <label>
              <span
                >Manda (<code>;</code> separa più comandi, <code>$1</code>… i pezzi catturati)</span
              >
              <input
                bind:value={currentAlias.azione}
                spellcheck="false"
                placeholder="kill $1;bash $1"
              />
            </label>
          {:else if currentTrigger}
            <label>
              <span>Nome (compare nell'output quando manda comandi)</span>
              <input bind:value={currentTrigger.nome} />
            </label>
            <div class="row">
              <label>
                <span>Tipo</span>
                <select bind:value={currentTrigger.tipo}>
                  <option value="testo">la riga contiene il testo</option>
                  <option value="regex">regex</option>
                </select>
              </label>
              <label class="grow">
                <span>Testo o regex da cercare</span>
                <input bind:value={currentTrigger.pattern} spellcheck="false" />
              </label>
            </div>
            <label>
              <span>Manda (vuoto = niente; con le regex <code>$1</code>… i pezzi catturati)</span>
              <input bind:value={currentTrigger.comando} spellcheck="false" />
            </label>
            <div class="row">
              <label>
                <span>Colore della riga</span>
                <div class="color">
                  <input
                    type="color"
                    value={currentTrigger.colore || '#ffd98a'}
                    oninput={(e) =>
                      currentTrigger && (currentTrigger.colore = e.currentTarget.value)}
                  />
                  {#if currentTrigger.colore}
                    <button
                      type="button"
                      class="link"
                      onclick={() => currentTrigger && (currentTrigger.colore = '')}>togli</button
                    >
                  {:else}<small>nessuno</small>{/if}
                </div>
              </label>
              <label class="check">
                <input type="checkbox" bind:checked={currentTrigger.nascondi} /> Nascondi la riga (resta
                nel log)
              </label>
            </div>
          {:else}
            <p class="hint">
              Scegli un {tab === 'alias' ? 'alias' : 'trigger'} a sinistra o creane uno nuovo. Gli alias
              valgono prima delle abbreviazioni degli incantesimi; i comandi dei trigger compaiono nell'output
              col nome del trigger.
            </p>
          {/if}

          {#if currentAlias || currentTrigger}
            <label>
              <span>Prova: {currentAlias ? 'scrivi un comando' : 'incolla una riga del MUD'}</span>
              <input bind:value={sample} spellcheck="false" />
              {#if sampleResult}<small class={sampleResult.ok ? 'ok' : 'ko'}
                  >{sampleResult.text}</small
                >{/if}
            </label>
            {#if errors.length}
              <ul class="errors">
                {#each errors as e (e)}<li>{e}</li>{/each}
              </ul>
            {/if}
            <button class="danger small" onclick={removeItem}>Elimina</button>
          {/if}
        </div>
      </div>
    </section>
  </div>

  <footer>
    <span class="grow"></span>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" onclick={save} disabled={!allValid}>Salva</button>
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
    inset: 40px;
    max-width: 1000px;
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
    border-bottom: 1px solid var(--border);
  }
  footer {
    border-top: 1px solid var(--border);
    border-bottom: 0;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 15px;
  }
  .close {
    border: 0;
    background: none;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px 1fr;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  nav > button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    border-color: transparent;
    background: none;
  }
  nav > button small {
    color: var(--text-dim);
    font-size: 11px;
  }
  nav > button.active,
  .items ul button.active,
  .tabs button.active {
    background: var(--sel-bg);
    border-color: var(--sel-border);
  }
  nav > button.off span {
    color: var(--text-dim);
    text-decoration: line-through;
  }
  .nav-title {
    margin-bottom: 4px;
    padding: 0 8px;
    color: var(--text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .add {
    margin-top: 6px;
    color: var(--accent);
  }
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 12px 16px;
    gap: 10px;
  }
  .group-form,
  .row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label > span {
    color: var(--text-dim);
    font-size: 12px;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .grow {
    flex: 1;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .items {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 14px;
  }
  .items ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
  }
  .items li {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .items ul button {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    border-color: transparent;
    background: none;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .items ul button.invalid::after {
    content: ' ⚠';
    color: var(--c-gold);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  input:not([type='checkbox']):not([type='color']) {
    font-family: var(--font-mono);
  }
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  input[type='color'] {
    width: 40px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    background: none;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.5;
  }
  small {
    color: var(--text-dim);
    font-size: 11px;
  }
  small.ok {
    color: var(--c-green);
    font-family: var(--font-mono);
  }
  small.ko {
    color: var(--c-gold);
  }
  .errors {
    margin: 0;
    padding: 8px 12px 8px 28px;
    border-radius: 6px;
    background: var(--err-bg);
    color: var(--err-text);
    font-size: 12px;
  }
  .danger {
    color: var(--c-red);
  }
  .small {
    align-self: flex-start;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 11px;
  }
</style>
