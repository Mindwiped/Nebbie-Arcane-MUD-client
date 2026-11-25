# tools/mudder

Estrattore dei file d'area di Nebbie Arcane (formato SillyMUD: `.wld .mob .obj .zon`).
Nessun dato del gioco sta nel repository: le cartelle si passano sulla riga di comando.

```bash
python3 tools/mudder/estrai.py <cartella aree> <binario server> /tmp/mondo.json
python3 tools/mudder/integra.py /tmp/mondo.json <cartella Reliquiario> [<cartella dati app>]
```

- `elftables.py`: i nomi dei bit (flag, incantesimi attivi, immunità, tipi e flag degli oggetti,
  razze, incantesimi) letti dalle tabelle del binario del server, come li mostra il MUD.
- `estrai.py`: stanze, mob, oggetti e reset delle zone; della stessa area in più versioni
  (inglese/italiana, con/senza mob, `Aree_base/`) vince il file più recente. Percorsi a piedi
  dalla piazza delle Nebbie di Myst (#3001); portali, pozze e diligenze sono procedure speciali
  e non ci sono.
- `integra.py`:
  - oggetti in `identi.js` (copia `identi.backup-AAAA-MM-GG.js` prima): i già presenti restano
    come sono e ricevono le note `MUD: …`;
  - mob in `mob.js`;
  - ingressi di zona in `percorsi.json` (origine `mud`; nota "MUD" se il path esisteva già).
    Questo file va scritto ad app chiusa.
