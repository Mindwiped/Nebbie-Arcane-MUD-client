"""
Estrattore dei file d'area di Nebbie Arcane (formato SillyMUD: .wld .mob .obj .zon).

Richiesta dell'utente del 2026-11-23: dai file d'area estrarre oggetti, mob e percorsi.
Questo script legge i file e scrive un JSON intermedio con tutto il mondo decodificato; i dati
del gioco NON stanno nel repository (si passano le cartelle sulla riga di comando).

    python3 estrai.py <cartella aree> <binario server> <uscita.json>

- i nomi dei bit (flag, incantesimi, immunità, tipi…) vengono dalle tabelle del binario del
  server (`elftables.py`), così corrispondono a quelli che il MUD mostra con identify;
- se la stessa area c'è in più cartelle (es. `Aree_base/`), vince il file più recente.
"""
import json
import os
import re
import sys
from collections import defaultdict, deque

sys.path.insert(0, os.path.dirname(__file__))
from elftables import read_tables  # noqa: E402

DIRS = ['n', 'e', 's', 'w', 'u', 'd']

# Posizioni dell'equipaggiamento (WEAR_*), con le parole che il MUD usa in `eq`.
SLOT = ['come luce', 'sul dito destro', 'sul dito sinistro', 'intorno al collo', 'intorno al collo',
        'sul corpo', 'in testa', 'sulle gambe', 'ai piedi', 'sulle mani', 'sulle braccia',
        'come scudo', 'intorno al corpo', 'intorno alla vita', 'al polso destro',
        'al polso sinistro', 'impugnato', 'tenuto', 'sulla schiena', "all'orecchio destro",
        "all'orecchio sinistro", 'sugli occhi']


# ---------------------------------------------------------------- lettura base

class Reader:
    def __init__(self, text, nome):
        self.lines = text.replace('\r', '').split('\n')
        self.i = 0
        self.nome = nome

    def eof(self):
        return self.i >= len(self.lines)

    def peek(self):
        return self.lines[self.i] if not self.eof() else ''

    def line(self):
        s = self.peek()
        self.i += 1
        return s

    def tilde(self):
        """Stringa fino alla riga che finisce con ~ (anche su più righe)."""
        out = []
        while not self.eof():
            s = self.line()
            r = s.rstrip()
            if r.endswith('~'):
                out.append(r[:-1])
                break
            out.append(s)
        # codici colore del MUD ($c0015…) fuori: nei nomi si vede il testo
        t = re.sub(r'\$[cC]\d{4}', '', '\n'.join(out))
        return re.sub(r'[ \t]{2,}', ' ', t).strip()

    def nums(self):
        """Numeri della prossima riga non vuota (i flag scritti `2|64` si sommano)."""
        while not self.eof() and not self.peek().strip():
            self.i += 1
        out = []
        for t in self.line().split():
            if re.fullmatch(r'-?\d+(\|-?\d+)*', t):
                out.append(sum(int(x) for x in t.split('|')))
            else:
                out.append(t)
        return out


def bits(n, names):
    if not isinstance(n, int) or n <= 0:
        return []
    out = []
    for i in range(40):
        if n & (1 << i):
            out.append(names[i] if i < len(names) and names[i] not in (None, '\n') else f'BIT{i}')
    return out


def pick_files(root):
    """basename.ext → percorso più recente (cartella principale, Aree_base, Da Builder…)."""
    best = {}
    for dirpath, _, files in os.walk(root):
        for f in files:
            ext = f.rsplit('.', 1)[-1] if '.' in f else ''
            if ext not in ('wld', 'mob', 'obj', 'zon'):
                continue
            p = os.path.join(dirpath, f)
            k = f.lower()
            if k not in best or os.path.getmtime(p) > os.path.getmtime(best[k]):
                best[k] = p
    return best


def read_text(p):
    raw = open(p, 'rb').read()
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('latin-1')


# ---------------------------------------------------------------- stanze

def parse_wld(text, nome, T):
    r = Reader(text, nome)
    rooms = {}
    while not r.eof():
        s = r.line().strip()
        m = re.fullmatch(r'#(\d+)', s)
        if not m:
            continue
        vnum = int(m.group(1))
        if vnum >= 99999:
            break
        try:
            titolo = r.tilde()
            r.tilde()  # descrizione
            n = r.nums()
            flags = n[1] if len(n) > 1 and isinstance(n[1], int) else 0
            sector = n[2] if len(n) > 2 and isinstance(n[2], int) else 0
            room = {'vnum': vnum, 'titolo': titolo, 'flags': bits(flags, T['room_bits']),
                    'settore': (T['sector_types'][sector] if 0 <= sector < 13 else sector),
                    'uscite': {}, 'file': nome}
            while not r.eof():
                s = r.peek().strip()
                if s.startswith('#'):
                    break
                r.line()
                if s == 'S':
                    break
                if re.fullmatch(r'D\d', s):
                    d = int(s[1])
                    r.tilde()
                    kw = r.tilde()
                    e = r.nums()
                    if d < 6 and len(e) >= 3 and isinstance(e[2], int):
                        tipo = e[0] if isinstance(e[0], int) else 0
                        room['uscite'][DIRS[d]] = {'a': e[2], 'porta': tipo != 0, 'chiave': e[1],
                                                   'parola': kw.split()[0] if kw else ''}
                elif s == 'E':
                    r.tilde()
                    r.tilde()
            rooms[vnum] = room
        except Exception as ex:  # record rovinato: si salta
            print(f'  stanza #{vnum} in {nome}: {ex}', file=sys.stderr)
    return rooms


# ---------------------------------------------------------------- mob

def parse_mob(text, nome, T):
    r = Reader(text, nome)
    mobs = {}
    while not r.eof():
        s = r.line().strip()
        m = re.fullmatch(r'#(\d+)', s)
        if not m:
            continue
        vnum = int(m.group(1))
        if vnum >= 99999:
            break
        try:
            chiave = r.tilde()
            corto = r.tilde()
            lungo = r.tilde()
            r.tilde()  # descrizione
            a = r.nums()
            act, aff, align = a[0], a[1], a[2]
            letter = a[3] if len(a) > 3 else 'S'
            mob = {'vnum': vnum, 'chiave': chiave, 'nome': corto, 'descrizione': lungo,
                   'allineamento': align, 'file': nome,
                   'flag': [x for x in bits(act, T['action_bits']) if x != 'ISNPC'],
                   'incantesimi': bits(aff, T['affected_bits'])}
            classi = {'MAGIC-USER', 'WARRIOR', 'CLERIC', 'THIEF', 'DRUID', 'MONK', 'BARBARIAN',
                      'PALADIN', 'RANGER', 'PSIONIST', 'ARCHER'}
            mob['classi'] = [x for x in mob['flag'] if x in classi]
            mob['flag'] = [x for x in mob['flag'] if x not in classi]
            if letter in ('A', 'B', 'L') and len(a) > 4 and isinstance(a[4], int):
                mob['attacchi'] = a[4]
            if letter == 'S':
                b = r.nums()
                mob.update(livello=b[0], ac=b[2], pf=str(b[3]), danno=str(b[4]))
                g = r.nums()
                mob['oro'] = g[0]
            else:
                b = r.nums()
                mob.update(livello=b[0], hitroll=b[1], ac=b[2], pf=f'{b[0]}d8+{b[3]}', danno=str(b[4]))
                g = r.nums()
                if len(g) >= 4:
                    mob['oro'] = g[1]
                    race = g[3]
                    mob['razza'] = T['RaceName'][race] if isinstance(race, int) and 0 <= race < len(T['RaceName']) - 1 else race
            p = r.nums()
            pos = p[0] if p else 8
            sex = p[2] if len(p) > 2 else 0
            if isinstance(sex, int) and sex >= 3:
                sex -= 3
                imm = p[3] if len(p) > 3 else 0
                mimm = p[4] if len(p) > 4 else 0
                susc = p[5] if len(p) > 5 else 0
                mob['resistenze'] = bits(imm, T['immunity_names'])
                mob['immunita'] = bits(mimm, T['immunity_names'])
                mob['suscettibilita'] = bits(susc, T['immunity_names'])
            mob['sesso'] = {0: 'neutro', 1: 'maschio', 2: 'femmina'}.get(sex, sex)
            if isinstance(pos, int) and 0 <= pos < 9:
                mob['posizione'] = T['position_types'][pos]
            if letter == 'L':
                r.tilde()
                r.tilde()
            mobs[vnum] = mob
        except Exception as ex:
            print(f'  mob #{vnum} in {nome}: {ex}', file=sys.stderr)
    return mobs


# ---------------------------------------------------------------- oggetti

def spell_name(n, T):
    sp = T['spells']
    return sp[n - 1] if isinstance(n, int) and 0 < n <= len(sp) and sp[n - 1] not in (None, '\n') else None


def parse_obj(text, nome, T):
    r = Reader(text, nome)
    objs = {}
    while not r.eof():
        s = r.line().strip()
        m = re.fullmatch(r'#(\d+)', s)
        if not m:
            continue
        vnum = int(m.group(1))
        if vnum >= 99999:
            break
        try:
            chiave = r.tilde()
            corto = r.tilde()
            r.tilde()  # descrizione a terra
            r.tilde()  # azione
            t = r.nums()
            v = r.nums()
            w = r.nums()
            tipo_n = t[0] if t and isinstance(t[0], int) else 0
            it = T['item_types']
            tipo = it[tipo_n] if 0 <= tipo_n < len(it) - 1 else f'TIPO{tipo_n}'
            o = {'vnum': vnum, 'chiave': chiave, 'nome': corto, 'tipo': tipo, 'file': nome,
                 'flags': bits(t[1] if len(t) > 1 else 0, T['extra_bits']) or ['NOBITS'],
                 'indossabile': [x for x in bits(t[2] if len(t) > 2 else 0, T['wear_bits']) if x != 'TAKE'],
                 'peso': w[0] if w else None, 'valore': w[1] if len(w) > 1 else None,
                 'rent': w[2] if len(w) > 2 else None, 'stats': {}, 'poteri': []}
            v = [x if isinstance(x, int) else 0 for x in v] + [0, 0, 0, 0]
            if tipo == 'WEAPON':
                o['dado'] = f'{v[1]}D{v[2]}'
                wt = T['aszWeaponType']
                if 0 <= v[3] < len(wt) - 1:
                    o['tipoDanno'] = wt[v[3]]
            elif tipo == 'ARMOR':
                o['ac'] = v[0]
            elif tipo in ('POTION', 'SCROLL'):
                o['livello'] = v[0]
                o['incantesimi'] = [x for x in (spell_name(n, T) for n in v[1:4]) if x]
            elif tipo in ('WAND', 'STAFF'):
                o['livello'] = v[0]
                o['cariche'] = v[2]
                o['incantesimi'] = [x for x in [spell_name(v[3], T)] if x]
            elif tipo == 'CONTAINER':
                o['capacita'] = v[0]
            elif tipo == 'LIGHT':
                o['ore'] = v[2]
            while not r.eof():
                s = r.peek().strip()
                if s.startswith('#') or s.startswith('$'):
                    break
                r.line()
                if s == 'E':
                    r.tilde()
                    r.tilde()
                elif s == 'A':
                    loc, mod = (r.nums() + [0, 0])[:2]
                    at = T['apply_types']
                    nomeap = at[loc] if isinstance(loc, int) and 0 <= loc < len(at) - 1 else f'APPLY{loc}'
                    if nomeap in ('RESISTANCE', 'SUSCEPTIBILITY', 'IMMUNITY'):
                        o['poteri'].append(f"{nomeap}: {' '.join(bits(mod, T['immunity_names']))}")
                    elif nomeap == 'SPELL AFFECT':
                        o['poteri'].append(f"SPELL AFFECT: {' '.join(bits(mod, T['affected_bits']))}")
                    elif nomeap in ('WEAPON SPELL', 'EAT SPELL'):
                        o['poteri'].append(f'{nomeap}: {spell_name(mod, T) or mod}')
                    elif nomeap != 'NONE':
                        o['stats'][nomeap] = o['stats'].get(nomeap, 0) + (mod if isinstance(mod, int) else 0)
            if not o['poteri']:
                del o['poteri']
            objs[vnum] = o
        except Exception as ex:
            print(f'  oggetto #{vnum} in {nome}: {ex}', file=sys.stderr)
    return objs


# ---------------------------------------------------------------- zone e reset

def parse_zon(text, nome):
    r = Reader(text, nome)
    zona = None
    cmds = []
    while not r.eof():
        s = r.line().strip()
        m = re.fullmatch(r'#(\d+)', s)
        if m and zona is None:
            nomez = r.tilde()
            h = r.nums()
            zona = {'num': int(m.group(1)), 'nome': nomez, 'top': h[0] if h else None, 'file': nome}
            continue
        if not s or s.startswith('*'):
            continue
        if s == 'S' or s.startswith('$'):
            break
        s = s.split('*')[0].strip()
        p = s.split()
        if not p:
            continue
        c = p[0]
        nums = [int(x) for x in p[1:] if re.fullmatch(r'-?\d+', x)]
        cmds.append((c, nums))
    return zona, cmds


def apply_resets(zone_cmds, T):
    """mob → stanze di spawn, equip e inventario; oggetti → chi li porta e dove stanno."""
    spawn = defaultdict(list)
    equip = defaultdict(list)
    inv = defaultdict(list)
    dentro = defaultdict(list)
    obj_rooms = defaultdict(list)
    porte = {}
    for zona, cmds in zone_cmds:
        last_mob = None
        last_obj = None
        for c, n in cmds:
            if c == 'M' and len(n) >= 4:
                last_mob = n[1]
                spawn[n[1]].append({'stanza': n[3], 'max': n[2]})
            elif c == 'O' and len(n) >= 4:
                last_obj = n[1]
                obj_rooms[n[1]].append(n[3])
            elif c == 'G' and len(n) >= 2 and last_mob is not None:
                last_obj = n[1]
                if n[1] not in inv[last_mob]:
                    inv[last_mob].append(n[1])
            elif c == 'E' and len(n) >= 4 and last_mob is not None:
                last_obj = n[1]
                voce = {'vnum': n[1], 'slot': SLOT[n[3]] if 0 <= n[3] < len(SLOT) else str(n[3])}
                if voce not in equip[last_mob]:
                    equip[last_mob].append(voce)
            elif c == 'P' and len(n) >= 4:
                if n[1] not in dentro[n[3]]:
                    dentro[n[3]].append(n[1])
            elif c == 'D' and len(n) >= 4:
                porte[(n[1], n[2])] = n[3]
    return spawn, equip, inv, dentro, obj_rooms, porte


# ---------------------------------------------------------------- percorsi

def bfs_paths(rooms, start, porte, evita):
    """Cammino più corto da `start` a ogni stanza (prima senza porte a chiave)."""
    def run(chiuse_ok):
        prev = {start: None}
        q = deque([start])
        while q:
            u = q.popleft()
            for d, e in rooms[u]['uscite'].items():
                v = e['a']
                if v in prev or v not in rooms or v in evita:
                    continue
                if e['porta'] and not chiuse_ok and porte.get((u, DIRS.index(d))) == 2:
                    continue
                prev[v] = (u, d)
                q.append(v)
        return prev
    libero = run(False)
    tutto = run(True)
    for k, val in tutto.items():
        if k not in libero:
            libero[k] = val
    return libero


def path_to(prev, rooms, dest):
    if dest not in prev:
        return None
    steps = []
    porte = False
    cur = dest
    while prev[cur] is not None:
        u, d = prev[cur]
        steps.append(d)
        if rooms[u]['uscite'][d]['porta']:
            porte = True
        cur = u
    steps.reverse()
    # compatta: n,n,n → 3n (il client lo espande)
    out = []
    for d in steps:
        if out and out[-1][1] == d:
            out[-1][0] += 1
        else:
            out.append([1, d])
    return ','.join(f'{k}{d}' if k > 1 else d for k, d in out), porte, len(steps)


# ---------------------------------------------------------------- main

def main(root, binario, uscita, partenza=3001):
    T = read_tables(binario)
    files = pick_files(root)
    rooms, mobs, objs = {}, {}, {}
    zone_by_num = {}
    when = {}

    def merge(dst, src, t):
        # la stessa area in due versioni (inglese e italiana, con e senza mob): vince la più recente
        for v, rec in src.items():
            # una stanza senza uscite (i segnaposto "Null" di null.wld, 2003) non toglie di mezzo
            # quella vera con le uscite: #16000 "Eastern Path" porta all'Accademia (2026-11-24)
            if v in dst and 'uscite' in rec and not rec['uscite'] and dst[v]['uscite']:
                continue
            if v not in dst or t >= when[id(dst), v]:
                dst[v] = rec
                when[id(dst), v] = t

    for k in sorted(files):
        p = files[k]
        t = os.path.getmtime(p)
        text = read_text(p)
        ext = k.rsplit('.', 1)[1]
        if ext == 'wld':
            merge(rooms, parse_wld(text, k, T), t)
        elif ext == 'mob':
            merge(mobs, parse_mob(text, k, T), t)
        elif ext == 'obj':
            merge(objs, parse_obj(text, k, T), t)
        elif ext == 'zon':
            z, cmds = parse_zon(text, k)
            if z and (z['num'] not in zone_by_num or t >= zone_by_num[z['num']][2]):
                zone_by_num[z['num']] = (z, cmds, t)
    zone = [z for z, _, _ in zone_by_num.values()]
    zone_cmds = [(z, c) for z, c, _ in zone_by_num.values()]
    # stanza → zona (ogni zona va dal top della precedente +1 al suo top)
    zone = [z for z in zone if isinstance(z['top'], int)]
    zone.sort(key=lambda z: z['top'])
    lo = 0
    for z in zone:
        z['da'], z['a'] = lo, z['top']
        lo = z['top'] + 1

    def zona_di(v):
        for z in zone:
            if z['da'] <= v <= z['a']:
                return z['nome']
        return None

    spawn, equip, inv, dentro, obj_rooms, porte = apply_resets(zone_cmds, T)
    evita = {v for v, r in rooms.items() if 'DEATH' in r['flags']}
    prev = bfs_paths(rooms, partenza, porte, evita) if partenza in rooms else {}

    for v, mob in mobs.items():
        mob['zona'] = zona_di(v)
        mob['spawn'] = []
        for s in spawn.get(v, []):
            st = rooms.get(s['stanza'])
            voce = {'stanza': s['stanza'], 'titolo': st['titolo'] if st else None,
                    'zona': zona_di(s['stanza']), 'max': s['max']}
            pt = path_to(prev, rooms, s['stanza'])
            if pt:
                voce['percorso'], voce['porte'], voce['passi'] = pt
            mob['spawn'].append(voce)
        mob['equip'] = [{**e, 'nome': objs.get(e['vnum'], {}).get('nome')} for e in equip.get(v, [])]
        mob['inventario'] = [{'vnum': o, 'nome': objs.get(o, {}).get('nome'),
                              **({'contiene': [{'vnum': c, 'nome': objs.get(c, {}).get('nome')}
                                               for c in dentro[o]]} if dentro.get(o) else {})}
                             for o in inv.get(v, [])]

    portato = defaultdict(list)
    for v, mob in mobs.items():
        luogo = mob['spawn'][0]['zona'] if mob['spawn'] else mob['zona']
        for e in mob['equip']:
            portato[e['vnum']].append(f"indossato da {mob['nome']} (#{v}, {luogo}) {e['slot']}")
        for o in mob['inventario']:
            portato[o['vnum']].append(f"nell'inventario di {mob['nome']} (#{v}, {luogo})")
            for c in o.get('contiene', []):
                portato[c['vnum']].append(f"in {o['nome']} di {mob['nome']} (#{v}, {luogo})")
    for v, o in objs.items():
        o['zona'] = zona_di(v)
        o['portatoDa'] = portato.get(v, [])
        o['aTerra'] = [f"{rooms[s]['titolo']} (#{s}, {zona_di(s)})" if s in rooms else f'#{s}'
                       for s in obj_rooms.get(v, [])]

    # ingressi delle zone: la stanza della zona più vicina alla partenza
    ingressi = []
    for z in zone:
        best = None
        for v in rooms:
            if z['da'] <= v <= z['a'] and v in prev:
                pt = path_to(prev, rooms, v)
                if pt and (best is None or pt[2] < best[1][2]):
                    best = (v, pt)
        if best and best[0] != partenza:
            v, (path, porte_, passi) = best
            ingressi.append({'zona': z['nome'], 'stanza': v, 'titolo': rooms[v]['titolo'],
                             'percorso': path, 'porte': porte_, 'passi': passi})

    out = {'partenza': {'stanza': partenza, 'titolo': rooms.get(partenza, {}).get('titolo')},
           'zone': zone, 'stanze': len(rooms), 'mob': mobs, 'oggetti': objs, 'ingressi': ingressi}
    json.dump(out, open(uscita, 'w'), ensure_ascii=False)
    print(f'stanze {len(rooms)}, mob {len(mobs)}, oggetti {len(objs)}, zone {len(zone)}, '
          f'raggiungibili da #{partenza}: {len(prev)}, ingressi {len(ingressi)}')


if __name__ == '__main__':
    main(*sys.argv[1:4])
