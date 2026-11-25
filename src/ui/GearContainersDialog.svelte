<script lang="ts">
  import { defaultPlace, keyword, type Container, type GearConfig } from '../nebbie/gear/config';
  import type { GearSnapshot } from '../nebbie/gear/model';

  /**
   * Contenitori del vestiario, per personaggio (richiesta dell'utente del 2026-11-16): ogni pg
   * ha i suoi nomi, o un solo contenitore, o nessuno. Si sceglie dove cercare i pezzi da
   * indossare e dove vanno quelli tolti. Si apre da sola al primo cambio di set.
   */
  let {
    cfg,
    modello,
    inAttesa,
    onsave,
    onclose,
  }: {
    cfg: GearConfig;
    /** Quello che il client ha visto addosso e in inventario (proposte di contenitori). */
    modello?: GearSnapshot;
    /** Nome del set che aspetta questa scelta per partire. */
    inAttesa?: string;
    onsave: (contenitori: Container[], destinazione: string) => void;
    onclose: () => void;
  } = $props();

  interface Row {
    parola: string;
    nome: string;
    dove: Container['dove'];
    in: string;
    togli: boolean;
  }

  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(
    cfg.contenitori.map((c) => ({
      parola: c.parola,
      nome: c.nome && c.nome !== c.parola ? c.nome : '',
      dove: c.dove,
      in: c.in ?? '',
      togli: c.togliPerUsare === true,
    })),
  );
  // svelte-ignore state_referenced_locally
  let destinazione = $state(cfg.contenitori.length ? defaultPlace(cfg) : 'inv');
  let proposta = $state('');

  /** Oggetti visti addosso e in inventario: uno di questi è probabilmente un contenitore. */
  const visti = $derived.by(() => {
    const out: { nome: string; dove: Container['dove'] }[] = [];
    for (const r of modello?.addosso.righe ?? []) out.push({ nome: r.nome, dove: 'indossato' });
    for (const r of modello?.inventario.righe ?? []) out.push({ nome: r.nome, dove: 'inventario' });
    return out.filter((v) => !rows.some((r) => r.nome === v.nome));
  });

  const parole = $derived(rows.map((r) => r.parola.trim().toLowerCase()).filter(Boolean));
  const doppie = $derived(parole.filter((p, i) => parole.indexOf(p) !== i));
  const errore = $derived.by(() => {
    if (rows.some((r) => !r.parola.trim()))
      return 'Ogni contenitore ha bisogno della parola chiave.';
    if (rows.some((r) => /\s/.test(r.parola.trim())))
      return 'La parola chiave è una parola sola (quella che usi in get/put).';
    if (doppie.length) return `Parola chiave ripetuta: ${doppie[0]}.`;
    for (const r of rows)
      if (r.dove === 'dentro' && !parole.includes(r.in.trim().toLowerCase()))
        return `Scegli in quale contenitore sta "${r.parola}".`;
    return '';
  });

  function addSeen() {
    const v = visti.find((x) => x.nome === proposta);
    if (!v) return;
    rows.push({
      parola: keyword(v.nome, cfg),
      nome: v.nome,
      dove: v.dove,
      in: '',
      togli: false,
    });
    if (rows.length === 1) destinazione = rows[0].parola;
    proposta = '';
  }

  function addEmpty() {
    rows.push({ parola: '', nome: '', dove: 'indossato', in: '', togli: false });
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  function remove(i: number) {
    const [r] = rows.splice(i, 1);
    if (destinazione === r.parola.trim().toLowerCase()) destinazione = 'inv';
  }

  function save() {
    if (errore) return;
    const contenitori: Container[] = rows.map((r) => {
      const parola = r.parola.trim().toLowerCase();
      const c: Container = { parola, nome: r.nome.trim() || parola, dove: r.dove };
      if (r.dove === 'dentro') c.in = r.in.trim().toLowerCase();
      if (r.togli) c.togliPerUsare = true;
      return c;
    });
    const d = destinazione === 'inv' || parole.includes(destinazione) ? destinazione : 'inv';
    onsave(contenitori, d);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="gc-title"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
>
  <header><h2 id="gc-title">Contenitori per il cambio di set</h2></header>
  <div class="body">
    {#if inAttesa}
      <p class="note">
        Prima di indossare il set <b>{inAttesa}</b>: in quali contenitori tieni l'equipaggiamento?
      </p>
    {/if}
    <p>
      I pezzi da indossare si cercano in <b>inventario</b> e poi nei contenitori qui sotto, nell'ordine
      della lista. Se non usi contenitori lascia la lista vuota.
    </p>

    {#if rows.length}
      <table>
        <thead>
          <tr>
            <th title="La parola che usi nei comandi: get x <parola>, put x <parola>">Parola</th>
            <th title="Parte del nome come appare in eq/inventario (vuoto = la parola)">Nome</th>
            <th>Dove sta</th>
            <th title="Va tolto di dosso per guardarci dentro (exa non funziona se lo indossi)"
              >Togli</th
            >
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r, i (i)}
            <tr>
              <td><input class="w-parola" bind:value={r.parola} spellcheck="false" /></td>
              <td
                ><input
                  class="w-nome"
                  bind:value={r.nome}
                  placeholder={r.parola}
                  spellcheck="false"
                /></td
              >
              <td class="dove">
                <select bind:value={r.dove}>
                  <option value="indossato">indossato</option>
                  <option value="inventario">in inventario</option>
                  <option value="dentro">dentro…</option>
                </select>
                {#if r.dove === 'dentro'}
                  <select bind:value={r.in}>
                    <option value="" disabled>quale?</option>
                    {#each rows.filter((x, j) => j !== i && x.parola.trim()) as o (o.parola)}
                      <option value={o.parola.trim().toLowerCase()}>{o.parola}</option>
                    {/each}
                  </select>
                {/if}
              </td>
              <td class="c"><input type="checkbox" bind:checked={r.togli} /></td>
              <td class="act">
                <button title="Su" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
                <button title="Giù" disabled={i === rows.length - 1} onclick={() => move(i, 1)}
                  >↓</button
                >
                <button title="Togli dalla lista" onclick={() => remove(i)}>✕</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="dim">Nessun contenitore: i pezzi si prendono e si lasciano in inventario.</p>
    {/if}

    <div class="add">
      {#if visti.length}
        <select bind:value={proposta}>
          <option value="">Aggiungi un oggetto che hai…</option>
          {#each visti as v (v.dove + v.nome)}
            <option value={v.nome}
              >{v.nome} ({v.dove === 'indossato' ? 'addosso' : 'inventario'})</option
            >
          {/each}
        </select>
        <button disabled={!proposta} onclick={addSeen}>Aggiungi</button>
      {:else}
        <small class="dim">Scrivi eq e inv (o premi Aggiorna) per vedere qui i tuoi oggetti.</small>
      {/if}
      <button onclick={addEmpty}>+ a mano</button>
    </div>

    <label class="dest">
      I pezzi tolti vanno in:
      <select bind:value={destinazione}>
        <option value="inv">inventario</option>
        {#each parole as p (p)}<option value={p}>{p}</option>{/each}
      </select>
    </label>
    <small class="dim"
      >Un pezzo preso da un contenitore, quando lo togli, torna lì. Per un oggetto preciso:
      <code>eqset posto &lt;contenitore&gt; = &lt;nome&gt;</code>.</small
    >
    {#if errore}<p class="err">{errore}</p>{/if}
  </div>
  <footer>
    <button onclick={onclose}>Annulla</button>
    <button class="primary" disabled={!!errore} onclick={save}
      >{inAttesa ? 'Salva e cambia set' : 'Salva'}</button
    >
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
    top: 80px;
    left: 0;
    right: 0;
    width: min(680px, calc(100% - 32px));
    max-height: calc(100% - 120px);
    display: flex;
    flex-direction: column;
    margin: 0 auto;
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
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    overflow-y: auto;
  }
  p {
    margin: 0;
  }
  .note {
    color: var(--c-gold);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--text-dim);
    font-size: 11px;
    padding: 0 4px 2px 0;
  }
  td {
    padding: 2px 4px 2px 0;
  }
  .w-parola {
    width: 90px;
  }
  .w-nome {
    width: 100%;
    min-width: 120px;
  }
  .dove {
    white-space: nowrap;
  }
  .c {
    text-align: center;
  }
  .act {
    white-space: nowrap;
  }
  .act button {
    padding: 0 6px;
  }
  .add,
  .dest {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .add select {
    flex: 1;
    min-width: 0;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .err {
    color: var(--c-red);
  }
</style>
