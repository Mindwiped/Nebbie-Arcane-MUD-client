import type { DockviewApi } from 'dockview';
import type { Component } from 'svelte';
import Output from '../Output.svelte';
import AffectsPanel from '../panels/AffectsPanel.svelte';
import AutomationsPanel from '../panels/AutomationsPanel.svelte';
import GearPanel from '../panels/GearPanel.svelte';
import MapPanel from '../panels/MapPanel.svelte';
import PathsPanel from '../panels/PathsPanel.svelte';
import RelicsPanel from '../panels/RelicsPanel.svelte';
import RoomPanel from '../panels/RoomPanel.svelte';
import StatsPanel from '../panels/StatsPanel.svelte';

/**
 * Pannelli disponibili. Ogni pannello è un componente Svelte che riceve le stesse props
 * (`session`, `sessionState`, `buffer`) e prende solo quelle che gli servono.
 * Si aggiungono nuovi pannelli qui, senza toccare il resto.
 */
export interface PanelDef {
  id: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>;
}

export const PANELS: PanelDef[] = [
  { id: 'output', title: 'Output', component: Output },
  { id: 'mappa', title: 'Mappa', component: MapPanel },
  { id: 'stanza', title: 'Stanza', component: RoomPanel },
  { id: 'effetti', title: 'Effetti', component: AffectsPanel },
  { id: 'statistiche', title: 'Statistiche', component: StatsPanel },
  { id: 'percorsi', title: 'Percorsi', component: PathsPanel },
  { id: 'equipaggiamento', title: 'Equipaggiamento', component: GearPanel },
  { id: 'automatismi', title: 'Automatismi', component: AutomationsPanel },
  { id: 'reliquiario', title: 'Reliquiario', component: RelicsPanel },
];

export function panelDef(id: string): PanelDef | undefined {
  return PANELS.find((p) => p.id === id);
}

/**
 * Layout predefinito: output al centro; a destra la Mappa in alto, sotto due gruppi a schede
 * (Stanza, Percorsi, Equipaggiamento · Effetti, Automatismi, Statistiche).
 */
export function defaultLayout(api: DockviewApi): void {
  api.clear();
  api.addPanel({ id: 'output', component: 'output', title: 'Output' });
  api.addPanel({
    id: 'mappa',
    component: 'mappa',
    title: 'Mappa',
    position: { referencePanel: 'output', direction: 'right' },
    initialWidth: 420,
  });
  api.addPanel({
    id: 'stanza',
    component: 'stanza',
    title: 'Stanza',
    position: { referencePanel: 'mappa', direction: 'below' },
  });
  api.addPanel({
    id: 'effetti',
    component: 'effetti',
    title: 'Effetti',
    position: { referencePanel: 'stanza', direction: 'below' },
  });
  api.addPanel({
    id: 'statistiche',
    component: 'statistiche',
    title: 'Statistiche',
    position: { referencePanel: 'effetti', direction: 'within' },
    inactive: true,
  });
  // Percorsi come scheda accanto a Stanza (stesso gruppo).
  api.addPanel({
    id: 'percorsi',
    component: 'percorsi',
    title: 'Percorsi',
    position: { referencePanel: 'stanza', direction: 'within' },
    inactive: true,
  });
  api.addPanel({
    id: 'equipaggiamento',
    component: 'equipaggiamento',
    title: 'Equipaggiamento',
    position: { referencePanel: 'stanza', direction: 'within' },
    inactive: true,
  });
  api.addPanel({
    id: 'automatismi',
    component: 'automatismi',
    title: 'Automatismi',
    position: { referencePanel: 'effetti', direction: 'within' },
    inactive: true,
  });
  api.addPanel({
    id: 'reliquiario',
    component: 'reliquiario',
    title: 'Reliquiario',
    position: { referencePanel: 'stanza', direction: 'within' },
    inactive: true,
  });
  // Se l'area non aveva ancora la sua larghezza, `initialWidth` non basta: la colonna di
  // destra si reimposta appena l'area è disegnata.
  requestAnimationFrame(() => {
    const g = api.getPanel('mappa')?.group.api;
    g?.setSize({ width: 420, height: Math.round(api.height * 0.5) });
  });
}

/** Riapre un pannello chiuso: a destra dell'output se c'è, altrimenti dove capita. */
export function openPanel(api: DockviewApi, id: string): void {
  const def = panelDef(id);
  if (!def || api.getPanel(id)) return;
  const output = id !== 'output' ? api.getPanel('output') : undefined;
  api.addPanel({
    id,
    component: id,
    title: def.title,
    ...(output ? { position: { referencePanel: 'output', direction: 'right' as const } } : {}),
  });
}
