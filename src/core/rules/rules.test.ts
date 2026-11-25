import { describe, expect, it } from 'vitest';
import { parseRule, presetRules, RulesEngine, type Rule } from './rules';

function setup(rules: Rule[], combat = false) {
  let now = 0;
  const fired: string[] = [];
  const e = new RulesEngine({
    now: () => now,
    inCombat: () => combat,
    run: (r, s) => void fired.push(`${r.nome}:${s ?? ''}`),
  });
  e.enabled = true;
  e.rules = rules;
  return { e, fired, advance: (ms: number) => (now += ms) };
}

const on = (r: Rule): Rule => ({ ...r, attiva: true });

describe('regole sullo stato', () => {
  it('second wind: sotto 70 MV scatta, poi riprova ogni 8 s finché vale', () => {
    const [sw] = presetRules();
    const { e, fired, advance } = setup([on(sw)]);
    e.values({ mv: 80 });
    e.values({ mv: 60 });
    e.values({ mv: 55 });
    advance(8000);
    e.values({ mv: 50 });
    expect(fired).toEqual([
      'second wind con poco movimento:60',
      'second wind con poco movimento:50',
    ]);
  });

  it('percentuale sul massimo', () => {
    const r: Rule = {
      ...on(presetRules()[0]),
      quando: { tipo: 'valore', campo: 'hp', op: '<', soglia: 30, percento: true },
    };
    const { e, fired } = setup([r]);
    e.values({ hp: 200, hpMax: 500 });
    e.values({ hp: 100, hpMax: 500 });
    expect(fired).toHaveLength(1);
  });

  it('eventi con filtro, combattimento e regole spente', () => {
    const [, monete, stand] = presetRules();
    const filtrata: Rule = {
      ...on(monete),
      id: 'x',
      nome: 'drago',
      quando: { tipo: 'evento', evento: 'mobUcciso', filtro: 'drago' },
    };
    const fuori: Rule = { ...on(stand), combattimento: 'fuori' };
    const { e, fired } = setup([on(monete), filtrata, fuori, presetRules()[0]], true);
    e.event('mobUcciso', 'un orco');
    e.event('mobUcciso', 'il Drago Rosso');
    e.event('atterrato', 'bash');
    expect(fired).toEqual([
      'monete dopo un uccisione:un orco',
      'monete dopo un uccisione:il Drago Rosso',
      'drago:il Drago Rosso',
    ]);
  });

  it('interruttore generale e massimo di scatti', () => {
    const r: Rule = { ...on(presetRules()[1]), maxVolte: 1 };
    const { e, fired } = setup([r]);
    e.event('mobUcciso', 'a');
    e.event('mobUcciso', 'b');
    e.enabled = false;
    e.event('mobUcciso', 'c');
    expect(fired).toHaveLength(1);
  });

  it('lettura tollerante', () => {
    expect(parseRule({ quando: { tipo: 'valore', campo: 'xx' } })).toBeNull();
    expect(parseRule(JSON.parse(JSON.stringify(presetRules()[2])))).toEqual(presetRules()[2]);
  });
});
