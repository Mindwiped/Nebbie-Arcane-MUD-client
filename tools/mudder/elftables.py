"""Legge dal binario del server (ELF 32 bit con simboli) le tabelle dei nomi: flag dei mob
(action_bits), incantesimi attivi (affected_bits), immunità, tipi e flag degli oggetti, razze…"""
import json, struct, subprocess, sys

def read_tables(path):
    data = open(path, 'rb').read()
    # intestazioni di sezione per tradurre indirizzi virtuali in offset del file
    e_shoff, = struct.unpack_from('<I', data, 0x20)
    e_shentsize, e_shnum = struct.unpack_from('<HH', data, 0x2E)
    secs = []
    for i in range(e_shnum):
        o = e_shoff + i * e_shentsize
        _, typ, _, addr, off, size = struct.unpack_from('<IIIIII', data, o)
        if addr and typ != 8:  # niente NOBITS (.bss)
            secs.append((addr, off, size))
    def v2o(a):
        for addr, off, size in secs:
            if addr <= a < addr + size:
                return off + a - addr
        return None
    def cstr(a):
        o = v2o(a)
        if o is None: return None
        e = data.index(b'\0', o)
        return data[o:e].decode('latin-1')
    nm = subprocess.run(['/opt/homebrew/opt/llvm/bin/llvm-nm', '-S', path], capture_output=True, text=True).stdout
    syms = {}
    for line in nm.splitlines():
        p = line.split()
        if len(p) == 4: syms[p[3]] = (int(p[0], 16), int(p[1], 16))
    want = ['action_bits', 'affected_bits', 'affected_bits2', 'apply_types', 'immunity_names', 'item_types',
            'extra_bits', 'wear_bits', 'equipment_types', 'room_bits', 'sector_types', 'exit_bits', 'dirs',
            'RaceName', 'drinks', 'aszWeaponType', 'aszWeaponSpecialEffect', 'spells', 'attack_hit_text',
            'npc_class_types', 'position_types']
    res = {}
    for w in want:
        if w not in syms: continue
        a, size = syms[w]
        o = v2o(a)
        vals = []
        for k in range(size // 4):
            p, = struct.unpack_from('<I', data, o + 4 * k)
            s = cstr(p) if p else None
            vals.append(s)
        res[w] = vals
    return res


def main(path, out):
    json.dump(read_tables(path), open(out, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
