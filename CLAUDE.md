# Nebbie Client — istruzioni per Claude Code

Stiamo costruendo da zero un client MUD desktop pensato per **Nebbie Arcane**
(nebbie.nebbie.it:4000, DikuMud/AlarMUD, testo in italiano con alcune zone in inglese).
Sostituisce un'installazione Mudlet molto personalizzata: barre, timer degli incantesimi,
statistiche di sessione, mappa automatica, percorsi, eqset, fabbro.

Prima di scrivere codice leggi, in quest'ordine:

1. `docs/SPECIFICA.md` — architettura, moduli, interfaccia, mappa, scripting
2. `docs/PROTOCOLLO_NEBBIE.md` — come è fatto il testo del MUD (non c'è GMCP: si vive di testo)
3. `docs/ROADMAP.md` — fasi con criteri di accettazione; lavoriamo una fase alla volta
4. `riferimenti/` — i pacchetti Mudlet attuali (XML con Lua dentro), lo stato del progetto
   e `riferimenti/esempio_struttura_interfaccia.jpg`

## Principi

- **Un solo parser, tanti ascoltatori.** Il testo del MUD entra in un'unica pipeline che lo
  trasforma in eventi tipizzati (`prompt`, `stanza`, `mobMorto`, `oroCambiato`…). Interfaccia,
  mappa e automatismi ascoltano gli eventi, non rileggono il testo con regex proprie.
- **I formati del MUD sono dati, non codice.** Regex del prompt, frasi di rinnovo incantesimi,
  messaggi di porta chiusa ecc. stanno in file di configurazione modificabili dall'utente.
  Il prompt in particolare è configurabile dal giocatore e cambia tra personaggi.
- **Si sviluppa contro log registrati, non contro il server vero.** Ogni parser ha test basati
  su fixture in `fixtures/`. Il client ha una modalità replay e c'è un finto server telnet
  locale che riproduce i log. Non mandare mai comandi al MUD reale in automatico durante lo
  sviluppo: si gioca solo quando l'utente si collega.
- **Niente automatismi nascosti.** Ogni automatismo (rinnovo spell, raccolta monete, fabbro,
  autocast…) ha un interruttore visibile nell'interfaccia e scrive nell'output cosa ha fatto.
  Rispetta le regole del MUD: niente bot che giocano da soli senza giocatore presente.
- **Nessun personaggio è cablato nel codice.** L'utente gioca con più pg (di classi diverse) e
  il client deve funzionare con qualunque. Tutto ciò che dipende dal pg (nome, regex del
  prompt, massimi, incantesimi da rinnovare, eqset, alias, layout, durate degli affetti,
  statistiche) sta nel **profilo del personaggio**. Mappa e percorsi sono del mondo, quindi
  condivisi tra tutti i profili. Nei test e negli esempi Rigel è solo un caso concreto.

## Stack (salvo motivi seri per cambiare: in quel caso chiedi prima)

- **Tauri 2**: backend Rust (socket, telnet, decodifica caratteri, log su disco, SQLite),
  frontend TypeScript + **Svelte 5** + Vite.
- Pannelli agganciabili: `dockview-core` (o equivalente vanilla, valuta e motiva).
- Mappa: Canvas 2D con disegno limitato alla zona visibile; PixiJS solo se serve davvero.
- Persistenza: SQLite (mappa, percorsi, impostazioni, statistiche) via `rusqlite` nel backend.
- Script utente: TypeScript/JavaScript eseguiti in un Web Worker con un'API esplicita.
- Test: `cargo test` per il backend, Vitest per il frontend.
- Piattaforma principale: **macOS** (l'utente è su macOS recente). Non introdurre dipendenze
  che rompono Windows/Linux senza motivo.

## Convenzioni

- Interfaccia, messaggi all'utente, documentazione e commenti: **italiano**.
- Identificatori del codice: inglese. L'API per gli script utente espone anche nomi italiani
  coerenti con i pacchetti esistenti (`lancia`, `rinnova`, `vai`, `percorsi`, `eqset`).
- Ogni modulo di dominio (`mapper`, `eqset`, `fabbro`, `spells`, `stats`…) vive in una sua
  cartella con il suo test. Niente logica di dominio nei componenti Svelte.
- Commit piccoli, uno per passo logico, messaggi in italiano.
- Aggiorna `docs/ROADMAP.md` (spunta i criteri raggiunti) e `CHANGELOG.md` a ogni fase.

## Lo screenshot di esempio

`riferimenti/esempio_struttura_interfaccia.jpg` è l'interfaccia Mudlet di **un altro giocatore**,
trovata in giro. Serve solo come idea di **struttura**: output al centro, mappa e pannello
informazioni a lato, barre e timer sotto, interruttori in alto, statistiche di sessione in fondo.
Non contiene dati da usare: il personaggio, il suo prompt, le sue impostazioni e le sue schede
non sono dell'utente e non vanno riprodotti né presi come formato del MUD.
L'utente ha più personaggi; **Rigel** (mago/guerriero) è quello da cui vengono gli esempi
di prompt e di log, non un caso speciale.

## Quando non sei sicuro

Il testo del MUD ha molte eccezioni (righe attaccate al prompt, `Uscite:` attaccata alla
descrizione, apostrofi al posto degli accenti). Se un formato non è documentato in
`docs/PROTOCOLLO_NEBBIE.md` né ricavabile dai pacchetti in `riferimenti/`, **non inventarlo**:
segnalo come "da verificare", chiedi all'utente un pezzo di log e aggiungi la fixture.
