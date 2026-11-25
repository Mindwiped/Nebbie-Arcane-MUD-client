import { describe, expect, it } from 'vitest';
import { emptyVitals, percent, updateVitals } from './vitals';

describe('vitals', () => {
  it('massimo dal prompt ha la precedenza', () => {
    const v = updateVitals(emptyVitals(), { raw: '', hp: 50, hpMax: 100 }, { hp: 500 });
    expect(v.hp).toEqual({ value: 50, max: 100, maxSource: 'prompt' });
  });

  it("massimo dall'ultimo score: vince sul profilo, perde sul prompt", () => {
    const score = { hp: 539, mp: 950, mv: 259 };
    expect(updateVitals(emptyVitals(), { raw: '', hp: 500 }, { hp: 400 }, score).hp).toEqual({
      value: 500,
      max: 539,
      maxSource: 'score',
    });
    expect(updateVitals(emptyVitals(), { raw: '', hp: 5, hpMax: 10 }, {}, score).hp.maxSource).toBe(
      'prompt',
    );
  });

  it('massimo dal profilo', () => {
    const v = updateVitals(emptyVitals(), { raw: '', hp: 481 }, { hp: 500 });
    expect(v.hp).toEqual({ value: 481, max: 500, maxSource: 'profilo' });
  });

  it('senza massimi: stima dal valore più alto visto', () => {
    let v = updateVitals(emptyVitals(), { raw: '', mv: 247 }, {});
    v = updateVitals(v, { raw: '', mv: 200 }, {});
    expect(v.mv).toEqual({ value: 200, max: 247, maxSource: 'stimato' });
    expect(percent(v.mv)).toBeCloseTo(80.97, 1);
  });

  it('un campo assente nel prompt mantiene il valore precedente', () => {
    let v = updateVitals(emptyVitals(), { raw: '', hp: 10, mp: 20 }, {});
    v = updateVitals(v, { raw: '', hp: 9 }, {});
    expect(v.mp.value).toBe(20);
  });

  it('percentuale limitata e senza dati', () => {
    expect(percent({ value: 600, max: 500 })).toBe(100);
    expect(percent({ value: -5, max: 500 })).toBe(0);
    expect(percent({})).toBe(0);
  });
});
