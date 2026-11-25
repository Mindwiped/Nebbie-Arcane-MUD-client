import { parseRule, presetRules, type Rule } from '../../core/rules/rules';
import { parseKeepEntry, type KeepEntry } from './keepActive';

/** Automatismi di un personaggio (automatismi.json, uno per profilo). */
export interface AutoConfig {
  mantieni: { attivo: boolean; voci: KeepEntry[] };
  regole: { attivo: boolean; voci: Rule[] };
  /** Costi in mana imparati dal prompt. */
  costi: Record<string, number>;
}

export function defaultAutoConfig(): AutoConfig {
  return {
    mantieni: { attivo: false, voci: [] },
    regole: { attivo: false, voci: presetRules() },
    costi: {},
  };
}

/**
 * Prima volta per un profilo: regole pronte (spente). Se nel vecchio moduli.json second wind era
 * acceso, la regola corrispondente nasce accesa con la stessa soglia, e le regole pure.
 */
export function migrateAutoConfig(oldSecondWind?: {
  attivo?: boolean;
  soglia?: number;
}): AutoConfig {
  const cfg = defaultAutoConfig();
  if (oldSecondWind?.attivo) {
    const sw = cfg.regole.voci.find((r) => r.preset === 'secondWind')!;
    sw.attiva = true;
    if (sw.quando.tipo === 'valore' && typeof oldSecondWind.soglia === 'number')
      sw.quando.soglia = oldSecondWind.soglia;
    cfg.regole.attivo = true;
  }
  return cfg;
}

export function parseAutoConfig(json: unknown): AutoConfig {
  const base = defaultAutoConfig();
  if (!json || typeof json !== 'object') return base;
  const d = json as Record<string, Record<string, unknown> | undefined>;
  const voci = (v: unknown) => (Array.isArray(v) ? v : []);
  const costi: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.costi ?? {})) if (typeof v === 'number') costi[k] = v;
  return {
    mantieni: {
      attivo: d.mantieni?.attivo === true,
      voci: voci(d.mantieni?.voci)
        .map(parseKeepEntry)
        .filter((x) => x !== null),
    },
    regole: {
      attivo: d.regole?.attivo === true,
      voci: Array.isArray(d.regole?.voci)
        ? withNewPresets(d.regole.voci.map(parseRule).filter((x) => x !== null))
        : base.regole.voci,
    },
    costi,
  };
}

/**
 * Regole pronte nate dopo i primi profili: compaiono (spente) anche in quelli esistenti. Solo
 * queste, così una regola pronta cancellata di proposito non torna.
 */
const NEW_PRESETS = new Set(['split']);
function withNewPresets(voci: Rule[]): Rule[] {
  const visti = new Set(voci.map((r) => r.preset));
  const nuove = presetRules().filter((r) => NEW_PRESETS.has(r.preset!) && !visti.has(r.preset));
  return [...voci, ...nuove];
}
