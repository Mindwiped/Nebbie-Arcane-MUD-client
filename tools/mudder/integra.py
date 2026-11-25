"""
Integra il mondo estratto (`estrai.py`) nei dati del client (richiesta del 2026-11-23).

    python3 integra.py <mondo.json> <cartella reliquiario> <cartella dati app>

- oggetti → `identi.js` (Reliquiario): quelli già presenti restano come sono (statistiche
  dell'identify comprese) e ricevono le note `MUD: …` e il campo `mud`; i nuovi entrano con i dati
  del file. Prima di scrivere si fa una copia `identi.backup-AAAA-MM-GG.js`. Rieseguibile: le note
  `MUD:` si rifanno, gli oggetti già importati si ritrovano col loro numero.
- mob → `mob.js` (`window.MUD_MOB = {…};`), stesso stile del Reliquiario.
- percorsi → `percorsi.json` dell'app: l'ingresso di ogni zona raggiungibile a piedi da Myst.
  Se esiste già un percorso con lo stesso path, la nota del nuovo comincia con "MUD".
"""
import datetime
import json
import os
import re
import shutil
import sys


def clean_name(s):
    t = (s or '').strip()
    while True:
        u = re.sub(r'\s*\([^()]*\)\s*$', '', t)
        if u == t:
            return t.strip()
        t = u


def load_js(path, var):
    s = open(path, encoding='utf-8').read()
    i = s.index('{')
    j = s.rstrip().rstrip(';').rindex('}')
    return json.loads(s[i:j + 1])


def mud_notes(o):
    righe = [f"MUD: #{o['vnum']}, zona {o.get('zona') or '?'} ({o['file']})"]
    if o.get('indossabile'):
        righe.append(f"MUD: si indossa: {' '.join(o['indossabile'])}")
    righe += [f'MUD: {x}' for x in o.get('portatoDa', [])]
    righe += [f'MUD: a terra in {x}' for x in o.get('aTerra', [])]
    return righe


def integra_oggetti(mondo, db, oggi):
    ogg = db.setdefault('oggetti', {})
    per_vnum = {}
    per_nome = {}
    for k, r in ogg.items():
        if isinstance(r.get('mud'), dict) and 'vnum' in r['mud']:
            per_vnum[r['mud']['vnum']] = k
        if r.get('nome'):
            per_nome.setdefault(clean_name(r['nome']).lower(), k)
    # stesse parole chiave e stesso tipo (oggetti della wiki: "Tuareg Ghardaia Takuba Blu" ha
    # chiave "takuba blu"), solo se nel mondo c'è un oggetto solo con quelle parole e quel tipo
    per_parole = {}
    for k, r in ogg.items():
        if not r.get('mud'):
            per_parole.setdefault(((r.get('parole') or r['chiave']).lower(), r.get('tipo')), k)
    quanti = {}
    for o in mondo['oggetti'].values():
        kk = (o['chiave'].lower(), o['tipo'])
        quanti[kk] = quanti.get(kk, 0) + 1
    nuovi = aggiornati = 0
    usati = set()
    for o in sorted(mondo['oggetti'].values(), key=lambda x: x['vnum']):
        k = per_vnum.get(o['vnum']) or per_nome.get(clean_name(o['nome']).lower())
        kk = (o['chiave'].lower(), o['tipo'])
        if k is None and quanti[kk] == 1 and kk in per_parole:
            k = per_parole[kk]
        if k in usati and per_vnum.get(o['vnum']) != k:
            k = None  # due oggetti del mondo sullo stesso del Reliquiario: il secondo è nuovo
        if k is not None:
            usati.add(k)
        mud = {'vnum': o['vnum'], 'zona': o.get('zona'), 'file': o['file']}
        if k is not None:
            r = ogg[k]
            # già nel Reliquiario: si aggiungono solo le note e i dati mancanti
            r['extra'] = [x for x in r.get('extra', []) if not x.startswith('MUD:')] + mud_notes(o)
            r['mud'] = mud
            for campo in ('peso', 'valore', 'rent', 'ac', 'dado', 'tipoDanno', 'livello', 'cariche',
                          'incantesimi'):
                if r.get(campo) in (None, '', []) and o.get(campo) not in (None, '', []):
                    r[campo] = o[campo]
            if not r.get('stats') and o['stats']:
                r['stats'] = dict(o['stats'])
            if o.get('poteri') and not r.get('poteri'):
                r['poteri'] = list(o['poteri'])
            if not r.get('nome'):
                r['nome'] = o['nome']
            aggiornati += 1
            continue
        chiave = o['chiave'] if o['chiave'] not in ogg else f"{o['chiave']} #{o['vnum']}"
        r = {'chiave': chiave, 'nome': o['nome'], 'tipo': o['tipo'], 'flags': o['flags'],
             'stats': dict(o['stats']), 'extra': mud_notes(o), 'visto': oggi, 'mud': mud}
        for campo in ('peso', 'valore', 'rent', 'ac', 'dado', 'tipoDanno', 'livello', 'cariche',
                      'incantesimi', 'poteri'):
            if o.get(campo) not in (None, '', []):
                r[campo] = o[campo]
        ogg[chiave] = r
        per_vnum[o['vnum']] = chiave
        nuovi += 1
    return nuovi, aggiornati


def scrivi_mob(mondo, cartella, oggi):
    mob = {}
    for v, m in sorted(mondo['mob'].items(), key=lambda x: int(x[0])):
        mob[v] = {k: val for k, val in m.items() if val not in (None, [], '')}
    out = {'versione': 1, 'aggiornato': oggi, 'fonte': "file d'area di Nebbie Arcane",
           'partenza': mondo['partenza'],
           'zone': [{'num': z['num'], 'nome': z['nome'], 'da': z['da'], 'a': z['a']}
                    for z in mondo['zone']],
           'mob': mob}
    tmp = os.path.join(cartella, 'mob.js.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.MUD_MOB = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, os.path.join(cartella, 'mob.js'))
    return len(mob)


def integra_percorsi(mondo, path_file):
    d = json.load(open(path_file, encoding='utf-8'))
    P = d.setdefault('percorsi', [])
    # percorsi già noti (dell'utente e del pacchetto) per riconoscere i doppioni
    pacchetto = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'nebbie', 'paths', 'percorsi.json')
    noti = {p['path'].replace(' ', '') for p in P if not p['id'].startswith('mud:')}
    try:
        for z in json.load(open(pacchetto, encoding='utf-8'))['zone']:
            for p in z.get('voci', []):
                noti.add(p['path'].replace(' ', ''))
    except OSError:
        pass
    P[:] = [p for p in P if not p['id'].startswith('mud:')]
    partenza = mondo['partenza']['titolo'] or f"#{mondo['partenza']['stanza']}"
    doppi = 0
    for ing in mondo['ingressi']:
        nota = f"dai file d'area, da {partenza} (#{ing['stanza']}, {ing['passi']} passi)"
        if ing['percorso'] in noti:
            nota = 'MUD ' + nota
            doppi += 1
        voce = {'id': f"mud:{ing['zona'].lower()}/ingresso", 'zona': ing['zona'],
                'nome': f"Ingresso: {ing['titolo']}", 'nota': nota, 'path': ing['percorso'],
                'origine': 'mud', 'partenza': partenza, 'arrivo': ing['titolo']}
        if ing['porte']:
            voce['apriPorte'] = True
        if ing['passi'] > 60:
            voce['troppo'] = f"{ing['passi']} passi: lungo, controlla prima di usarlo"
        P.append(voce)
    tmp = path_file + '.tmp'
    json.dump(d, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    os.replace(tmp, path_file)
    return len(mondo['ingressi']), doppi


def main(mondo_path, reliquiario, dati_app=None):
    mondo = json.load(open(mondo_path, encoding='utf-8'))
    oggi = datetime.date.today().isoformat()
    identi = os.path.join(reliquiario, 'identi.js')
    backup = os.path.join(reliquiario, f'identi.backup-{oggi}.js')
    if not os.path.exists(backup):
        shutil.copy2(identi, backup)
    db = load_js(identi, 'MUD_DB')
    prima = len(db.get('oggetti', {}))
    nuovi, aggiornati = integra_oggetti(mondo, db, oggi)
    tmp = identi + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.MUD_DB = ' + json.dumps(db, ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, identi)
    n_mob = scrivi_mob(mondo, reliquiario, oggi)
    if not dati_app:
        print('percorsi: saltati (manca la cartella dati dell\'app; va chiusa prima)')
        n_path = doppi = None
    else:
        n_path, doppi = integra_percorsi(mondo, os.path.join(dati_app, 'percorsi.json'))
    print(f'oggetti: {prima} → {len(db["oggetti"])} (nuovi {nuovi}, già presenti arricchiti {aggiornati}); '
          f'copia in {os.path.basename(backup)}')
    print(f'mob: {n_mob} in mob.js')
    if n_path is not None:
        print(f'percorsi: {n_path} ingressi di zona ({doppi} uguali a percorsi già noti, nota "MUD")')


if __name__ == '__main__':
    main(*sys.argv[1:4])
