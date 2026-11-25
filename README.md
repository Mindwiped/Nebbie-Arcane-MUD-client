# Nebbie Client

```
La stanza del vecchio giocatore
Una scrivania sommersa da mappe disegnate a mano, fogli di alias scritti a matita e
tazze di caffe' ormai freddo. Sullo schermo scorrono righe rosse e verdi: qualcuno, da
qualche parte, sta ancora litigando con la testa verde dell'idra. Sul muro e' appeso un
calendario del 1995 che nessuno ha mai avuto il coraggio di staccare.
Uscite: Nord Est Giu'
Un client MUD nuovo di zecca e' appoggiato qui.

Betlegeuse H601 M877 V209 X-96.509.285 [T] */*>> esamina client
```

Lo esamini con attenzione. È un client MUD per **Nebbie Arcane** (`nebbie.nebbie.it:4000`),
fatto da qualcuno che su quel MUD ci gioca da più di trent'anni e che, nel frattempo, ha
cambiato più client che armature. Dopo anni passati a incollare trigger in Lua dentro Mudlet,
ha deciso che era arrivato il momento di farsene uno su misura, da zero.

Il risultato è un'app desktop che conosce Nebbie: legge il prompt, sa quando un incantesimo
sta per finire, si ricorda dove hai lasciato il korred e ti riporta a casa a piedi senza
sbagliare un passo. Non è un client generico per qualunque MUD, anche se l'architettura non lo
impedisce: tutto ciò che è specifico di Nebbie sta in `src/nebbie/`.

Tecnicamente è Tauri 2 (Rust) con Svelte 5 e TypeScript. Gira su macOS con chip Apple; esiste
anche una versione per Windows, ancora mai provata su un PC vero.

## Cosa sa fare

- Pannelli da disporre come vuoi: output, stanza, mappa, effetti con i timer, statistiche,
  percorsi, equipaggiamento, automatismi, reliquiario degli oggetti.
- Mappa che si disegna da sola mentre cammini, con "vai qui".
- Percorsi registrati con `rec` e speedwalk che si ferma quando il MUD dice di no.
- Cambio di set di equipaggiamento con i contenitori (compendium, zaini, borse dentro borse).
- Rilancio degli incantesimi quando finiscono, mai in mezzo a un combattimento.
- Alias, trigger, pulsanti con scorciatoie, script in JavaScript.
- Accesso automatico con la password nel Portachiavi di macOS, mai in un file.
- Log delle sessioni e replay, anche senza collegarsi.

Come si usa ogni pannello è scritto in [docs/GUIDA.md](docs/GUIDA.md).

## Installazione

### Prerequisiti, una volta sola

1. Xcode Command Line Tools (salta se hai già Xcode):

   ```bash
   xcode-select --install
   ```

2. Rust. Scegli l'installazione standard, poi apri un nuovo terminale e controlla con
   `rustc --version`:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. Node.js, per esempio con Homebrew:

   ```bash
   brew install node
   ```

4. Le dipendenze, nella cartella del progetto:

   ```bash
   npm install
   ```

### Il certificato, una volta sola

L'app si firma con un certificato autofirmato che resta sul tuo Mac. Serve perché la password
del MUD sta nel Portachiavi, e macOS la lascia leggere solo al programma che l'ha salvata,
riconoscendolo dalla firma. Con una firma sempre uguale basta dire "Consenti sempre" una volta,
e macOS non chiede più niente, neanche dopo gli aggiornamenti.

1. Apri **Accesso Portachiavi** e seleziona il portachiavi **login**.
2. Dal menu scegli **Accesso Portachiavi → Assistente Certificato → Crea un certificato…**
3. Compila così:
   - Nome: `Nebbie Client Locale` (esattamente questo, è il nome scritto in
     `src-tauri/tauri.conf.json`);
   - Tipo di identità: Radice autofirmata;
   - Tipo di certificato: Firma del codice.
4. Controlla che ci sia:

   ```bash
   security find-identity -p codesigning | grep "Nebbie Client Locale"
   ```

macOS lo segna come "non attendibile": per firmare sul proprio Mac va bene così.

Se non vuoi creare il certificato, in `src-tauri/tauri.conf.json` metti
`"signingIdentity": "-"` (firma ad hoc). Funziona lo stesso, ma a ogni nuova versione macOS ti
richiede il permesso per la password.

### Creare l'app

```bash
npm run pacchetto
```

La prima volta Cargo compila tutte le dipendenze e ci mette qualche minuto. Il risultato è in
`src-tauri/target/release/bundle/`: `macos/Nebbie Client.app` e il disco in `dmg/`. Apri il
`.dmg` e trascina **Nebbie Client** in **Applicazioni**. Per aggiornare, rifai il pacchetto e
sostituisci l'app. Altri dettagli in [docs/PACCHETTO.md](docs/PACCHETTO.md).

Per Windows c'è `npm run pacchetto:windows`, che dal Mac crea uno zip portabile (serve
`cargo-xwin` con `llvm` e `lld` di Homebrew).

## Primo avvio

1. **Se macOS non la vuole aprire.** L'app non è notarizzata da Apple, quindi se l'hai
   scaricata da internet macOS dice che non può verificare lo sviluppatore. Fai clic destro
   sull'app e scegli **Apri**; se non basta, vai in **Impostazioni di Sistema → Privacy e
   sicurezza → Apri comunque**. Serve solo la prima volta.
2. **Il profilo.** Si apre l'editor dei profili: creane uno per ogni personaggio, con il nome
   come appare nel menu di accesso del MUD. La regex del prompt si prova lì con una riga vera.
3. **L'account.** In *Profili… → Account e accesso* metti server `nebbie.nebbie.it`, porta
   `4000`, nome dell'account e codice. Quando macOS chiede il permesso per il Portachiavi,
   scegli **Consenti sempre**.
4. **Collega.** Scegli il personaggio in alto e premi *Collega*. Con *Accesso automatico* il
   client entra da solo e sceglie il pg dal menu.

I tuoi dati (profili, mappa, percorsi, set, script, log) stanno in
`~/Library/Application Support/io.github.mindwiped.nebbie-client/` e non escono mai da lì.

## Per chi vuole metterci le mani

```bash
npm run tauri dev
```

apre il client in sviluppo: modificando il codice Svelte la finestra si aggiorna da sola. Non
tenerlo aperto insieme all'app installata, perché scrivono sugli stessi file.

Per provare senza disturbare il MUD vero c'è un finto server che risponde con un log
registrato:

```bash
npm run mock -- fixtures/sintetici/sessione_mock.log
```

Poi crea un profilo con server `127.0.0.1` e porta `4001`.

| Comando | Cosa fa |
| --- | --- |
| `npm run tauri dev` | client in sviluppo |
| `npm test` | test del frontend (Vitest) |
| `npm run test:rust` | test del backend Rust |
| `npm run mock -- file.log [--porta n] [--ga]` | finto server telnet su 127.0.0.1 |
| `npm run lint` / `npm run check` | ESLint e controllo dei tipi |
| `npm run format` | Prettier |
| `npm run pacchetto` | app e `.dmg` firmati |

```
src-tauri/     backend Rust: socket, telnet, decodifica, log
src/core/      pipeline del testo, sessione, regole
src/nebbie/    parser del testo di Nebbie e moduli di gioco (mappa, percorsi, vestiario…)
src/ui/        pannelli Svelte
fixtures/      pezzi di log veri usati dai test e dal replay
tools/         strumenti per mappe e file d'area
docs/          guida, specifica, protocollo del MUD, roadmap
```

## Privacy

Nessuna telemetria e niente inviato a terzi. Il client si collega solo al MUD che scegli tu, e
la password resta nel Portachiavi.

## Licenza

MIT, vedi [LICENSE](LICENSE). Se lo migliori, fallo sapere in gossip.
