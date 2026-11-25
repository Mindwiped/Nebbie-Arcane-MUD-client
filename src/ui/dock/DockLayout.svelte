<script lang="ts">
  import { createDockview, themeDark, type DockviewApi, type SerializedDockview } from 'dockview';
  import 'dockview/dist/styles/dockview.css';
  import { onMount } from 'svelte';
  import { errorMessage } from '../../core/backend';
  import type { Session, SessionState } from '../../core/session';
  import {
    cleanLayoutName,
    DEFAULT_LAYOUT_NAME,
    loadLayouts,
    saveLayouts,
    type LayoutsFile,
  } from './layouts';
  import { defaultLayout, openPanel, panelDef, PANELS } from './panels';
  import { SveltePanel } from './sveltePanel';
  import { FitActions } from './fitHeight';

  /**
   * Area a pannelli agganciabili (dockview): si trascinano le schede per affiancare,
   * impilare o separare i pannelli. Il layout si salva da solo e se ne possono tenere
   * diversi con un nome.
   */
  let {
    session,
    sessionState,
    layouts = $bindable(),
    openIds = $bindable(),
    onoutput,
  }: {
    session: Session;
    sessionState: SessionState;
    layouts: LayoutsFile;
    openIds: string[];
    /** Riceve il pannello Output montato (per PagSu/PagGiù dalla riga di comando). */
    onoutput?: (output: { page(dir: 1 | -1): void } | null) => void;
  } = $props();

  let host: HTMLDivElement;
  let api: DockviewApi | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let ready = false;

  function refreshOpen(): void {
    openIds = api ? api.panels.map((p) => p.id) : [];
  }

  function apply(json: unknown): void {
    if (!api) return;
    try {
      if (json) api.fromJSON(json as SerializedDockview);
      else defaultLayout(api);
    } catch (e) {
      session.error(`Layout non valido, uso quello predefinito: ${errorMessage(e)}`);
      defaultLayout(api);
    }
    refreshOpen();
  }

  /** Salva il layout attuale sotto il nome attivo (poco dopo l'ultima modifica). */
  function scheduleSave(): void {
    if (!ready || !api) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!api) return;
      layouts = { ...layouts, layouts: { ...layouts.layouts, [layouts.attivo]: api.toJSON() } };
      saveLayouts($state.snapshot(layouts) as LayoutsFile).catch((e) =>
        session.error(`Layout non salvato: ${errorMessage(e)}`),
      );
    }, 500);
  }

  onMount(() => {
    api = createDockview(host, {
      theme: themeDark,
      createRightHeaderActionComponent: (group) => new FitActions(group, () => scheduleSave()),
      createComponent: ({ name }) => {
        const def = panelDef(name);
        if (!def) throw new Error(`Pannello sconosciuto: ${name}`);
        const props = { session, sessionState, buffer: session.output };
        return new SveltePanel(def, props, (instance) => {
          if (name === 'output') onoutput?.(instance as { page(dir: 1 | -1): void } | null);
        });
      },
    });
    const subs = [
      api.onDidLayoutChange(() => {
        refreshOpen();
        scheduleSave();
      }),
    ];
    let cancelled = false;
    (async () => {
      try {
        layouts = await loadLayouts();
      } catch (e) {
        session.error(errorMessage(e));
      }
      if (cancelled) return;
      apply(layouts.layouts[layouts.attivo]);
      ready = true;
    })();
    return () => {
      cancelled = true;
      clearTimeout(saveTimer);
      subs.forEach((s) => s.dispose());
      api?.dispose();
      api = undefined;
    };
  });

  // ----- comandi usati dal menu dei layout -----

  export function togglePanel(id: string): void {
    if (!api) return;
    const panel = api.getPanel(id);
    if (panel) panel.api.close();
    else openPanel(api, id);
    refreshOpen();
  }

  export function resetLayout(): void {
    if (!api) return;
    defaultLayout(api);
    refreshOpen();
    scheduleSave();
  }

  export function switchLayout(name: string): void {
    if (!api || !(name in layouts.layouts)) return;
    layouts = { ...layouts, attivo: name };
    apply(layouts.layouts[name]);
    scheduleSave();
  }

  /** Salva il layout attuale con un nuovo nome e lo rende attivo. */
  export function saveAs(rawName: string): string | null {
    const name = cleanLayoutName(rawName);
    if (!api || !name) return null;
    layouts = { ...layouts, attivo: name, layouts: { ...layouts.layouts, [name]: api.toJSON() } };
    scheduleSave();
    return name;
  }

  export function deleteLayout(name: string): void {
    if (!api || Object.keys(layouts.layouts).length <= 1) return;
    const rest = { ...layouts.layouts };
    delete rest[name];
    const wasActive = name === layouts.attivo;
    const attivo = wasActive ? (Object.keys(rest)[0] ?? DEFAULT_LAYOUT_NAME) : layouts.attivo;
    layouts = { ...layouts, attivo, layouts: rest };
    // Eliminando il layout attivo si passa al primo rimasto.
    if (wasActive) apply(rest[attivo]);
    scheduleSave();
  }

  export const allPanels = PANELS.map((p) => ({ id: p.id, title: p.title }));
</script>

<div class="dock" bind:this={host}></div>

<style>
  .dock {
    min-height: 0;
    height: 100%;
  }
  /* Colori del tema scuro di dockview adattati a quelli del client. */
  .dock :global(.dockview-theme-dark) {
    --dv-group-view-background-color: var(--bg);
    --dv-tabs-and-actions-container-background-color: var(--bg-panel);
    --dv-activegroup-visiblepanel-tab-background-color: var(--bg);
    --dv-inactivegroup-visiblepanel-tab-background-color: var(--bg);
    --dv-activegroup-hiddenpanel-tab-background-color: var(--bg-panel);
    --dv-inactivegroup-hiddenpanel-tab-background-color: var(--bg-panel);
    --dv-tab-divider-color: var(--border);
    --dv-separator-border: var(--border);
    --dv-paneview-header-border-color: var(--border);
    --dv-sash-color: var(--border);
    --dv-active-sash-color: var(--accent);
    --dv-activegroup-visiblepanel-tab-color: var(--text);
    --dv-inactivegroup-visiblepanel-tab-color: var(--text-dim);
    --dv-activegroup-hiddenpanel-tab-color: var(--text-dim);
    --dv-inactivegroup-hiddenpanel-tab-color: var(--text-dim);
    --dv-icon-hover-background-color: var(--border);
    --dv-tabs-and-actions-container-font-size: 12px;
    --dv-tabs-and-actions-container-height: 28px;
  }
  .dock :global(.fit-actions) {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 100%;
    padding: 0 4px;
  }
  .dock :global(.fit-actions select) {
    width: 26px;
    height: 20px;
    padding: 0 2px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: none;
    color: var(--text-dim);
    font-size: 11px;
    appearance: none;
    text-align: center;
    cursor: pointer;
  }
  .dock :global(.fit-actions select:hover) {
    border-color: var(--border);
    color: var(--text);
  }
  .dock :global(.fit-actions button) {
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: none;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }
  .dock :global(.fit-actions button:hover) {
    border-color: var(--border);
    color: var(--text);
  }
  .dock :global(.fit-actions button.on) {
    border-color: var(--c-gold);
    color: var(--c-gold);
  }
  .dock :global(.panel-host) {
    height: 100%;
    position: relative;
  }
  .dock :global(.panel-host > .output) {
    height: 100%;
  }
</style>
