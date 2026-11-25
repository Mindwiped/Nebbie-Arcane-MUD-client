<script lang="ts">
  import { deletePassword, errorMessage, hasPassword, savePassword } from '../core/backend';
  import {
    DEFAULT_LOGIN_PROMPT,
    DEFAULT_MENU_HEADER,
    DEFAULT_MENU_LINE,
    validateAccount,
    type Account,
  } from '../nebbie/profiles/profiles';

  /**
   * Account di gioco, comune a tutti i personaggi. La password va direttamente nel
   * portachiavi del sistema: qui non viene mai riletta né mostrata.
   */
  let { account = $bindable() }: { account: Account } = $props();

  let password = $state('');
  let saved = $state<boolean | null>(null);
  let message = $state<{ ok: boolean; text: string } | null>(null);

  const errors = $derived(validateAccount(account));

  // Controlla se c'è una password salvata per server+utente correnti.
  $effect(() => {
    const host = account.host.trim();
    const user = account.utente.trim();
    saved = null;
    if (!host || !user) return;
    const timer = setTimeout(async () => {
      try {
        saved = await hasPassword(host, user);
      } catch (e) {
        message = { ok: false, text: errorMessage(e) };
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  async function store() {
    try {
      await savePassword(account.host, account.utente, password);
      password = '';
      saved = true;
      message = { ok: true, text: 'Password salvata nel portachiavi.' };
    } catch (e) {
      message = { ok: false, text: errorMessage(e) };
    }
  }

  async function forget() {
    try {
      await deletePassword(account.host, account.utente);
      saved = false;
      message = { ok: true, text: 'Password tolta dal portachiavi.' };
    } catch (e) {
      message = { ok: false, text: errorMessage(e) };
    }
  }
</script>

<div class="account">
  <p class="intro">
    Valgono per tutti i personaggi: su Nebbie si entra con l'account e poi si sceglie il pg.
  </p>
  <div class="row">
    <label class="grow">
      <span>Server</span>
      <input bind:value={account.host} />
    </label>
    <label>
      <span>Porta</span>
      <input type="number" min="1" max="65535" bind:value={account.port} />
    </label>
    <label>
      <span>Codifica</span>
      <select bind:value={account.encoding}>
        <option value="utf8">UTF-8 (con ripiego Latin-1)</option>
        <option value="latin1">ISO-8859-1</option>
      </select>
    </label>
  </div>

  <label>
    <span>Email o nome dell'account</span>
    <input bind:value={account.utente} autocomplete="off" spellcheck="false" />
  </label>

  <div class="password">
    <label class="grow">
      <span>
        Codice di accesso (password)
        {#if saved === true}<b class="ok">· salvato nel portachiavi</b>{/if}
        {#if saved === false}<b class="ko">· non salvato</b>{/if}
      </span>
      <input
        type="password"
        bind:value={password}
        autocomplete="off"
        placeholder={saved ? 'scrivi qui per sostituirlo' : 'scrivi il codice di accesso'}
      />
    </label>
    <button
      type="button"
      class="primary"
      onclick={store}
      disabled={!password || !account.utente.trim() || !account.host.trim()}
    >
      Salva nel portachiavi
    </button>
    {#if saved}
      <button type="button" onclick={forget}>Togli</button>
    {/if}
  </div>
  <small>
    La password non viene scritta nei file del client né nei log: è cifrata dal portachiavi di
    macOS, e il client la legge solo per mandarla al server.
  </small>
  {#if message}
    <small class={message.ok ? 'ok' : 'ko'}>{message.text}</small>
  {/if}

  <label class="check">
    <input type="checkbox" bind:checked={account.accessoAutomatico} />
    <span>
      Accesso automatico: manda utente e password e sceglie il personaggio del profilo dal menu.
      Ogni passo viene scritto nell'output.
    </span>
  </label>

  <details>
    <summary>Avanzate: testi del MUD usati per l'accesso</summary>
    <label>
      <span>Richiesta del nome utente</span>
      <input bind:value={account.promptUtente} spellcheck="false" />
    </label>
    <label>
      <span>Intestazione del menu dei personaggi</span>
      <input bind:value={account.menuPg} spellcheck="false" />
    </label>
    <label>
      <span>Riga del menu (gruppi num e nome)</span>
      <input bind:value={account.rigaMenu} spellcheck="false" />
    </label>
    <button
      type="button"
      class="link"
      onclick={() => {
        account.promptUtente = DEFAULT_LOGIN_PROMPT;
        account.menuPg = DEFAULT_MENU_HEADER;
        account.rigaMenu = DEFAULT_MENU_LINE;
      }}>ripristina predefiniti</button
    >
  </details>

  {#if errors.length}
    <ul class="errors">
      {#each errors as e (e)}<li>{e}</li>{/each}
    </ul>
  {/if}
</div>

<style>
  .account {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .intro {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
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
  .row,
  .password {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }
  .grow {
    flex: 1;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  input:not([type='checkbox']) {
    font-family: var(--font-mono);
  }
  details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  details[open] {
    padding-bottom: 4px;
  }
  details label {
    margin-top: 8px;
  }
  summary {
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
  }
  small {
    color: var(--text-dim);
    font-size: 11px;
  }
  .ok {
    color: var(--c-green);
  }
  .ko {
    color: var(--c-gold);
  }
  b {
    font-weight: 500;
  }
  .link {
    align-self: flex-start;
    margin-top: 6px;
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
</style>
