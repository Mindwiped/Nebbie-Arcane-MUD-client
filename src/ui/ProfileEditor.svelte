<script lang="ts">
  import {
    compilePromptRegex,
    DEFAULT_PROMPT_REGEX,
    findPrompt,
  } from '../nebbie/prompt/promptParser';
  import {
    newId,
    newProfile,
    validateAccount,
    validateProfile,
    type Account,
    type Profile,
    type ProfilesFile,
  } from '../nebbie/profiles/profiles';
  import AccountForm from './AccountForm.svelte';

  const ACCOUNT = '__account';

  /**
   * Editor dei profili di personaggio. Lavora su una copia: niente cambia finché non si salva.
   */
  let {
    file,
    selectedId,
    section,
    onsave,
    onclose,
  }: {
    file: ProfilesFile;
    selectedId: string | undefined;
    /** Sezione da aprire: 'account' per andare subito ad account e accesso. */
    section?: 'account';
    onsave: (file: ProfilesFile, selectedId: string | undefined) => void;
    onclose: () => void;
  } = $props();

  // Copia di lavoro presa all'apertura (l'editor si rimonta a ogni apertura).
  // svelte-ignore state_referenced_locally
  const initial = $state.snapshot(file) as ProfilesFile;
  let profiles = $state<Profile[]>(
    initial.profili.length ? initial.profili : [newProfile('Nuovo personaggio')],
  );
  let account = $state<Account>(initial.account);
  // Al primo uso (account senza utente) si parte dalla sezione Account.
  // svelte-ignore state_referenced_locally
  // Si apre su "Account e accesso" se richiesto o se l'account non è ancora impostato.
  let currentId = $state(
    section === 'account' || !initial.account.utente.trim()
      ? ACCOUNT
      : (selectedId ?? profiles[0].id),
  );
  // svelte-ignore state_referenced_locally
  let lastProfileId = $state(selectedId ?? profiles[0].id);
  let sample = $state('');
  let confirmDelete = $state(false);

  const current = $derived(profiles.find((p) => p.id === currentId) ?? profiles[0]);
  const errors = $derived(current ? validateProfile(current) : []);
  const accountValid = $derived(validateAccount(account).length === 0);
  const allValid = $derived(accountValid && profiles.every((p) => validateProfile(p).length === 0));

  function select(id: string) {
    currentId = id;
    if (id !== ACCOUNT) lastProfileId = id;
    confirmDelete = false;
  }

  const sampleResult = $derived.by(() => {
    if (!sample.trim() || !current) return null;
    try {
      const m = findPrompt(sample, compilePromptRegex(current.promptRegex));
      if (!m) return { ok: false, text: 'Nessun prompt riconosciuto in questa riga.' };
      const { raw: _raw, ...fields } = m.data;
      const list = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ');
      return {
        ok: true,
        text: list || 'Riconosciuto, ma senza campi (mancano i gruppi con nome).',
      };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  });

  function add() {
    const p = newProfile('Nuovo personaggio');
    profiles.push(p);
    select(p.id);
  }

  function duplicate() {
    if (!current) return;
    const copy: Profile = {
      ...$state.snapshot(current),
      id: newId(),
      nome: `${current.nome} (copia)`,
    };
    profiles.push(copy);
    select(copy.id);
  }

  function remove() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    confirmDelete = false;
    profiles = profiles.filter((p) => p.id !== currentId);
    if (profiles.length === 0) profiles.push(newProfile('Nuovo personaggio'));
    select(profiles[0].id);
  }

  function setMax(key: 'hp' | 'mp' | 'mv', raw: string) {
    const n = Number(raw);
    current.max[key] = raw.trim() === '' || !Number.isFinite(n) ? undefined : n;
  }

  function save() {
    if (!allValid) return;
    const snapshot = $state.snapshot(profiles) as Profile[];
    const acc = $state.snapshot(account) as Account;
    onsave({ ...initial, account: acc, profili: snapshot }, lastProfileId);
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Profili di personaggio">
  <header>
    <h2>Profili di personaggio</h2>
    <button class="close" onclick={onclose} aria-label="Chiudi">✕</button>
  </header>

  <div class="body">
    <nav>
      <button
        class:active={currentId === ACCOUNT}
        class:invalid={!accountValid}
        onclick={() => select(ACCOUNT)}>Account e accesso</button
      >
      <div class="nav-title">Personaggi</div>
      {#each profiles as p (p.id)}
        <button
          class:active={p.id === currentId}
          class:invalid={validateProfile(p).length > 0}
          onclick={() => select(p.id)}>{p.nome || '(senza nome)'}</button
        >
      {/each}
      <div class="nav-actions">
        <button onclick={add}>+ Nuovo</button>
        <button onclick={duplicate}>Duplica</button>
      </div>
    </nav>

    {#if currentId === ACCOUNT}
      <form onsubmit={(e) => e.preventDefault()}>
        <AccountForm bind:account />
      </form>
    {:else if current}
      <form onsubmit={(e) => e.preventDefault()}>
        <label>
          <span>Nome del personaggio (come appare nel menu di accesso)</span>
          <input bind:value={current.nome} />
        </label>

        <label>
          <span>
            Regex del prompt
            <button
              type="button"
              class="link"
              onclick={() => (current.promptRegex = DEFAULT_PROMPT_REGEX)}
              >ripristina predefinita</button
            >
          </span>
          <textarea rows="3" spellcheck="false" bind:value={current.promptRegex}></textarea>
          <small>
            Gruppi con nome riconosciuti: nome, hp, hpMax, mp, mpMax, mv, mvMax, xp, oro, banca. Non
            scrivere il nome del personaggio nella regex: catturalo con <code>(?&lt;nome&gt;…)</code
            >.
          </small>
        </label>
        <label>
          <span>Prova la regex: incolla una riga con il prompt</span>
          <input
            bind:value={sample}
            spellcheck="false"
            placeholder="es. Nome H481 M493 V247 X-28602993 [T] */*>>"
          />
          {#if sampleResult}
            <small class={sampleResult.ok ? 'ok' : 'ko'}>{sampleResult.text}</small>
          {/if}
        </label>

        <fieldset>
          <legend>Massimi (finché il prompt non li mostra)</legend>
          <div class="row">
            {#each ['hp', 'mp', 'mv'] as const as key (key)}
              <label>
                <span>{key.toUpperCase()} max</span>
                <input
                  type="number"
                  min="1"
                  value={current.max[key] ?? ''}
                  oninput={(e) => setMax(key, e.currentTarget.value)}
                  placeholder="stima"
                />
              </label>
            {/each}
          </div>
        </fieldset>

        <label class="check">
          <input type="checkbox" bind:checked={current.log} />
          <span>Registra le sessioni su disco (le password non vengono mai registrate)</span>
        </label>

        <label class="check">
          <input type="checkbox" bind:checked={current.abbreviazioni} />
          <span>
            Abbreviazioni degli incantesimi (<code>mm orco</code> →
            <code>cast 'magic missile' orco</code>). Attenzione: parole come <code>port</code>,
            <code>mount</code>, <code>knock</code>,
            <code>summon</code> non arrivano più al MUD come comandi.
          </span>
        </label>

        {#if errors.length}
          <ul class="errors">
            {#each errors as e (e)}<li>{e}</li>{/each}
          </ul>
        {/if}
      </form>
    {/if}
  </div>

  <footer>
    <button class="danger" onclick={remove} disabled={currentId === ACCOUNT}>
      {confirmDelete ? 'Conferma eliminazione' : 'Elimina profilo'}
    </button>
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
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 20px 60px #000a;
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
    grid-template-columns: 200px 1fr;
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
    text-align: left;
    border-color: transparent;
    background: none;
  }
  nav > button.active {
    background: var(--sel-bg);
    border-color: var(--sel-border);
  }
  nav > button.invalid::after {
    content: ' ⚠';
    color: var(--c-gold);
  }
  .nav-title {
    margin: 10px 0 2px;
    padding: 0 8px;
    color: var(--text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .nav-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    overflow-y: auto;
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
  .row {
    display: flex;
    gap: 10px;
  }
  .grow {
    flex: 1;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  textarea,
  input:not([type='checkbox']) {
    font-family: var(--font-mono);
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px 12px;
  }
  legend {
    color: var(--text-dim);
    font-size: 12px;
    padding: 0 4px;
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
  .link {
    margin-left: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 11px;
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
</style>
