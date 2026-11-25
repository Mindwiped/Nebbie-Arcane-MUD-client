<script lang="ts">
  import type { LayoutsFile } from './layouts';

  /** Menu "Pannelli": mostra/nasconde i pannelli, sceglie, salva ed elimina i layout. */
  interface DockCommands {
    togglePanel(id: string): void;
    resetLayout(): void;
    switchLayout(name: string): void;
    saveAs(name: string): string | null;
    deleteLayout(name: string): void;
    allPanels: { id: string; title: string }[];
  }

  let {
    dock,
    layouts,
    openIds,
  }: { dock: DockCommands | undefined; layouts: LayoutsFile; openIds: string[] } = $props();

  let open = $state(false);
  let newName = $state('');
  let menu: HTMLDivElement | undefined = $state();

  const names = $derived(Object.keys(layouts.layouts).sort((a, b) => a.localeCompare(b, 'it')));

  function saveNew() {
    if (dock?.saveAs(newName)) newName = '';
  }

  function onWindowClick(e: MouseEvent) {
    if (open && menu && !menu.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="layout-menu" bind:this={menu}>
  <button onclick={() => (open = !open)} aria-expanded={open}>Pannelli ▾</button>
  {#if open && dock}
    <div class="popover" role="menu">
      <h4>Pannelli</h4>
      {#each dock.allPanels as p (p.id)}
        <label>
          <input
            type="checkbox"
            checked={openIds.includes(p.id)}
            onchange={() => dock.togglePanel(p.id)}
          />
          {p.title}
        </label>
      {/each}

      <h4>Layout</h4>
      {#each names as n (n)}
        <div class="row">
          <label class="grow">
            <input
              type="radio"
              name="layout"
              checked={n === layouts.attivo}
              onchange={() => dock.switchLayout(n)}
            />
            {n}
          </label>
          {#if names.length > 1}
            <button class="small" title="Elimina il layout {n}" onclick={() => dock.deleteLayout(n)}
              >✕</button
            >
          {/if}
        </div>
      {/each}
      <form class="row" onsubmit={(e) => (e.preventDefault(), saveNew())}>
        <input bind:value={newName} placeholder="nuovo layout (es. caccia)" maxlength="40" />
        <button type="submit" disabled={!newName.trim()}>Salva</button>
      </form>
      <button class="link" onclick={() => dock.resetLayout()}
        >Ripristina il layout predefinito</button
      >
      <small>Trascina le schede per spostare i pannelli: il layout si salva da solo.</small>
    </div>
  {/if}
</div>

<style>
  .layout-menu {
    position: relative;
  }
  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 1000;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 10px 30px #000a;
  }
  h4 {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row input:not([type]) {
    flex: 1;
    min-width: 0;
  }
  .grow {
    flex: 1;
  }
  .small {
    padding: 0 6px;
    font-size: 11px;
  }
  .link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
  small {
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
