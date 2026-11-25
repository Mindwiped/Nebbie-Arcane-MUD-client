import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plainSpans } from '../../core/spans';
import {
  compilePromptRegex,
  DEFAULT_PROMPT_REGEX,
  findPrompt,
  parseMudNumber,
  splitPrompts,
} from './promptParser';

const re = compilePromptRegex(DEFAULT_PROMPT_REGEX);
const summary = (line: string) =>
  splitPrompts(plainSpans(line), re).map((p) => `${p.kind}:${p.text}`);

describe('regex predefinita del prompt', () => {
  it('legge il prompt di esempio (Rigel)', () => {
    const m = findPrompt('Rigel H481 M493 V247 X-28602993 [T] */*>>', re);
    expect(m?.data).toEqual({
      raw: 'Rigel H481 M493 V247 X-28602993 [T] */*>>',
      nome: 'Rigel',
      hp: 481,
      mp: 493,
      mv: 247,
      xp: -28602993,
      affetti: 'T',
    });
  });

  it('incantesimi attivi e condizione di tank e bersaglio (log reale)', () => {
    const d = findPrompt(
      'Rigel H539 M791 V226 X-133.022.330 [STM] eccellente/graffiato>>',
      re,
    )?.data;
    expect(d).toMatchObject({ affetti: 'STM', tank: 'eccellente', target: 'graffiato' });
    const nessuno = findPrompt('Vega H376 M161 V159 X-14.561.288 [] */*>>', re)?.data;
    expect(nessuno).toMatchObject({ affetti: '' });
    expect(nessuno).not.toHaveProperty('tank');
    expect(nessuno).not.toHaveProperty('target');
  });

  it('prompt nuovo con l oro e senza >> finale (log reale)', () => {
    const d = findPrompt(
      'Rigel H539 M950 V257 X-134.368.570 G29.640.568 [TM] graffiato/tagliata',
      re,
    )?.data;
    expect(d).toMatchObject({
      hp: 539,
      xp: -134368570,
      oro: 29640568,
      affetti: 'TM',
      tank: 'graffiato',
      target: 'tagliata',
    });
  });

  it('prompt nuovo con testo attaccato: il testo resta fuori', () => {
    expect(
      summary("Rigel H539 M950 V257 X-134.464.718 G29.640.568 [T] */* Le porte della citta'"),
    ).toEqual([
      'prompt:Rigel H539 M950 V257 X-134.464.718 G29.640.568 [T] */*',
      "text:Le porte della citta'",
    ]);
  });

  it('prompt a metà modifica (solo fino alla X) riconosciuto lo stesso', () => {
    expect(findPrompt('Rigel H539 M950 V257 X-134.368.570', re)?.data.xp).toBe(-134368570);
  });

  it('funziona con qualunque nome di personaggio', () => {
    expect(findPrompt('Aldebaran H120 M40 V90 X1500 [T] */*>>', re)?.data.nome).toBe('Aldebaran');
  });

  it('legge i massimi quando il prompt li mostra', () => {
    const d = findPrompt('Pg H428/500 M619/692 V128/130 X24.775.191 */*>>', re)?.data;
    expect(d).toMatchObject({ hp: 428, hpMax: 500, mpMax: 692, mvMax: 130, xp: 24775191 });
  });

  it('non scambia una riga normale per un prompt', () => {
    expect(findPrompt('La tua esperienza e aumentata di 411.508 punti.', re)).toBeNull();
  });
});

describe('separatore del prompt', () => {
  it('stacca il testo attaccato dopo il prompt', () => {
    expect(summary('Pg H1 M2 V3 X4 [T] */*>> Stai trasportando:')).toEqual([
      'prompt:Pg H1 M2 V3 X4 [T] */*>>',
      'text:Stai trasportando:',
    ]);
  });

  it('gestisce più prompt sulla stessa riga', () => {
    expect(summary('Pg H1 M2 V3 X4>> Pg H1 M2 V2 X4>> Non puoi andare da quella parte...')).toEqual(
      [
        'prompt:Pg H1 M2 V3 X4>>',
        'prompt:Pg H1 M2 V2 X4>>',
        'text:Non puoi andare da quella parte...',
      ],
    );
  });

  it('prompt da solo con lo spazio finale', () => {
    expect(summary('Pg H1 M2 V3 X4>> ')).toEqual(['prompt:Pg H1 M2 V3 X4>>']);
  });

  it('una riga vuota resta una riga', () => {
    expect(summary('')).toEqual(['text:']);
  });

  it('mantiene i colori del testo attaccato', () => {
    const parts = splitPrompts([{ text: 'Pg H1 M2 V3 X4>> ' }, { text: 'Rosso', fg: 1 }], re);
    expect(parts[1].spans).toEqual([{ text: 'Rosso', fg: 1 }]);
  });

  it('fixture sintetica prompt_testo_attaccato.log', () => {
    const lines = readFileSync('fixtures/sintetici/prompt_testo_attaccato.log', 'utf8')
      .split('\n')
      .filter((l) => l !== '');
    const all = lines.flatMap((l) => splitPrompts(plainSpans(l), re));
    const prompts = all.filter((p) => p.kind === 'prompt');
    const texts = all.filter((p) => p.kind === 'text').map((p) => p.text);
    expect(prompts).toHaveLength(6);
    expect(new Set(prompts.map((p) => (p.kind === 'prompt' ? p.data.nome : '')))).toEqual(
      new Set(['Rigel', 'Aldebaran']),
    );
    expect(texts).toEqual([
      'Stai trasportando:',
      'Stai usando:',
      'Non puoi andare da quella parte...',
      "La tua esperienza e' aumentata di 411.508 punti.",
      'Questa riga non contiene prompt.',
    ]);
  });
});

describe('regex dei profili', () => {
  it('rifiuta regex non valide o che riconoscono il vuoto', () => {
    expect(() => compilePromptRegex('(')).toThrow(/non valida/);
    expect(() => compilePromptRegex('a*')).toThrow(/vuoto/);
    expect(() => compilePromptRegex('  ')).toThrow(/vuota/);
  });

  it('numeri del MUD con i punti delle migliaia', () => {
    expect(parseMudNumber('309.364')).toBe(309364);
    expect(parseMudNumber('-28602993')).toBe(-28602993);
    expect(parseMudNumber('abc')).toBeUndefined();
  });
});

describe('fixture reale sessione_reale_prompt.log', () => {
  // Formato del log di sessione: <ms>\t<L|P|C|S>\t<testo con codici ANSI>
  const entries = readFileSync('fixtures/sessione_reale_prompt.log', 'utf8')
    .split('\n')
    .filter((l) => /^\d+\t[LPCS]\t/.test(l))
    .map((l) => {
      const [, kind, ...rest] = l.split('\t');
      // eslint-disable-next-line no-control-regex
      const text = rest.join('\t').replace(/\x1b\[[0-9;]*m/g, '');
      return { kind, text };
    });

  it('ogni riga P è un prompt di Rigel con i valori giusti', () => {
    const prompts = entries.filter((e) => e.kind === 'P');
    expect(prompts.length).toBeGreaterThan(5);
    for (const { text } of prompts) {
      const parts = splitPrompts(plainSpans(text), re);
      expect(parts).toHaveLength(1);
      const [p] = parts;
      expect(p.kind).toBe('prompt');
      if (p.kind !== 'prompt') continue;
      expect(p.data).toMatchObject({ nome: 'Rigel', hp: 539, xp: -132726485 });
      expect(p.data.mp).toBeGreaterThan(0);
      expect(p.data.mv).toBeGreaterThan(0);
    }
  });

  it('nessuna riga L viene scambiata per un prompt', () => {
    for (const { text } of entries.filter((e) => e.kind === 'L')) {
      expect(findPrompt(text, re)).toBeNull();
    }
  });
});
