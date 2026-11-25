<script lang="ts">
  import { keyLabel } from './platform';
  import type { ActionButton } from '../core/buttons/model';

  /** Barra pulsanti: un clic (o la scorciatoia) manda il comando del pulsante. */
  let {
    buttons,
    onpress,
    onedit,
  }: {
    buttons: ActionButton[];
    onpress: (b: ActionButton) => void;
    onedit: () => void;
  } = $props();

  /** Testo chiaro o scuro a seconda dello sfondo scelto. */
  function textOn(bg: string): string {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(bg.trim());
    if (!m) return '';
    const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.55 ? '#111' : '#fff';
  }

  function style(b: ActionButton): string {
    if (!b.colore) return '';
    return `background:${b.colore};border-color:${b.colore};color:${textOn(b.colore)}`;
  }

  function shortcutLabel(t: string): string {
    return keyLabel(t);
  }
</script>

<div class="button-bar" role="toolbar" aria-label="Pulsanti">
  {#each buttons as b (b.id)}
    <button style={style(b)} title={b.comando} onclick={() => onpress(b)}>
      {b.etichetta}
      {#if b.tasto}<kbd>{shortcutLabel(b.tasto)}</kbd>{/if}
    </button>
  {/each}
  <button class="edit" title="Modifica i pulsanti" onclick={onedit}>
    {buttons.length ? '✎' : '+ Pulsanti'}
  </button>
</div>

<style>
  .button-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 5px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-panel);
  }
  button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 12px;
  }
  kbd {
    padding: 0 4px;
    border-radius: 3px;
    background: #0004;
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.8;
  }
  .edit {
    margin-left: auto;
    border-color: transparent;
    background: none;
    color: var(--text-dim);
  }
</style>
