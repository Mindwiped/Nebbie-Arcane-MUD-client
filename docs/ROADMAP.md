# Roadmap

Si lavora una fase alla volta. Una fase è chiusa quando tutti i criteri sono spuntati e
l'utente l'ha provata. Alla fine di ogni fase: aggiorna questo file e `CHANGELOG.md`.

## Fase 0 — Fondamenta

- [x] Progetto Tauri 2 + Svelte 5 + TypeScript avviabile con `npm run tauri dev` su macOS
- [x] Struttura cartelle: `src-tauri/` (Rust), `src/core/` (pipeline, eventi), `src/nebbie/`
      (parser e moduli di dominio), `src/ui/` (pannelli), `fixtures/`, `tools/`
- [x] Lint e formattazione (clippy, rustfmt, eslint, prettier), `cargo test` e `vitest` funzionanti
- [x] README con istruzioni di installazione per l'utente (Xcode CLT, Rust, Node)
- **Stato**: chiusa il 2026-11-13, provata dall'utente.

## Fase 1 — Nucleo giocabile

- [x] Connessione TCP + telnet + decodifica caratteri + ANSI nel backend
- [x] Output virtualizzato con colori, scorrimento, blocco dello scorrimento quando si risale
- [x] Riga di input: cronologia, ricerca, `;`, `#n`, Tab per completare
- [x] Profili di personaggio: crea/scegli profilo prima di collegarsi (nome, host, codifica,
      regex del prompt, massimi); nessun pg cablato nel codice
- [x] Riconoscimento del prompt con la regex del profilo (predefinita per il formato
      `<Nome> H.. M.. V.. X..`, esempio Rigel), anche con testo attaccato;
      barre HP/MP/MV aggiornate
- [x] Log di sessione su disco; modalità replay; `mock-server` locale
- [x] Account unico (server, utente) con password nel Portachiavi e accesso automatico
      con scelta del pg dal menu (aggiunto su richiesta dell'utente)
- [x] Test del separatore prompt su fixture con testo attaccato
      (per ora fixture **sintetica**: da ripetere con log reali in `fixtures/`)
- **Accettazione**: l'utente si collega a Nebbie con due pg diversi, gioca mezz'ora e le barre
  sono sempre giuste per entrambi.
- **Stato**: chiusa il 2026-11-13, provata dall'utente su Nebbie con due personaggi.
- **Da verificare con log reali**: la codifica (UTF-8 o Latin-1), il significato di `[T]` e
  `*/*`. Confermato: Nebbie manda GA/EOR dopo il prompt.

## Fase 2 — Modello Nebbie e interfaccia modulare

- [x] Parser stanza, liste, movimento, morte mob, oro, affetti → eventi tipizzati con test
      (fixture reali; manca un log dei contenitori; l'oro in tasca richiede che il prompt lo mostri)
- [x] Layout a pannelli agganciabili, salvataggio e scelta di layout
      (dockview 8; pannelli Output, Stanza, Effetti; layout globali, non ancora per profilo)
- [x] Timer affetti, posizione, tank/target, statistiche di sessione, tick, allarme furto
      (fatti: timer da `att` e durate imparate, tank/bersaglio, statistiche con XP/h, allarme
      furto se il prompt mostra l'oro, tick ricavato dalle scadenze degli incantesimi;
      manca la posizione fuori da `score`)
- [x] Interruttori e barra pulsanti configurabili da editor visuale
      (interruttori dei gruppi di alias/trigger; pulsanti con colore, scorciatoia F1-F12/⌥1-⌥0)
- [x] Alias e trigger utente con editor, gruppi attivabili (globali o per profilo)
- [x] **TODO (utente)**: sfondo colorato solo per certi eventi, elenco da definire con
      l'utente. Per ora lo sfondo resta nero: lo sfondo nero ANSI che Nebbie manda su ogni
      riga viene ignorato (`src/ui/ansiColors.ts`)
- **Accettazione**: tutto quello che oggi l'utente vede in Mudlet c'è, con una struttura a
  pannelli simile all'esempio e riorganizzabile trascinando.
- **Stato**: tutte le voci implementate il 2026-11-13 (resta il TODO degli sfondi per evento),
  in attesa della prova dell'utente.

## Fase 3 — Automatismi

> 2026-11-13: percorsi, vestiario e automatismi vengono riprogettati in modo nativo
> (SPECIFICA, capitolo 5). Il codice portato da Mudlet resta finché non viene sostituito.

- [x] Abbreviazioni incantesimi, rinnovo spell, loot monete, rialzati/stand
      (2026-11-13: Mantieni attivi e regole sullo stato nativi, SPECIFICA 5.4; in attesa della
      prova dell'utente)
      (rinnovo, loot e stand importabili come trigger da Mudlet; second wind come modulo)
      (abbreviazioni anticipate il 2026-11-13: 74 voci in `src/nebbie/spells/incantesimi.json`,
      interruttore per profilo; 2026-11-15: tutti gli incantesimi dell'elenco ALL, editor e importazione)
- [x] Fabbro, EqSet (con lettura forziere)
- [ ] Giro pozze: rimandato, per ora non serve (decisione dell'utente del 2026-11-15)
      (2026-11-13: sostituiti dal vestiario nativo, SPECIFICA 5.3: modello, contenitori
      generici, cambio di set e riparazione sull'esecutore, pannello Equipaggiamento; manca il
      giro pozze)
- [ ] Ogni modulo: interruttore, impostazioni, log delle azioni, test su fixture
- **Accettazione**: l'utente non sente la mancanza dei pacchetti Mudlet corrispondenti.

## Fase 4 — Mappa

> 2026-11-14: mappa e mapper nuovi, niente importazione da Mudlet (SPECIFICA cap. 4).

- [x] Modello e salvataggio (`mappa.json`)
- [x] Mappatura automatica: firma, vicini, prova positiva, isole, porte (2026-11-14; manca
      l'unione automatica delle isole)
- [x] Pannello Mappa su canvas (zoom, trascinamento, zone, stanza attuale)
- [x] "Vai qui" con il percorso più breve e l'esecutore
- [x] Strumenti: unisci, sposta isola, elimina, rinomina zona, note, mob, ricerca (2026-11-15)
- [x] Unione automatica delle isole (2026-11-15)
- **Accettazione**: giocando, la mappa si costruisce da sola senza doppioni evidenti e
  "vai qui" porta a destinazione.

## Fase 5 — Percorsi e scripting

- [x] Import dei percorsi da `percorsi_ui.xml` (127 in 52 zone) e di `percorsi_salvati.lua` (8)
      (anticipato il 2026-11-13: `src/nebbie/paths/percorsi.json` + percorsi registrati nei dati)
- [x] Pannello percorsi (zone richiudibili, ricerca, note) e registratore `rec`
      (2026-11-13: esecutore di sequenze, pannello rifatto, `rec`, inversione, modifica,
      preferiti; in attesa della prova dell'utente)
- [x] Script utente in Web Worker con API documentata ed editor CodeMirror (2026-11-15, docs/SCRIPT.md)
- **Accettazione**: tutti i percorsi Mudlet funzionano; uno script d'esempio dell'utente gira.

## Fase 6 — Rifinitura

- [ ] Schede Info aggiuntive decise con l'utente
- [x] Temi, scala interfaccia, suoni, notifiche di sistema (2026-11-15: Impostazioni…, temi Scuro, Nero e Chiaro con tavolozza ANSI scurita)
- [x] Pacchetto `.dmg` firmato localmente, aggiornamento manuale (2026-11-15, docs/PACCHETTO.md)
