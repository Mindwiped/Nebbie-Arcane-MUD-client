<script lang="ts">
  import { percent, type Vital, type Vitals } from '../core/vitals';
  import { formatNumber } from '../nebbie/stats/sessionStats';

  /** Barre HP/MP/MV e, se il prompt le mostra, le monete in tasca. */
  let { vitals, oro }: { vitals: Vitals; oro?: number } = $props();

  const bars = $derived([
    { key: 'HP', v: vitals.hp, cls: 'hp' },
    { key: 'MP', v: vitals.mp, cls: 'mp' },
    { key: 'MV', v: vitals.mv, cls: 'mv' },
  ]);

  /** Colore a soglie: pieno, attenzione sotto il 50%, pericolo sotto il 25%. */
  function level(v: Vital): string {
    const p = percent(v);
    if (v.value === undefined) return '';
    if (p < 25) return 'low';
    if (p < 50) return 'mid';
    return '';
  }

  function label(v: Vital): string {
    if (v.value === undefined) return '—';
    if (v.max === undefined) return String(v.value);
    return `${v.value} / ${v.maxSource === 'stimato' ? '~' : ''}${v.max}`;
  }

  function title(v: Vital): string {
    if (v.maxSource === 'stimato')
      return 'Massimo stimato (il valore più alto visto). Scrivi score per i massimi esatti.';
    if (v.maxSource === 'score') return "Massimo letto dall'ultimo score.";
    if (v.maxSource === 'profilo') return 'Massimo preso dal profilo.';
    if (v.maxSource === 'prompt') return 'Massimo letto dal prompt.';
    return 'Nessun dato: in attesa del prompt.';
  }
</script>

<div class="bars">
  {#each bars as b (b.key)}
    <div class="bar {b.cls} {level(b.v)}" title={title(b.v)}>
      <div class="fill" style="width:{percent(b.v)}%"></div>
      <span class="text"><b>{b.key}</b> {label(b.v)}</span>
    </div>
  {/each}
  {#if oro !== undefined}
    <div class="gold" title="Monete in tasca, dal prompt">
      <b>Oro</b>
      {formatNumber(oro)}
    </div>
  {/if}
</div>

<style>
  .bars {
    display: grid;
    grid-template-columns: repeat(3, 1fr) auto;
    gap: 6px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-panel);
  }
  .bar {
    position: relative;
    height: 22px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--bg-sunken);
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    transition: width 0.25s ease-out;
  }
  .hp .fill {
    background: #3f8f4f;
  }
  .mp .fill {
    background: #3a6fb5;
  }
  .mv .fill {
    background: #8a7a3a;
  }
  .mid .fill {
    background: #b5852f;
  }
  .low .fill {
    background: #b53a3a;
  }
  .gold {
    min-width: 150px;
    padding: 0 10px;
    border-radius: 4px;
    background: var(--gold-box-bg);
    color: var(--gold-box-fg);
    line-height: 22px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: nowrap;
  }
  .text {
    position: relative;
    display: block;
    line-height: 22px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 12px;
    color: #fff;
    text-shadow: 0 1px 2px #000a;
  }
</style>
