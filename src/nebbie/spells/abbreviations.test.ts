import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE,
  expandSpell,
  importAll,
  kindOf,
  parseAllRow,
  parseSpellFile,
  serializeSpellFile,
  suggestAbbrev,
} from './abbreviations';

describe('abbreviazioni degli incantesimi', () => {
  it('senza bersaglio', () => {
    expect(expandSpell('mm')).toBe("cast 'magic missile'");
  });

  it('con bersaglio (esempio della guida)', () => {
    expect(expandSpell('acid drago')).toBe("cast 'acid blast' drago");
  });

  it('comando reale dal log: di rig', () => {
    expect(expandSpell('di rig')).toBe("cast 'detect invisibility' rig");
  });

  it('i comandi normali passano invariati', () => {
    expect(expandSpell('look')).toBeNull();
    expect(expandSpell('kill mm')).toBeNull();
    expect(expandSpell('')).toBeNull();
    expect(expandSpell('constructor')).toBeNull();
  });

  it('maiuscole come negli alias Mudlet (che sono in minuscolo)', () => {
    expect(expandSpell('MM')).toBeNull();
  });

  it('contiene ancora tutte le 74 abbreviazioni dei vecchi pacchetti Mudlet', () => {
    const abbreviations = (
      'antimagic animated csilence fireball teleport astral majinv mincre mininv mtrack' +
      ' prisma second succor summon armor chain charm chill cloud color curec curse dra' +
      'in encha enchw haste infra knock major mount refre reinc sleep stone acid bolt c' +
      'one cure dark disi disp ffog gust invi know luce mete mirr mon1 mon4 mon5 mon6 m' +
      'on7 para poly port stre weak wipe ele fly ice ide pwb pwk shi slo web wiz di ff ' +
      'fs mm wb'
    ).split(' ');
    expect(abbreviations).toHaveLength(74);
    for (const a of abbreviations) expect(DEFAULT_TABLE[a], a).toBeDefined();
  });

  it('poteri psionici: comando diretto senza cast (log reale: doorway niobe)', () => {
    expect(expandSpell('doorw niobe')).toBe('doorway niobe');
    expect(expandSpell('pfe rig')).toBe("cast 'protection from evil' rig");
  });
});

describe('elenco ALL del MUD (output reale del 2026-11-15)', () => {
  const rows = readFileSync('fixtures/all_reale.txt', 'utf8')
    .split('\n')
    .map(parseAllRow)
    .filter((r) => r !== null);

  it('legge tutte le 261 righe e le divide in incantesimi, psionici e abilità', () => {
    expect(rows).toHaveLength(261);
    expect(rows[0]).toEqual({ nome: 'armor', mana: 5, livelli: [2, 5, 52, 5, 52, 52, 52] });
    const count = (k: string) => rows.filter((r) => kindOf(r) === k).length;
    expect([count('incantesimo'), count('psionico'), count('abilita')]).toEqual([181, 34, 46]);
    const kind = (n: string) => kindOf(rows.find((r) => r.nome === n)!);
    expect(kind('bash')).toBe('abilita');
    expect(kind('parry')).toBe('abilita'); // mana 0
    expect(kind('doorway')).toBe('psionico');
    expect(kind('cure light')).toBe('incantesimo');
  });

  it('la tabella predefinita copre tutti gli incantesimi e i psionici: niente da importare', () => {
    expect(importAll(DEFAULT_TABLE, rows).aggiunte).toEqual([]);
  });

  it('importando su una tabella vuota le abbreviazioni sono uniche e mai su un comando', () => {
    const { table, aggiunte } = importAll({}, rows);
    expect(aggiunte).toHaveLength(215);
    expect(new Set(Object.keys(table)).size).toBe(215);
    expect(table.cturn).toEqual({ nome: 'turn' });
    expect(table.turn).toBeUndefined();
    expect(suggestAbbrev('protection from evil')).toBe('pfe');
    expect(suggestAbbrev('cure light')).toBe('culi');
    expect(suggestAbbrev('fireball')).toBe('fireb');
  });

  it('file dell utente: lettura tollerante e salvataggio', () => {
    const t = parseSpellFile(
      JSON.stringify({
        versione: 1,
        voci: { 'x y': { nome: 'a' }, CL: { nome: ' Cure Light ' }, z: {} },
      }),
    );
    expect(t).toEqual({ cl: { nome: 'cure light' } });
    expect(parseSpellFile(serializeSpellFile(t))).toEqual(t);
    expect(parseSpellFile(null)).toEqual(DEFAULT_TABLE);
  });
});
