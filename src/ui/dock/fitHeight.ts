import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
  IGroupHeaderProps,
  IHeaderActionsRenderer,
} from 'dockview';

/**
 * Altezza su misura dei pannelli (richiesta del 2026-11-19): i pannelli piccoli (Effetti,
 * Statistiche…) impilati uno sopra l'altro occupano solo lo spazio che serve. Nell'intestazione
 * di ogni gruppo: ↕ adatta l'altezza adesso, A la tiene adattata quando il contenuto cambia
 * (si salva col layout, nei parametri del pannello).
 */

/** Altezza del contenuto di un pannello se potesse crescere quanto vuole. */
export function naturalHeight(host: HTMLElement): number {
  const root = host.firstElementChild as HTMLElement | null;
  if (!root) return 0;
  const saved: [HTMLElement, string][] = [];
  const loosen = (el: HTMLElement) => {
    saved.push([el, el.style.cssText]);
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('flex', 'none', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  };
  loosen(root);
  // le parti che scorrono o si allargano (liste, corpo dei pannelli a colonna) prendono la loro
  // altezza vera; il resto si misura com'è
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const cs = getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowY) || parseFloat(cs.flexGrow) > 0) loosen(el);
  }
  const h = root.getBoundingClientRect().height;
  for (const [el, css] of saved.reverse()) el.style.cssText = css;
  return Math.ceil(h);
}

const contentOf = (p: IDockviewPanel | undefined) =>
  p?.view.content.element as HTMLElement | undefined;

/** Porta il gruppo all'altezza del pannello attivo (più la riga delle schede). */
export function fitGroup(group: DockviewGroupPanel): void {
  const host = contentOf(group.activePanel);
  if (!host) return;
  const tabs = group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container');
  const want = naturalHeight(host) + (tabs?.offsetHeight ?? 28) + 2;
  if (Math.abs(group.api.height - want) > 2) group.api.setSize({ height: want });
}

export const isAutoFit = (p: IDockviewPanel | undefined) =>
  (p?.params as { adatta?: boolean } | undefined)?.adatta === true;

/**
 * Sposta il pannello attivo sotto un altro (o come sua scheda) senza trascinare: nell'app il
 * trascinamento delle schede può non arrivare (segnalato il 2026-11-19).
 */
export function movePanel(
  api: DockviewApi,
  panel: IDockviewPanel,
  targetId: string,
  dove: 'bottom' | 'center',
): void {
  const target = api.getPanel(targetId);
  if (!target || target === panel) return;
  if (dove === 'center' && target.group === panel.group) return;
  panel.api.moveTo({ group: target.group, position: dove });
}

/** Pulsanti ⇩, ↕ e A a destra delle schede di un gruppo. */
export class FitActions implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private readonly fitBtn = document.createElement('button');
  private readonly autoBtn = document.createElement('button');
  private readonly moveSel = document.createElement('select');
  private api?: DockviewApi;
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private subs: { dispose(): void }[] = [];

  constructor(
    private readonly group: DockviewGroupPanel,
    private readonly onChange: () => void,
  ) {
    this.element.className = 'fit-actions';
    this.fitBtn.textContent = '↕';
    this.fitBtn.title = "Adatta l'altezza al contenuto";
    this.autoBtn.textContent = 'A';
    this.moveSel.title = 'Impila questo pannello sotto un altro, o mettilo come sua scheda';
    this.moveSel.addEventListener('pointerdown', () => this.fillMove());
    this.moveSel.addEventListener('focus', () => this.fillMove());
    this.moveSel.addEventListener('change', () => this.doMove());
    this.fillMove();
    this.element.append(this.moveSel, this.fitBtn, this.autoBtn);
    this.fitBtn.addEventListener('click', () => fitGroup(this.group));
    this.autoBtn.addEventListener('click', () => this.toggleAuto());
  }

  init(params: IGroupHeaderProps): void {
    this.api = params.containerApi;
    this.subs.push(this.group.api.onDidActivePanelChange(() => this.watch()));
    this.watch();
  }

  /** Riempie la tendina con gli altri pannelli aperti (al momento di aprirla). */
  private fillMove(): void {
    const me = this.group.activePanel;
    const others = (this.api?.panels ?? []).filter((p) => p !== me);
    const opt = (value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    const grp = (label: string, items: HTMLOptionElement[]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      g.append(...items);
      return g;
    };
    this.moveSel.replaceChildren(
      opt('', '⇩'),
      grp(
        'Impila sotto',
        others.map((p) => opt(`bottom:${p.id}`, p.title ?? p.id)),
      ),
      grp(
        'Come scheda di',
        others
          .filter((p) => p.group !== this.group)
          .map((p) => opt(`center:${p.id}`, p.title ?? p.id)),
      ),
    );
    this.moveSel.value = '';
  }

  private doMove(): void {
    const [dove, id] = this.moveSel.value.split(/:(.*)/s);
    this.moveSel.value = '';
    const me = this.group.activePanel;
    if (!this.api || !me || !id) return;
    movePanel(this.api, me, id, dove === 'center' ? 'center' : 'bottom');
    this.onChange();
  }

  private toggleAuto(): void {
    const p = this.group.activePanel;
    if (!p) return;
    p.api.updateParameters({ ...(p.params ?? {}), adatta: !isAutoFit(p) });
    this.watch();
    this.onChange();
  }

  /** Osserva il pannello attivo se ha l'adattamento automatico acceso. */
  private watch(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    const p = this.group.activePanel;
    const on = isAutoFit(p);
    this.autoBtn.classList.toggle('on', on);
    this.autoBtn.setAttribute('aria-pressed', String(on));
    this.autoBtn.title = on
      ? 'Altezza adattata da sola al contenuto: clic per spegnere'
      : "Adatta l'altezza da sola quando il contenuto cambia";
    const host = contentOf(p);
    if (!on || !host) return;
    this.observer = new MutationObserver(() => this.later());
    this.observer.observe(host, { childList: true, subtree: true, characterData: true });
    this.later();
  }

  private later(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => fitGroup(this.group), 250);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.observer?.disconnect();
    this.subs.forEach((s) => s.dispose());
  }
}
