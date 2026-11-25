import { parseInput } from '../commandParser';
import {
  aliasRegex,
  GLOBAL,
  triggerRegex,
  type Alias,
  type AutomationFile,
  type Trigger,
} from './model';

/** Un alias può usarne altri, ma non più in profondità di così (evita i cicli). */
const MAX_ALIAS_DEPTH = 5;
/** Un trigger che manda comandi più di così in un secondo viene spento (ciclo). */
const MAX_FIRES_PER_SECOND = 5;

/** Sostituisce `$0`…`$9` con i gruppi della regex (assenti = vuoto). */
export function substitute(template: string, m: RegExpExecArray): string {
  return template.replace(/\$(\d)/g, (_, d: string) => m[Number(d)] ?? '');
}

export interface TriggerFire {
  trigger: Trigger;
  comandi: string[];
}

export interface LineResult {
  fires: TriggerFire[];
  colore?: string;
  nascondi: boolean;
  /** Trigger spenti perché scattavano di continuo. */
  spenti: Trigger[];
}

/**
 * Motore di alias e trigger: tiene compilati solo quelli attivi, nei gruppi attivi, validi
 * per il profilo in uso. Le voci con regex non valide vengono saltate (l'editor le segnala).
 */
export class AutomationEngine {
  private aliases: { a: Alias; re: RegExp }[] = [];
  private triggers: { t: Trigger; re: RegExp }[] = [];
  private fires = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  load(file: AutomationFile, profileId: string | undefined): void {
    const groups = new Set(
      file.gruppi
        .filter((g) => g.attivo && (g.ambito === GLOBAL || g.ambito === profileId))
        .map((g) => g.id),
    );
    this.aliases = [];
    for (const a of file.alias) {
      if (!a.attivo || !groups.has(a.gruppo) || !a.pattern.trim() || !a.azione.trim()) continue;
      try {
        this.aliases.push({ a, re: aliasRegex(a.pattern) });
      } catch {
        /* regex non valida: saltata */
      }
    }
    this.triggers = [];
    for (const t of file.trigger) {
      if (!t.attivo || !groups.has(t.gruppo) || !t.pattern.trim()) continue;
      try {
        this.triggers.push({ t, re: triggerRegex(t) });
      } catch {
        /* regex non valida: saltata */
      }
    }
    this.fires.clear();
  }

  get counts(): { alias: number; trigger: number } {
    return { alias: this.aliases.length, trigger: this.triggers.length };
  }

  /**
   * Espande un comando con gli alias. Restituisce i comandi da mandare (anche più di uno, se
   * l'azione contiene `;` o `#n`) oppure `null` se nessun alias corrisponde.
   */
  expand(command: string, depth = 0): string[] | null {
    if (depth >= MAX_ALIAS_DEPTH) return null;
    for (const { a, re } of this.aliases) {
      const m = re.exec(command);
      if (!m) continue;
      const out: string[] = [];
      for (const c of parseInput(substitute(a.azione, m))) {
        out.push(...(this.expand(c, depth + 1) ?? [c]));
      }
      return out;
    }
    return null;
  }

  /** Controlla una riga del MUD con i trigger. */
  matchLine(text: string): LineResult {
    const result: LineResult = { fires: [], nascondi: false, spenti: [] };
    const now = this.now();
    for (const entry of [...this.triggers]) {
      const { t, re } = entry;
      const m = re.exec(text);
      if (!m) continue;
      if (t.colore.trim()) result.colore = t.colore.trim();
      if (t.nascondi) result.nascondi = true;
      if (!t.comando.trim()) continue;
      const recent = (this.fires.get(t.id) ?? []).filter((x) => now - x < 1000);
      recent.push(now);
      this.fires.set(t.id, recent);
      if (recent.length > MAX_FIRES_PER_SECOND) {
        this.triggers = this.triggers.filter((x) => x !== entry);
        result.spenti.push(t);
        continue;
      }
      result.fires.push({ trigger: t, comandi: parseInput(substitute(t.comando, m)) });
    }
    return result;
  }
}
