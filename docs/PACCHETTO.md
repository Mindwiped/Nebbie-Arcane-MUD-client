# Pacchetto per macOS

Questa pagina spiega come creare l'app vera (`Nebbie Client.app`) e il disco di installazione
(`.dmg`), firmati sul tuo Mac.

## Una volta sola: il certificato

L'app viene firmata con un certificato autofirmato che resta sul tuo Mac. Il nome deve essere
**Nebbie Client Locale**.

1. Apri Accesso Portachiavi (Keychain Access) e seleziona il portachiavi **login**.
2. Dal menu scegli **Keychain Access → Certificate Assistant → Create a Certificate…**
3. Compila così:
   - Nome: `Nebbie Client Locale`
   - Identity Type: Self-Signed Root
   - Certificate Type: Code Signing

macOS lo segnala come "non attendibile" (`CSSMERR_TP_NOT_TRUSTED`): per firmare in locale va bene.

**Perché serve.** La password del MUD sta nel portachiavi, e macOS la lascia leggere solo al
programma che l'ha salvata, riconoscendolo dalla firma.
- La versione di sviluppo cambia firma a ogni compilazione, quindi macOS chiede ogni volta la
  password del Mac.
- L'app firmata ha sempre la stessa identità, cioè l'identificativo dell'app più il
  certificato. Dopo un solo "Always Allow" macOS non chiede più, neanche dopo gli aggiornamenti.

## Creare il pacchetto

```bash
cd ~/Desktop/github/nebbie-client && . "$HOME/.cargo/env" && npm run pacchetto
```

`npm run pacchetto` è `tauri build` con i percorsi della compilazione accorciati: senza, la parte
Rust conterrebbe la cartella del tuo utente (`/Users/<nome>/…`). Il server MUD finto per le
prove (`npm run mock`) non entra nel pacchetto.

Il risultato è in `src-tauri/target/release/bundle/`:
- `macos/Nebbie Client.app`
- `dmg/Nebbie Client_<versione>_aarch64.dmg`

L'avviso "skipping app notarization" è normale: la notarizzazione serve solo per distribuire
l'app ad altri e richiede un account sviluppatore Apple.

## Installare e aggiornare

1. Apri il `.dmg` e trascina **Nebbie Client** in **Applicazioni**. Per un aggiornamento
   sostituisci quella che c'è già.
2. Aprila da Applicazioni o da Spotlight.

I dati sono gli stessi della versione di sviluppo, nella stessa cartella:
`~/Library/Application Support/io.github.mindwiped.nebbie-client/`. Ci sono profili, mappa,
percorsi, script e log.

Non tenere aperte insieme l'app e la versione di sviluppo (`npm run tauri dev`): scriverebbero
sugli stessi file.

Per aggiornare, ricrea il pacchetto e sostituisci l'app in Applicazioni.

## Passarlo ad altri giocatori

Il `.dmg` contiene solo il programma. I dati di chi lo usa nascono vuoti sul suo Mac: profili,
password, mappa, percorsi registrati, script, log e impostazioni. Dentro l'app ci sono solo i
dati del gioco:
- i percorsi dei pacchetti Mudlet;
- le abbreviazioni degli incantesimi;
- i messaggi di Nebbie riconosciuti dal client.

Niente del tuo personaggio, niente nomi utente (controllato il 2026-11-15).

Cosa deve sapere chi lo riceve:
- **Solo Mac con chip Apple** (M1 e successivi): il pacchetto è `aarch64`. Per i Mac Intel
  serve una versione universale, che si crea a parte.
- **Primo avvio**: l'app non è notarizzata da Apple. Scaricata da internet o da una chat,
  macOS dice che non può verificarne lo sviluppatore. Per aprirla:
  1. fare clic destro sull'app e scegliere **Apri**;
  2. oppure, se non basta, andare in **Impostazioni di Sistema → Privacy e sicurezza → Apri
     comunque**.

  Basta la prima volta.
- **Portachiavi**: con il tuo certificato l'identità dell'app è la stessa anche per gli altri;
  la loro password resta nel loro portachiavi.
