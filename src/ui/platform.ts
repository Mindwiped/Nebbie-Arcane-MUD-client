/**
 * Differenze tra macOS e Windows nelle etichette dei tasti (versione Windows del 2026-11-22).
 * I tasti veri sono gli stessi: Alt è ⌥, e dove su Mac si usa ⌘ su Windows si usa Ctrl.
 */
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** "Alt+1" scritto come si vede sulla tastiera: ⌥1 su Mac, Alt+1 su Windows. */
export const keyLabel = (t: string): string => (isMac ? t.replace('Alt+', '⌥') : t);

/** Tasto delle scorciatoie di sistema (copia, incolla, seleziona tutto). */
export const MOD = isMac ? '⌘' : 'Ctrl+';
