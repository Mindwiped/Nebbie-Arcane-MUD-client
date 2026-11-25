<script lang="ts">
  import type { Session, SessionState } from '../core/session';

  /**
   * Striscia sopra la riga di comando (SPECIFICA 5.1): sequenza in corso o ferma, con Pausa,
   * Stop, Riprendi, Salta; registrazione `rec` in corso. Il pulsante "Ferma tutto" c'è sempre
   * quando qualcosa gira (anche Esc sulla riga di comando vuota).
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  const seq = $derived(sessionState.sequence);
  const rec = $derived(sessionState.recording);
</script>

<!-- Il contenitore c'è sempre: è una riga della griglia dell'app. -->
<div>
  {#if seq || rec}
    <div class="strip">
      {#if seq}
        <div class="row" class:stopped={seq.stato === 'fermo'}>
          <span class="what">
            {seq.stato === 'corre' ? '▶' : seq.stato === 'pausa' ? '⏸' : '■'}
            {seq.categoria}
            <b>{seq.nome}</b>
            <span class="count">{seq.passo}/{seq.totale}</span>
            {#if seq.passoPasso}<span class="count">· un passo alla volta</span>{/if}
          </span>
          {#if seq.motivo}<span class="why" title={seq.motivo}>{seq.motivo}</span>{/if}
          <span class="buttons">
            {#if seq.passoPasso && seq.stato === 'pausa'}
              <button
                class="primary"
                title="Passo successivo (anche Invio sulla riga vuota)"
                onclick={() => session.nextStep()}>Passo ▶</button
              >
              <button
                title="Fa tutti i passi rimasti di fila"
                onclick={() => session.executor.setStepMode(false)}>Tutto</button
              >
              <button class="danger" onclick={() => session.stopPath()}>Stop</button>
            {:else if seq.stato === 'corre'}
              <button
                class:on={seq.passoPasso}
                title="Un passo alla volta"
                onclick={() => session.executor.setStepMode(!seq.passoPasso)}>A passi</button
              >
              <button onclick={() => session.executor.pause()}>Pausa</button>
              <button class="danger" onclick={() => session.stopPath()}>Stop</button>
            {:else}
              <button class="primary" onclick={() => session.resumePath()}>Riprendi</button>
              {#if seq.stato === 'fermo' && seq.fallito}
                <button
                  onclick={() => session.executor.skip()}
                  title="Salta il passo fallito e continua">Salta</button
                >
              {/if}
              {#if seq.stato === 'pausa'}
                <button class="danger" onclick={() => session.stopPath()}>Stop</button>
              {:else}
                <button onclick={() => session.executor.close()}>Chiudi</button>
              {/if}
            {/if}
          </span>
        </div>
      {/if}
      {#if rec}
        <div class="row rec">
          <span class="what">
            <span class="dot" class:paused={rec.pausa}>●</span>
            {rec.pausa ? 'registrazione in pausa' : 'registro'}
            <span class="count">{rec.passi.length} passi</span>
          </span>
          <span class="why">rec fine &lt;nome&gt; per salvare · dettagli nel pannello Percorsi</span
          >
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  button.on {
    color: var(--c-gold);
  }
  .strip {
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 10px;
    min-height: 26px;
  }
  .row.stopped .what {
    color: var(--c-gold);
  }
  .what {
    color: var(--c-green);
    white-space: nowrap;
  }
  .count {
    color: var(--text-dim);
    font-family: var(--font-mono);
    margin-left: 4px;
  }
  .why {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .buttons {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  button {
    padding: 1px 8px;
    font-size: 12px;
  }
  .danger {
    border-color: var(--danger-border);
    color: var(--danger-text);
  }
  .rec .what {
    color: var(--c-red);
  }
  .dot.paused {
    color: var(--text-dim);
  }
</style>
