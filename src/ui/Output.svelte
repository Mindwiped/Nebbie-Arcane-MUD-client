<script lang="ts">
  import { tick } from 'svelte';
  import type { OutputBuffer } from '../core/outputBuffer';
  import { spanStyle } from './ansiColors';

  /**
   * Output virtualizzato: disegna solo le righe visibili. Il testo va a capo carattere per
   * carattere (font monospaziato), così il numero di righe a schermo di ogni riga del MUD
   * si calcola dalla sua lunghezza senza misurarla nel DOM.
   */
  let { buffer }: { buffer: OutputBuffer } = $props();

  const PADDING = 12;
  const OVERSCAN = 20;

  let viewport: HTMLDivElement;
  let probe: HTMLSpanElement;
  let version = $state(0);
  let scrollTop = $state(0);
  let height = $state(0);
  let width = $state(0);
  let charW = $state(8.4);
  let lineH = $state(18);
  let follow = $state(true);
  let seenTotal = $state(0);

  $effect(() => buffer.onChange(() => version++));

  $effect(() => {
    const measure = () => {
      const r = probe.getBoundingClientRect();
      if (r.width > 0) charW = r.width / 100;
      if (r.height > 0) lineH = r.height;
    };
    const size = () => {
      width = viewport.clientWidth;
      height = viewport.clientHeight;
      measure();
    };
    // Misura subito: il ResizeObserver può arrivare tardi (o mai, se la finestra non è disegnata).
    size();
    const ro = new ResizeObserver(size);
    ro.observe(viewport);
    // il campione cambia misura col testo più grande o più piccolo (impostazioni)
    ro.observe(probe);
    return () => ro.disconnect();
  });

  const cols = $derived(Math.max(20, Math.floor((width - PADDING * 2) / charW)));

  /** Riga a schermo da cui parte ogni riga del buffer (somme prefisse). */
  const layout = $derived.by(() => {
    void version;
    const lines = buffer.lines;
    const starts = new Uint32Array(lines.length + 1);
    let rows = 0;
    for (let i = 0; i < lines.length; i++) {
      starts[i] = rows;
      rows += Math.max(1, Math.ceil(lines[i].length / cols));
    }
    starts[lines.length] = rows;
    return { starts, total: rows };
  });

  /** Indice della riga che contiene la riga a schermo `row` (ricerca binaria). */
  function lineAt(row: number): number {
    const { starts } = layout;
    let lo = 0;
    let hi = buffer.lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  const visible = $derived.by(() => {
    void layout;
    const n = buffer.lines.length;
    if (n === 0) return [];
    const first = lineAt(Math.max(0, Math.floor(scrollTop / lineH) - OVERSCAN));
    const last = lineAt(Math.ceil((scrollTop + height) / lineH) + OVERSCAN);
    return buffer.lines.slice(first, last + 1).map((line, k) => ({
      line,
      top: layout.starts[first + k] * lineH,
    }));
  });

  const unseen = $derived(follow ? 0 : Math.max(0, layout.total - seenTotal));

  // Segue il fondo quando arrivano righe nuove, se non si è risaliti.
  $effect(() => {
    const total = layout.total;
    if (!follow) return;
    seenTotal = total;
    tick().then(() => {
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  });

  function onScroll() {
    scrollTop = viewport.scrollTop;
    const atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - lineH;
    if (atBottom !== follow) follow = atBottom;
    if (!follow && seenTotal === 0) seenTotal = layout.total;
  }

  export function scrollToBottom() {
    follow = true;
    viewport.scrollTop = viewport.scrollHeight;
  }

  export function page(direction: 1 | -1) {
    viewport.scrollTop += direction * (viewport.clientHeight - lineH * 2);
  }
</script>

<div class="output">
  <span class="probe" bind:this={probe} aria-hidden="true">{'M'.repeat(100)}</span>
  <div class="viewport" bind:this={viewport} onscroll={onScroll} role="log" aria-live="off">
    <div class="content" style="height:{layout.total * lineH}px">
      {#each visible as { line, top } (line.id)}
        <div
          class="line {line.kind}{line.sfondo ? ` bg-${line.sfondo}` : ''}"
          style="top:{top}px;left:{PADDING}px;width:{cols *
            charW}px;line-height:{lineH}px;{line.colore ? `color:${line.colore}` : ''}"
        >
          {#each line.spans as s, i (i)}<span
              style={spanStyle(line.colore ? { ...s, fg: undefined } : s)}>{s.text}</span
            >{/each}{#if line.echo !== undefined}<span class="echo"
              >{line.spans.length ? ' ' : ''}{line.echo}</span
            >{/if}
        </div>
      {/each}
    </div>
  </div>
  {#if !follow}
    <button class="to-bottom" onclick={scrollToBottom}>
      ↓ {unseen > 0 ? `${unseen} righe nuove` : 'Torna in fondo'}
    </button>
  {/if}
</div>

<style>
  .output {
    position: relative;
    min-height: 0;
    font-family: var(--font-mono);
    font-size: var(--output-size, 14px);
  }
  .probe {
    position: absolute;
    visibility: hidden;
    white-space: pre;
    line-height: 18px;
  }
  .viewport {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .content {
    position: relative;
  }
  .line {
    position: absolute;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-wrap: anywhere;
  }
  .line.system {
    color: var(--text-dim);
    font-style: italic;
  }
  .line.error {
    color: var(--c-red);
  }
  /* Allarmi del client (es. furto): rossi e in grassetto, sfondo invariato. */
  .line.alarm {
    color: var(--c-red-strong);
    font-weight: 700;
  }
  /* Eventi: finito a terra (rosso), di nuovo in piedi (verde). */
  .line.bg-rosso {
    background: var(--bg-red);
  }
  .line.bg-verde {
    background: var(--bg-green);
  }
  .echo {
    color: var(--echo, #d6c27a);
  }
  .to-bottom {
    position: absolute;
    right: 18px;
    bottom: 10px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-panel);
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
</style>
