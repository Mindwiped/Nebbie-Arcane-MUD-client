import { describe, expect, it } from 'vitest';
import { cleanLayoutName, DEFAULT_LAYOUT_NAME, parseLayouts } from './layouts';

describe('layout salvati', () => {
  it('file assente o danneggiato: layout vuoto con il nome predefinito', () => {
    expect(parseLayouts(null)).toEqual({ versione: 1, attivo: DEFAULT_LAYOUT_NAME, layouts: {} });
    expect(parseLayouts('{').attivo).toBe(DEFAULT_LAYOUT_NAME);
    expect(parseLayouts('{"layouts":[1,2]}').layouts).toEqual({});
  });

  it('mantiene i layout e quello attivo', () => {
    const f = parseLayouts('{"attivo":"caccia","layouts":{"caccia":{"grid":1}}}');
    expect(f.attivo).toBe('caccia');
    expect(f.layouts.caccia).toEqual({ grid: 1 });
  });

  it('nomi dei layout', () => {
    expect(cleanLayoutName('  caccia   notturna ')).toBe('caccia notturna');
    expect(cleanLayoutName('   ')).toBeNull();
    expect(cleanLayoutName('x'.repeat(41))).toBeNull();
  });
});
