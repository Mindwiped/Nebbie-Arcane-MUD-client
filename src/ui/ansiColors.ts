import { TRUECOLOR, type Span } from '../core/types';

/** Tavolozza dei 16 colori base per il tema scuro (0-7 normali, 8-15 chiari). */
export const BASE16 = [
  '#4b5263',
  '#e06c75',
  '#98c379',
  '#e5c07b',
  '#61afef',
  '#c678dd',
  '#56b6c2',
  '#c8ccd4',
  '#7f848e',
  '#ff7b86',
  '#b5e890',
  '#ffd98a',
  '#82c4ff',
  '#e09cf0',
  '#7fdbe6',
  '#ffffff',
];

const CUBE = [0, 95, 135, 175, 215, 255];

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Colore CSS da un valore del backend (indice 0-255 o truecolor). */
export function cssColor(value: number): string {
  if (value >= TRUECOLOR) {
    const rgb = value - TRUECOLOR;
    return hex((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  }
  // I 16 colori base vengono dal tema (variabili --ansi-N): nel tema chiaro sono scuriti.
  if (value < 16) return `var(--ansi-${value}, ${BASE16[value]})`;
  if (value < 232) {
    const n = value - 16;
    return hex(CUBE[Math.floor(n / 36)], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]);
  }
  const g = 8 + (value - 232) * 10;
  return hex(g, g, g);
}

/** Stile in linea per uno span. Il grassetto sui colori 0-7 usa la variante chiara, come i MUD classici. */
export function spanStyle(s: Span): string {
  let fg = s.fg;
  if (s.bold && fg !== undefined && fg < 8) fg += 8;
  let fgCss = fg !== undefined ? cssColor(fg) : undefined;
  // Lo sfondo nero ANSI (40) è il fondo della finestra: Nebbie lo manda su ogni riga e,
  // disegnato col grigio della tavolozza, coprirebbe tutto il testo. Il testo nero (30)
  // invece resta grigio, altrimenti sul fondo scuro sparirebbe.
  // TODO: sfondi colorati solo per eventi scelti dall'utente (elenco da definire).
  let bgCss = s.bg !== undefined && s.bg !== 0 ? cssColor(s.bg) : undefined;
  if (s.inverse) {
    [fgCss, bgCss] = [bgCss ?? 'var(--bg)', fgCss ?? 'var(--text)'];
  }
  let style = '';
  if (fgCss) style += `color:${fgCss};`;
  if (bgCss) style += `background:${bgCss};`;
  if (s.bold) style += 'font-weight:600;';
  if (s.dim) style += 'opacity:.6;';
  if (s.italic) style += 'font-style:italic;';
  if (s.underline) style += 'text-decoration:underline;';
  return style;
}
