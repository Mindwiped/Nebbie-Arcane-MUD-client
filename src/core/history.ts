/**
 * Cronologia dei comandi, come negli altri client: freccia su/giù scorre i comandi
 * precedenti/successivi. Con un prefisso (testo scritto dal giocatore prima di premere su)
 * mostra solo i comandi che iniziano così. Le voci uguali a quella già visibile vengono
 * saltate, così il comando appena inviato (che resta nella riga di comando) non "blocca"
 * la prima pressione di freccia su.
 */
export class History {
  private items: string[] = [];
  /** Voce mostrata; `null` = non si sta navigando (nella riga c'è la bozza). */
  private index: number | null = null;
  private draft = '';
  private prefix = '';

  constructor(private readonly max = 500) {}

  get all(): readonly string[] {
    return this.items;
  }

  add(command: string): void {
    this.index = null;
    if (!command.trim()) return;
    if (this.items[this.items.length - 1] === command) return;
    this.items.push(command);
    if (this.items.length > this.max) this.items.shift();
  }

  private get shown(): string {
    return this.index !== null && this.index < this.items.length
      ? this.items[this.index]
      : this.draft;
  }

  /**
   * Voce precedente (più vecchia).
   * @param current testo nella riga di comando (ci si torna in fondo con freccia giù)
   * @param prefix filtro: solo i comandi che iniziano così ('' = tutti)
   */
  prev(current: string, prefix = ''): string | undefined {
    if (this.index === null) {
      this.draft = current;
      this.prefix = prefix;
      this.index = this.items.length;
    }
    const shown = this.shown;
    for (let i = this.index - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.startsWith(this.prefix) && item !== shown) {
        this.index = i;
        return item;
      }
    }
    return undefined;
  }

  /** Voce successiva (più recente); in fondo torna al testo che c'era nella riga. */
  next(): string | undefined {
    if (this.index === null) return undefined;
    const shown = this.shown;
    for (let i = this.index + 1; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.startsWith(this.prefix) && item !== shown) {
        this.index = i;
        return item;
      }
    }
    this.index = null;
    return this.draft !== shown ? this.draft : undefined;
  }

  reset(): void {
    this.index = null;
  }
}
