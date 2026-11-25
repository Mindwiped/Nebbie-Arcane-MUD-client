<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import {
    describeActions,
    describeCondition,
    EVENT_LABELS,
    newRuleId,
    type Rule,
    type RuleEvent,
  } from '../../core/rules/rules';
  import { MUDLET_KEEP, type KeepEntry } from '../../nebbie/keep/keepActive';
  import { spellNames as allSpellNames } from '../../nebbie/spells/abbreviations';

  /**
   * Pannello Automatismi (SPECIFICA 5.4): incantesimi da mantenere, regole sullo stato,
   * ultime azioni. Ogni cosa ha il suo interruttore; tutto quello che parte si vede qui e
   * nell'output.
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  const spellNames = $derived.by(() => {
    void sessionState.auto.versione;
    return allSpellNames(session.spells);
  });

  // La configurazione si rilegge quando cambia la versione o arriva un'azione.
  const cfg = $derived.by(() => {
    void sessionState.auto.versione;
    void sessionState.auto.azioni.length;
    const c = session.autoConfig;
    return c ? structuredClone(c) : null;
  });
  const waiting = $derived(new Map(sessionState.auto.attesa.map((a) => [a.nome, a])));

  let newSpell = $state('');
  let draft = $state<Rule | undefined>();
  let draftCmds = $state('');
  let draftAlert = $state('');

  function update(change: Parameters<Session['updateAutoConfig']>[0]) {
    session.updateAutoConfig(change);
  }

  function addSpell() {
    const n = newSpell.trim().toLowerCase();
    if (!n) return;
    update((c) => {
      c.mantieni.voci = [
        ...c.mantieni.voci.filter((v) => v.incantesimo !== n),
        { incantesimo: n, bersaglio: '{pg}' },
      ];
    });
    newSpell = '';
  }

  function addMudlet() {
    update((c) => {
      const have = new Set(c.mantieni.voci.map((v) => v.incantesimo));
      c.mantieni.voci = [
        ...c.mantieni.voci,
        ...MUDLET_KEEP.filter((v) => !have.has(v.incantesimo)),
      ];
    });
  }

  function setEntry(i: number, patch: Partial<KeepEntry>) {
    update((c) => (c.mantieni.voci[i] = { ...c.mantieni.voci[i], ...patch }));
  }

  function editRule(r?: Rule) {
    draft = r
      ? structuredClone($state.snapshot(r) as Rule)
      : {
          id: newRuleId(),
          nome: '',
          attiva: true,
          quando: { tipo: 'valore', campo: 'hp', op: '<', soglia: 100 },
          allora: [],
          attesa: 5,
          combattimento: 'sempre',
        };
    draftCmds = draft.allora
      .filter((a) => a.tipo === 'comandi')
      .map((a) => a.testo)
      .join(';');
    draftAlert = draft.allora.find((a) => a.tipo === 'avviso')?.testo ?? '';
  }

  function setKind(kind: 'valore' | 'evento') {
    if (!draft || draft.quando.tipo === kind) return;
    draft.quando =
      kind === 'valore'
        ? { tipo: 'valore', campo: 'hp', op: '<', soglia: 100 }
        : { tipo: 'evento', evento: 'mobUcciso' };
  }

  function saveRule() {
    if (!draft) return;
    const r = $state.snapshot(draft) as Rule;
    r.allora = [
      ...(draftCmds.trim() ? [{ tipo: 'comandi' as const, testo: draftCmds.trim() }] : []),
      ...(draftAlert.trim() ? [{ tipo: 'avviso' as const, testo: draftAlert.trim() }] : []),
    ];
    if (!r.nome.trim()) r.nome = `${describeCondition(r.quando)} → ${describeActions(r.allora)}`;
    update((c) => {
      const i = c.regole.voci.findIndex((x) => x.id === r.id);
      if (i >= 0) c.regole.voci[i] = r;
      else c.regole.voci.push(r);
    });
    draft = undefined;
  }

  function delRule(r: Rule) {
    if (confirm(`Eliminare la regola "${r.nome}"?`))
      update((c) => (c.regole.voci = c.regole.voci.filter((x) => x.id !== r.id)));
  }

  const time = (t: number) =>
    new Date(t).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
</script>

<div class="panel">
  {#if !cfg}
    <p class="dim pad">Scegli un profilo.</p>
  {:else if draft}
    <div class="editor">
      <h4>Regola</h4>
      <label>Nome <input bind:value={draft.nome} placeholder="(automatico)" /></label>
      <div class="kind">
        Quando
        <label class="inline"
          ><input
            type="radio"
            checked={draft.quando.tipo === 'valore'}
            onchange={() => setKind('valore')}
          /> un valore</label
        >
        <label class="inline"
          ><input
            type="radio"
            checked={draft.quando.tipo === 'evento'}
            onchange={() => setKind('evento')}
          /> succede qualcosa</label
        >
      </div>
      {#if draft.quando.tipo === 'valore'}
        <div class="row">
          <select bind:value={draft.quando.campo}>
            <option value="hp">HP</option>
            <option value="mp">MP</option>
            <option value="mv">MV</option>
            <option value="oro">oro</option>
          </select>
          <select bind:value={draft.quando.op}>
            <option value="<">sotto</option>
            <option value=">">sopra</option>
          </select>
          <input type="number" bind:value={draft.quando.soglia} class="num" />
          <label class="inline"
            ><input type="checkbox" bind:checked={draft.quando.percento} /> %</label
          >
        </div>
      {:else}
        <div class="row">
          <select bind:value={draft.quando.evento}>
            {#each Object.entries(EVENT_LABELS) as [k, l] (k)}
              <option value={k as RuleEvent}>{l}</option>
            {/each}
          </select>
          <input bind:value={draft.quando.filtro} placeholder="solo se contiene… (facoltativo)" />
        </div>
      {/if}
      <label
        >Comandi (separati da ;, <code>{'{pg}'}</code> = te, <code>{'{nome}'}</code> = mob,
        incantesimo, stanza o monete)
        <input
          bind:value={draftCmds}
          spellcheck="false"
          placeholder="cast 'second wind' {'{pg}'}"
        /></label
      >
      <label>Avviso nell'output (facoltativo) <input bind:value={draftAlert} /></label>
      <div class="row">
        <label class="inline"
          >Attesa minima <input type="number" min="0" bind:value={draft.attesa} class="num" /> s</label
        >
        <select bind:value={draft.combattimento}>
          <option value="sempre">sempre</option>
          <option value="solo">solo in combattimento</option>
          <option value="fuori">solo fuori combattimento</option>
        </select>
      </div>
      <div class="row">
        <button class="primary" onclick={saveRule}>Salva</button>
        <button onclick={() => (draft = undefined)}>Annulla</button>
      </div>
    </div>
  {:else}
    <div class="body">
      <section>
        <h4>
          <label class="inline"
            ><input
              type="checkbox"
              checked={cfg.mantieni.attivo}
              onchange={() => session.toggleModule('mantieni')}
            /> Mantieni attivi</label
          >
        </h4>
        <p class="dim">
          Rilancia quando l'incantesimo finisce. In combattimento aspetta la fine e il loot del
          cadavere.
        </p>
        {#each cfg.mantieni.voci as e, i (e.incantesimo)}
          {@const w = waiting.get(e.incantesimo)}
          <div class="keep" class:spento={e.attivo === false}>
            <span
              class="name"
              title={cfg.costi[e.incantesimo]
                ? `${cfg.costi[e.incantesimo]} mana`
                : 'costo non ancora noto'}
              >{e.incantesimo}{#if cfg.costi[e.incantesimo]}<small>
                  {cfg.costi[e.incantesimo]} mp</small
                >{/if}</span
            >
            <input
              class="target"
              value={e.bersaglio}
              title="Bersaglio: {'{pg}'} = te, vuoto = nessuno"
              onchange={(ev) => setEntry(i, { bersaglio: (ev.target as HTMLInputElement).value })}
            />
            <button title="Lancia adesso" onclick={() => session.keep.castNow(e.incantesimo)}
              >⟳</button
            >
            <button
              class="auto"
              class:off={e.attivo === false}
              title={e.attivo === false
                ? 'Rilancio automatico spento: clic per riaccenderlo'
                : 'Rilancio automatico acceso: clic per spegnerlo (resta in elenco)'}
              aria-pressed={e.attivo !== false}
              onclick={() => setEntry(i, { attivo: e.attivo === false })}
              >{e.attivo === false ? 'auto off' : 'auto'}</button
            >
            <button
              class="x"
              title="Togli"
              onclick={() =>
                update((c) => (c.mantieni.voci = c.mantieni.voci.filter((_, j) => j !== i)))}
              >✕</button
            >
          </div>
          {#if w}<div class="wait">
              ↻ {w.motivo}{w.tentativi ? ` (tentativo ${w.tentativi})` : ''}
            </div>{/if}
        {:else}
          <p class="dim">Nessun incantesimo.</p>
        {/each}
        <div class="row">
          <input
            list="spell-names"
            bind:value={newSpell}
            placeholder="incantesimo"
            spellcheck="false"
          />
          <datalist id="spell-names">
            {#each spellNames as n (n)}<option value={n}></option>{/each}
          </datalist>
          <button onclick={addSpell} disabled={!newSpell.trim()}>Aggiungi</button>
        </div>
        <button class="link" onclick={addMudlet}
          >Aggiungi quelli rinnovati dal pacchetto Mudlet (stone skin, invulnerability, armor…)</button
        >
      </section>

      <section>
        <h4>
          <label class="inline"
            ><input
              type="checkbox"
              checked={cfg.regole.attivo}
              onchange={() => session.toggleModule('regole')}
            /> Regole</label
          >
        </h4>
        {#each cfg.regole.voci as r (r.id)}
          {@const st = session.ruleStats(r.id)}
          <div class="rule" class:off={!r.attiva}>
            <input
              type="checkbox"
              checked={r.attiva}
              title="Accesa"
              onchange={() =>
                update((c) => {
                  const x = c.regole.voci.find((v) => v.id === r.id);
                  if (x) x.attiva = !x.attiva;
                })}
            />
            <button class="rule-text" onclick={() => editRule(r)} title="Modifica">
              <span>{r.nome}</span>
              <small
                >quando {describeCondition(r.quando)} → {describeActions(r.allora) ||
                  'niente'}</small
              >
            </button>
            {#if st.volte}<small class="count" title="scatti in questa sessione">{st.volte}×</small
              >{/if}
            <button class="x" title="Elimina" onclick={() => delRule(r)}>✕</button>
          </div>
        {/each}
        <button onclick={() => editRule()}>Nuova regola</button>
      </section>

      <section>
        <h4>Ultime azioni</h4>
        {#each sessionState.auto.azioni as a, i (a.ora + ':' + i)}
          <div class="action"><small>{time(a.ora)}</small> {a.testo}</div>
        {:else}
          <p class="dim">Ancora niente.</p>
        {/each}
      </section>
    </div>
  {/if}
</div>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .body,
  .editor {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 10px 10px;
  }
  .pad {
    padding: 10px;
  }
  section {
    margin-bottom: 12px;
  }
  h4 {
    margin: 4px 0 6px;
    color: var(--c-blue);
    font-weight: 500;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
  }
  .row input:not([type='checkbox']):not(.num) {
    flex: 1;
    min-width: 0;
  }
  .keep,
  .rule {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .keep .name {
    flex: 1;
    min-width: 0;
  }
  .target {
    width: 80px;
  }
  .auto {
    min-width: 58px;
    color: var(--c-green);
  }
  .auto.off {
    color: var(--text-dim);
  }
  .spento .name {
    color: var(--text-dim);
    text-decoration: line-through;
  }
  .wait {
    margin: 0 0 2px 8px;
    color: var(--c-gold);
    font-size: 11px;
  }
  .rule.off .rule-text {
    opacity: 0.55;
  }
  .rule-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    border: 0;
    background: none;
    text-align: left;
    padding: 2px 0;
  }
  .rule-text small,
  small,
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .count {
    color: var(--c-green);
  }
  .action {
    font-size: 12px;
    padding: 1px 0;
  }
  button {
    padding: 1px 8px;
    font-size: 12px;
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
    padding: 2px 0;
    text-align: left;
  }
  .editor label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .editor label.inline,
  label.inline {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    margin: 0;
  }
  .kind {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 12px;
    margin: 6px 0;
  }
  .num {
    width: 70px;
  }
</style>
