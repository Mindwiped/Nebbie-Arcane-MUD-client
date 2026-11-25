import { describe, expect, it } from 'vitest';
import { AutomationEngine, substitute } from './engine';
import {
  emptyAutomation,
  GLOBAL,
  newAlias,
  newGroup,
  newTrigger,
  parseAutomation,
  validateAlias,
  validateTrigger,
  type AutomationFile,
} from './model';

function setup(edit: (f: AutomationFile, g: string) => void, profile = 'p1') {
  const f = emptyAutomation();
  edit(f, f.gruppi[0].id);
  let now = 0;
  const e = new AutomationEngine(() => now);
  e.load(f, profile);
  return { e, f, tick: (ms: number) => (now += ms) };
}

describe('alias', () => {
  it('con gruppi della regex e più comandi', () => {
    const { e } = setup((f, g) => {
      f.alias.push({ ...newAlias(g), pattern: String.raw`kk (\w+)`, azione: 'kill $1;bash $1' });
    });
    expect(e.expand('kk orco')).toEqual(['kill orco', 'bash orco']);
  });

  it('ancorato: non scatta dentro un altro comando', () => {
    const { e } = setup((f, g) => {
      f.alias.push({ ...newAlias(g), pattern: 'k', azione: 'kill' });
    });
    expect(e.expand('kick')).toBeNull();
    expect(e.expand('k')).toEqual(['kill']);
  });

  it('alias che usa un altro alias, con limite ai cicli', () => {
    const { e } = setup((f, g) => {
      f.alias.push({ ...newAlias(g), pattern: 'a', azione: 'b;#2 n' });
      f.alias.push({ ...newAlias(g), pattern: 'b', azione: 'look' });
      f.alias.push({ ...newAlias(g), pattern: 'loop', azione: 'loop' });
    });
    expect(e.expand('a')).toEqual(['look', 'n', 'n']);
    expect(e.expand('loop')).toEqual(['loop']);
  });

  it('gruppo spento o di un altro profilo: alias ignorato', () => {
    const { e } = setup((f) => {
      const off = { ...newGroup('spento'), attivo: false };
      const other = newGroup('altro pg', 'p2');
      f.gruppi.push(off, other);
      f.alias.push({ ...newAlias(off.id), pattern: 'x', azione: 'y' });
      f.alias.push({ ...newAlias(other.id), pattern: 'z', azione: 'w' });
    });
    expect(e.expand('x')).toBeNull();
    expect(e.expand('z')).toBeNull();
  });
});

describe('trigger', () => {
  it('testo semplice: comando con i gruppi solo per le regex', () => {
    const { e } = setup((f, g) => {
      f.trigger.push({ ...newTrigger(g), pattern: 'grido di morte', comando: 'get all.coin corp' });
    });
    const r = e.matchLine('Il tuo sangue si gela al grido di morte di la Ronda.');
    expect(r.fires.map((x) => x.comandi)).toEqual([['get all.coin corp']]);
  });

  it('regex con gruppi, colore e nascondi', () => {
    const { e } = setup((f, g) => {
      f.trigger.push({
        ...newTrigger(g),
        tipo: 'regex',
        pattern: String.raw`^(\w+) arriva da (\w+)\.$`,
        comando: 'say ciao $1',
        colore: '#ff0',
      });
      f.trigger.push({ ...newTrigger(g), pattern: 'You hear squeaking', nascondi: true });
    });
    const r = e.matchLine('Pippo arriva da nord.');
    expect(r.fires[0].comandi).toEqual(['say ciao Pippo']);
    expect(r.colore).toBe('#ff0');
    expect(e.matchLine('You hear squeaking noises nearby').nascondi).toBe(true);
  });

  it('il testo semplice non è una regex (punti e parentesi letterali)', () => {
    const { e } = setup((f, g) => {
      f.trigger.push({ ...newTrigger(g), pattern: 'e.(x)', colore: 'red' });
    });
    expect(e.matchLine('aexx').colore).toBeUndefined();
    expect(e.matchLine('e.(x)').colore).toBe('red');
  });

  it('un trigger che scatta di continuo viene spento', () => {
    const { e, tick } = setup((f, g) => {
      f.trigger.push({ ...newTrigger(g), nome: 'ciclo', pattern: 'eco', comando: 'say eco' });
    });
    for (let i = 0; i < 5; i++) {
      expect(e.matchLine('eco').fires).toHaveLength(1);
      tick(100);
    }
    const r = e.matchLine('eco');
    expect(r.fires).toEqual([]);
    expect(r.spenti.map((t) => t.nome)).toEqual(['ciclo']);
    expect(e.matchLine('eco').fires).toEqual([]);
  });
});

describe('modello delle automazioni', () => {
  it('sostituzioni $0…$9', () => {
    const m = /(\w+) (\w+)/.exec('ciao mondo')!;
    expect(substitute('$0|$1|$2|$3', m)).toBe('ciao mondo|ciao|mondo|');
  });

  it('validazione', () => {
    expect(validateAlias({ ...newAlias('g'), pattern: '(', azione: 'x' })[0]).toMatch(/non valida/);
    expect(validateTrigger({ ...newTrigger('g'), pattern: 'x' })[0]).toMatch(/non fa niente/);
    expect(validateTrigger({ ...newTrigger('g'), pattern: 'x', nascondi: true })).toEqual([]);
  });

  it('lettura tollerante: gruppo mancante -> Generale, voci rotte scartate', () => {
    const f = parseAutomation(
      JSON.stringify({ alias: [{ id: 'a1', gruppo: 'nessuno', pattern: 'x', azione: 'y' }, null] }),
    );
    expect(f.gruppi[0].ambito).toBe(GLOBAL);
    expect(f.alias).toHaveLength(1);
    expect(f.alias[0].gruppo).toBe(f.gruppi[0].id);
    expect(() => parseAutomation('{')).toThrow(/danneggiato/);
  });
});
