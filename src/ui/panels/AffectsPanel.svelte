<script lang="ts">
  import type { Session, SessionState } from '../../core/session';
  import { formatRemaining } from '../../nebbie/affects/affectTimers';

  /**
   * Pannello Effetti: timer degli incantesimi con conto alla rovescia (da `att` o dalla durata
   * imparata al lancio), effetti attivi secondo il prompt, tank e bersaglio.
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  /**
   * Incantesimi in "Mantieni attivi" (↻): true = si rilancia da solo, false = spento per questo
   * incantesimo. Clic sul ↻ per accenderlo o spegnerlo (richiesta del 2026-11-18).
   */
  const kept = $derived.by(() => {
    void sessionState.auto.versione;
    const m = session.autoConfig?.mantieni;
    return new Map(
      m?.attivo ? m.voci.map((v) => [v.incantesimo.toLowerCase(), v.attivo !== false]) : [],
    );
  });

  function toggleKeep(nome: string) {
    const n = nome.toLowerCase();
    session.updateAutoConfig((c) => {
      const v = c.mantieni.voci.find((x) => x.incantesimo.toLowerCase() === n);
      if (v) v.attivo = v.attivo === false;
    });
  }

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const flags = $derived(sessionState.affetti);
  const att = $derived(sessionState.att);
  const timers = $derived(sessionState.timers);

  /** Negli ultimi 30 secondi il timer diventa rosso. */
  const URGENT_MS = 30_000;

  function time(ms: number): string {
    return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="panel">
  {#if sessionState.tank || sessionState.target}
    <div class="fight">
      <span>Tank <b>{sessionState.tank ?? '—'}</b></span>
      <span>Bersaglio <b>{sessionState.target ?? '—'}</b></span>
    </div>
  {/if}

  <h4>
    Timer
    {#if att}<small>· att letto alle {time(att.letto)}</small>{/if}
  </h4>
  {#if timers.length === 0}
    <p class="empty">
      Scrivi <code>att</code> per avviare i timer; dopo il primo lancio e la prima fine di un incantesimo
      la durata viene ricordata.
    </p>
  {:else}
    <ul>
      {#each timers as t (t.nome)}
        {@const left = t.fine - now}
        <li class:urgent={left <= URGENT_MS} class:warned={t.avviso}>
          <span class="name"
            >{t.nome}{#if kept.has(t.nome.toLowerCase())}
              {@const on = kept.get(t.nome.toLowerCase())}
              <button
                class="kept"
                class:off={!on}
                aria-pressed={on}
                title={on
                  ? 'Rilanciato da Mantieni attivi: clic per non rilanciarlo più'
                  : 'Rilancio automatico spento: clic per riaccenderlo'}
                onclick={() => toggleKeep(t.nome)}>↻</button
              >{/if}</span
          >
          <span
            class="time"
            title={t.fonte === 'att'
              ? 'Da att: finisce al (durata + 1)° tick'
              : t.fonte === 'prompt'
                ? 'Dalla lettera nel prompt, durata imparata'
                : 'Dal lancio, durata imparata'}>~{formatRemaining(left)}</span
          >
        </li>
      {/each}
    </ul>
  {/if}

  <h4>Dal prompt</h4>
  {#if flags === undefined}
    <p class="empty">Il prompt non mostra gli effetti.</p>
  {:else if flags.length === 0}
    <p class="empty">Nessun effetto attivo.</p>
  {:else}
    <ul>
      {#each flags as f (f.lettera)}
        <li class:warned={f.inScadenza}>
          <span class="letter">{f.inScadenza ? f.lettera.toLowerCase() : f.lettera}</span>
          <span class="name">{f.incantesimo ?? 'sconosciuto'}</span>
          {#if f.inScadenza}<em>in scadenza</em>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .kept {
    padding: 0 3px;
    border: 0;
    background: none;
    color: var(--c-green);
    font-size: 11px;
    cursor: pointer;
  }
  .kept.off {
    color: var(--text-dim);
    text-decoration: line-through;
  }
  .panel {
    height: 100%;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 13px;
  }
  .fight {
    display: flex;
    gap: 14px;
    margin-bottom: 6px;
    color: var(--text-dim);
  }
  .fight b {
    color: var(--text);
    font-weight: 500;
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  h4 small {
    text-transform: none;
    letter-spacing: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .letter {
    width: 18px;
    text-align: center;
    border-radius: 3px;
    background: var(--tag-blue-bg);
    color: var(--tag-blue-fg);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .name {
    flex: 1;
  }
  .time {
    font-family: var(--font-mono);
    color: var(--text-dim);
  }
  .warned .letter {
    background: var(--tag-amber-bg);
    color: var(--tag-amber-fg);
  }
  .warned .name,
  .warned .time {
    color: var(--c-gold);
  }
  .urgent .name,
  .urgent .time {
    color: var(--c-red);
  }
  em {
    color: var(--c-gold);
    font-size: 11px;
  }
  .empty {
    margin: 0;
    color: var(--text-dim);
  }
</style>
