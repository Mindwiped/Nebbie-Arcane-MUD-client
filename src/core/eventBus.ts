/**
 * Bus di eventi tipizzato: il parser pubblica, interfaccia/mappa/automatismi ascoltano.
 * La mappa degli eventi (nome → dati) è un parametro di tipo, così ogni modulo
 * vede solo eventi e campi che esistono davvero.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Registra un ascoltatore; restituisce la funzione per toglierlo. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  /**
   * Pubblica un evento. Un ascoltatore che lancia un errore non blocca gli altri:
   * l'errore viene passato a `onError` (di solito mostrato nell'output).
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        this.onError(error, String(event));
      }
    }
  }

  onError: (error: unknown, event: string) => void = (error, event) => {
    console.error(`Errore in un ascoltatore di "${event}":`, error);
  };
}
