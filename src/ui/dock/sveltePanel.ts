import type { IContentRenderer } from 'dockview';
import { mount, unmount } from 'svelte';
import type { PanelDef } from './panels';

/** Monta un componente Svelte dentro un pannello di dockview e lo smonta alla chiusura. */
export class SveltePanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private instance: Record<string, unknown> | undefined;
  private readonly def: PanelDef;
  private readonly props: Record<string, unknown>;
  private readonly onMount?: (instance: Record<string, unknown> | null) => void;

  constructor(
    def: PanelDef,
    props: Record<string, unknown>,
    onMount?: (instance: Record<string, unknown> | null) => void,
  ) {
    this.def = def;
    this.props = props;
    this.onMount = onMount;
    this.element.className = 'panel-host';
  }

  init(): void {
    this.instance = mount(this.def.component, { target: this.element, props: this.props });
    this.onMount?.(this.instance);
  }

  dispose(): void {
    this.onMount?.(null);
    if (this.instance) void unmount(this.instance);
    this.instance = undefined;
  }
}
