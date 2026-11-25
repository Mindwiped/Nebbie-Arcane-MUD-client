import { describe, expect, it } from 'vitest';
import { mobLine, parseMobDb, searchMobs } from './bestiario';

// due mob sintetici nel formato di mob.js (generato da tools/mudder)
const testo = `window.MUD_MOB = ${JSON.stringify({
  versione: 1,
  partenza: { stanza: 1, titolo: 'Piazza' },
  mob: {
    '10': {
      vnum: 10,
      chiave: 'mago vecchio',
      nome: 'Un vecchio mago',
      livello: 51,
      zona: 'Città',
      incantesimi: ['SANCTUARY', 'FIRESHIELD'],
      immunita: ['SLEEP', 'CHARM'],
      equip: [{ vnum: 5, slot: 'impugnato', nome: 'un bastone nodoso' }],
      spawn: [{ stanza: 3, titolo: 'Torre', percorso: 's,2e', passi: 3 }],
    },
    '11': {
      vnum: 11,
      chiave: 'zombie',
      nome: 'Uno zombie',
      livello: 9,
      zona: 'Cimitero',
      flag: ['AGGRESSIVE'],
      suscettibilita: ['FIRE'],
    },
  },
})};\n`;

describe('Bestiario', () => {
  it('legge mob.js e cerca per parole, oggetti portati e livello', () => {
    const db = parseMobDb(testo);
    expect(Object.keys(db.mob)).toHaveLength(2);
    expect(searchMobs(db, '').map((m) => m.vnum)).toEqual([10, 11]); // livello decrescente
    expect(searchMobs(db, 'bastone').map((m) => m.vnum)).toEqual([10]);
    expect(searchMobs(db, 'sanctuary citta').map((m) => m.vnum)).toEqual([10]);
    expect(searchMobs(db, 'lvl<20').map((m) => m.vnum)).toEqual([11]);
    expect(searchMobs(db, 'lvl>20 zombie')).toEqual([]);
  });

  it('riga breve: sanctuary, aggressivo, immunità, suscettibilità, pezzi', () => {
    const db = parseMobDb(testo);
    expect(mobLine(db.mob['10'])).toBe('sanct · imm sleep charm · 1 pezzi');
    expect(mobLine(db.mob['11'])).toBe('aggressivo · susc fire');
  });

  it('testo senza database: errore chiaro', () => {
    expect(() => parseMobDb('niente')).toThrow(/mob/);
  });
});
