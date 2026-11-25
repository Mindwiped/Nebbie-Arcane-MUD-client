import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../parser/types';
import {
  allPaths,
  BUILTIN_PATHS,
  compactPath,
  emptyPathsFile,
  expandPath,
  filterPaths,
  findPaths,
  groupByZone,
  invertPath,
  parsePaths,
  type PathEntry,
} from './paths';
import { PathRecorder } from './recorder';

const P = (zona: string, nome: string, path = 'n'): PathEntry => ({
  id: `t:${zona}/${nome}`,
  zona,
  nome,
  nota: '',
  path,
  origine: 'registrato',
});

describe('percorsi', () => {
  it('ci sono tutti i percorsi del pacchetto Mudlet', () => {
    expect(BUILTIN_PATHS).toHaveLength(127);
    expect(groupByZone(BUILTIN_PATHS)).toHaveLength(52);
    expect(BUILTIN_PATHS[0]).toMatchObject({ zona: 'Astral', nome: 'Myst', path: 'n' });
  });

  it('espansione come in Mudlet: numeri davanti alle direzioni, comandi lasciati com sono', () => {
    expect(expandPath('2w, run e,3n,open frasca,,u')).toEqual([
      'w',
      'w',
      'run e',
      'n',
      'n',
      'n',
      'open frasca',
      'u',
    ]);
  });

  it('ricerca per nome (esatto prima, poi contenuto, senza accenti né maiuscole)', () => {
    const list = allPaths({
      ...emptyPathsFile(),
      percorsi: [P('Skexie', 'Mantern1'), P('Skexie', 'Mantern2', 'w')],
    });
    expect(findPaths(list, 'mantern2').map((p) => p.nome)).toEqual(['Mantern2']);
    expect(findPaths(list, 'mantern').map((p) => p.nome)).toEqual(['Mantern1', 'Mantern2']);
    expect(findPaths(list, '')).toEqual([]);
    expect(filterPaths(list, 'skexie').length).toBeGreaterThanOrEqual(2);
  });

  it('zone con maiuscole diverse finiscono insieme', () => {
    const z = groupByZone([P('Foresta Incantata', 'A'), P('foresta incantata', 'B')]);
    expect(z).toHaveLength(1);
    expect(z[0].voci).toHaveLength(2);
  });

  it('file della versione 1: i registrati diventano percorsi con id stabile', () => {
    const f = parsePaths('{"registrati":[{"nome":"Malar","path":"run s,e"},{"x":1}]}');
    expect(f.percorsi).toEqual([
      {
        id: 'u:registrati/malar',
        zona: 'Registrati',
        nome: 'Malar',
        nota: '',
        path: 'run s,e',
        origine: 'registrato',
      },
    ]);
    expect(parsePaths('{"registrati":[{"nome":"Malar","path":"n"}]}').percorsi[0].id).toBe(
      f.percorsi[0].id,
    );
  });

  it('versione 2: nascosti e copie tolgono i percorsi del pacchetto dall elenco', () => {
    const myst = BUILTIN_PATHS[0];
    const copia = { ...P('Astral', 'Myst', 'n,n'), sostituisce: myst.id };
    const f = parsePaths(
      JSON.stringify({
        versione: 2,
        percorsi: [copia],
        nascosti: [BUILTIN_PATHS[1].id],
        preferiti: [copia.id],
        usati: { [copia.id]: 5, x: 'no' },
      }),
    );
    expect(f.usati).toEqual({ [copia.id]: 5 });
    const all = allPaths(f);
    expect(all).toHaveLength(127 - 2 + 1);
    expect(all.find((p) => p.nome === 'Myst')?.path).toBe('n,n');
  });

  it('gli id del pacchetto sono tutti diversi', () => {
    expect(new Set(BUILTIN_PATHS.map((p) => p.id)).size).toBe(BUILTIN_PATHS.length);
  });

  it('compatta le direzioni ripetute', () => {
    expect(compactPath(['n', 'n', 'n', 'open frasca', 'w', 'run e', 'run e', 'w'])).toBe(
      '3n,open frasca,w,run e,run e,w',
    );
    expect(expandPath(compactPath(['e', 'e', 's']))).toEqual(['e', 'e', 's']);
  });
});

describe('inversione', () => {
  it('direzioni opposte in ordine inverso, porte davanti allo stesso passaggio', () => {
    const r = invertPath(['n', 'open n', 'n', 'ne', 'u']);
    expect(r.passi).toEqual(['d', 'sw', 'open s', 's', 's']);
    expect(r.dubbi).toEqual([]);
  });

  it('segnala quello che non si inverte da solo', () => {
    const r = invertPath(['open frasca', 'w', 'run e', 'enter portale']);
    expect(r.passi).toEqual(['enter portale', 'run w', 'open frasca', 'e']);
    expect(r.dubbi).toHaveLength(3);
  });
});

const room = (titolo: string, guardata = false): RoomEvent => ({
  titolo,
  righeDescrizione: [],
  uscite: [],
  usciteRiga: '',
  visibili: [],
  contenuti: [],
  guardata,
});

describe('registratore', () => {
  it('tiene i passi riusciti, scarta muri, porte chiuse e look', () => {
    const r = new PathRecorder('Piazza');
    r.command('n');
    r.room(room('Strada'));
    r.prompt();
    r.command('look e');
    r.room(room('Bosco', true));
    r.prompt();
    r.command('e');
    r.moveFailed({ motivo: 'muro', testo: 'Non puoi andare da quella parte.' });
    r.prompt();
    r.command('open porta');
    r.door({ azione: 'aperta' });
    r.prompt();
    r.command('e');
    r.room(room('Casa'));
    r.prompt();
    r.command('score');
    r.prompt();
    expect(r.state).toEqual({
      passi: ['n', 'open porta', 'e'],
      partenza: 'Piazza',
      pausa: false,
      avvisi: [],
    });
  });

  it('comandi scritti di fila: ognuno prende la sua risposta', () => {
    const r = new PathRecorder();
    r.command('n');
    r.command('n');
    r.command('w');
    r.room(room('A'));
    r.prompt();
    r.moveFailed({ motivo: 'porta', testo: "La porta e' chiusa." });
    r.prompt();
    r.room(room('B'));
    r.prompt();
    expect(r.state.passi).toEqual(['n', 'w']);
  });

  it('un run vale anche se finisce contro una porta; i portali valgono se cambiano stanza', () => {
    const r = new PathRecorder();
    r.command('run e');
    r.room(room('A'));
    r.room(room('B'));
    r.moveFailed({ motivo: 'porta', testo: "La porta e' chiusa." });
    r.prompt();
    r.command('enter portale');
    r.room(room('Altrove'));
    r.prompt();
    expect(r.state.passi).toEqual(['run e', 'enter portale']);
  });

  it('pausa, annulla e spostamenti senza comando', () => {
    const r = new PathRecorder();
    r.command('n');
    r.room(room('A'));
    r.prompt();
    r.setPaused(true);
    r.command('s');
    r.room(room('B'));
    r.prompt();
    r.setPaused(false);
    r.room(room('Fermata'));
    expect(r.state.passi).toEqual(['n']);
    expect(r.state.avvisi).toHaveLength(1);
    expect(r.undo()).toBe('n');
    expect(r.state.passi).toEqual([]);
  });
});
