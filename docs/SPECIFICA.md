# Specifica — Nebbie Client

## 1. Obiettivo

Un client MUD desktop moderno, veloce e modulare, costruito attorno a Nebbie Arcane.
Deve fare tutto quello che oggi fa l'installazione Mudlet dell'utente
(`riferimenti/pacchetti_mudlet/`) e farlo meglio:
meno regex sparse, interfaccia configurabile senza scrivere codice, mappa veloce con
percorso più breve, sviluppo testabile contro log registrati.

Non è un client generico per qualunque MUD, ma l'architettura non deve impedirlo:
tutto ciò che è specifico di Nebbie sta nel modulo `nebbie/` e nei suoi file di configurazione.

## 2. Architettura

```
 ┌──────────────── Backend Rust (Tauri) ────────────────┐
 │ socket TCP → telnet (IAC, GA/EOR, NAWS, MCCP?)       │
 │           → decodifica (UTF-8 / ISO-8859-1)          │
 │           → righe + "riga parziale" (prompt)         │
 │ log su disco · SQLite · file system · replay         │
 └───────────────┬──────────────────────────────────────┘
                 │ canale Tauri (righe con span ANSI già analizzati)
 ┌───────────────▼──────── Frontend TypeScript ─────────┐
 │ Pipeline:  separatore prompt → parser Nebbie →       │
 │            bus di eventi tipizzati                    │
 │                 │                                    │
 │   ┌─────────────┼──────────────┬──────────────┐      │
 │   ▼             ▼              ▼              ▼      │
 │ Stato PG     Mapper        Automatismi     Script     │
 │ (store)      (grafo)       (moduli)        utente     │
 │   │             │              │              │      │
 │   └──────► Pannelli Svelte (dockview) ◄───────┘      │
 │ Coda comandi in uscita (alias, speedwalk, throttle)   │
 └──────────────────────────────────────────────────────┘
```

### 2.1 Backend Rust

- **Connessione**: TCP con riconnessione manuale (mai automatica senza conferma), timeout,
  keepalive. La connessione parte da un **profilo di personaggio** (vedi 2.2).
- **Telnet**: gestione IAC completa; rifiuta educatamente le opzioni non supportate.
  Riconosci GA/EOR se il server li manda (da verificare su Nebbie): servono a capire
  dove finisce il prompt. MCCP solo se il server lo offre.
- **Codifica**: configurabile per profilo; predefinito UTF-8 con ripiego ISO-8859-1 sui byte
  non validi. Il MUD usa spesso `pi'u'`/`cosi'` al posto degli accenti, ma non sempre.
- **ANSI**: il backend analizza le sequenze SGR (16 colori, 256, truecolor, grassetto,
  sottolineato) e manda al frontend righe già divise in span `{testo, fg, bg, stile}`.
- **Riga parziale**: il testo senza `\n` finale (tipicamente il prompt) viene inviato come
  "parziale" dopo GA/EOR oppure dopo un breve timeout configurabile (~150 ms).
- **Log**: ogni sessione salvata in testo grezzo con codici ANSI e timestamp per riga,
  riutilizzabile come fixture e per il replay.
- **Replay e finto server**: `nebbie-client --replay file.log` riproduce un log con i tempi
  originali o accelerati; un binario separato `mock-server` apre una porta locale e risponde
  ai comandi con frammenti di log (utile per provare percorsi e mapper).
- **Persistenza**: SQLite in `~/Library/Application Support/<app>/` (o equivalente).

### 2.2 Profili di personaggio

Il client non presuppone nessun personaggio: l'utente ne ha diversi, di classi diverse.

- **Account** (uno, comune a tutti i pg): host, porta, codifica, email o nome dell'account,
  accesso automatico e testi del MUD usati per l'accesso (richiesta utente, menu dei pg).
  La **password** sta nel portachiavi del sistema (Portachiavi su macOS) gestito dal backend:
  mai nei file del client, mai nei log, mai rimandata al frontend. Non si usa un hash perché
  il server vuole la password vera.
- **Accesso automatico** (interruttore visibile nella barra in alto): manda l'utente alla
  richiesta, la password quando il server nasconde l'input, e sceglie dal menu il numero del
  pg del profilo. Ogni passo una sola volta per connessione, scritto nell'output.
- **Profilo** = un personaggio: nome (come nel menu di accesso), regex del prompt, massimi
  HP/MP/MV impostati a mano (finché il prompt o `score` non li danno), layout, interruttori,
  alias e trigger propri, incantesimi da rinnovare, eqset, durate degli affetti osservate,
  statistiche di sessione.
- **Condivisi tra i profili**: mappa, percorsi, regole di testo del MUD (frasi di fine
  incantesimo, porte, movimento), alias e trigger marcati "globali".
- Si sceglie il profilo prima di collegarsi; se ne crea uno nuovo da un modello senza
  scrivere codice. Il nome del pg viene dal profilo, non da un comando come `nome <pg>`
  dei pacchetti Mudlet.
- Opzionale (*da verificare*): riconoscere il nome dal prompt o dal login e proporre il
  profilo giusto.

### 2.3 Pipeline di parsing (frontend)

1. **Separatore prompt**: individua il prompt con la regex del profilo anche quando il testo
   successivo gli arriva attaccato sulla stessa riga (`…>> Stai trasportando:`), e spezza in
   `prompt` + resto. Il resto rientra nella pipeline come riga normale.
2. **Parser Nebbie**: macchina a stati che riconosce blocchi multiriga — stanza (titolo,
   descrizione, `Uscite:`, mob/oggetti, `Uscite visibili`), liste eq/inv/contenitore,
   messaggi di movimento, combattimento, morte, fermate di diligenza e mongolfiera.
3. **Bus di eventi**: eventi tipizzati con TypeScript. Elenco minimo iniziale:

| Evento | Dati |
|---|---|
| `line` | riga con span, flag `gagged`, `highlight` |
| `prompt` | hp, hpMax, mp, mpMax, mv, mvMax, xp, oro, banca, affetti, tank, target… (tutti opzionali) |
| `room` | titolo, descrizione, hashDescrizione, uscite, usciteVisibili[{dir, nome}], contenuti |
| `moveFailed` | motivo: muro, porta chiusa, fine run |
| `mobKilled` | nome |
| `goldChanged` | da, a, delta, causa (`loot`, `spesa`, `furto?`, `sconosciuta`) |
| `affectStart` / `affectEnd` | nome incantesimo, durata se nota |
| `equipmentList` / `inventoryList` / `containerList` | righe `{slot, nome, condizione, quantità}` |
| `transportStop` | mezzo (diligenza/mongolfiera), fermata, prossima |
| `commandSent` | testo effettivamente inviato (serve al registratore percorsi e al mapper) |

4. **Trigger utente** a valle del parser: regex o testo semplice su `line`, con azioni
   (comando, script, evidenzia, nascondi, suono, notifica), gruppi attivabili, priorità.

### 2.4 Coda comandi in uscita

- Separatore comandi `;` e ripetizione `#3 nord`.
- Alias (regex con gruppi), espansi prima dell'invio; l'eco nell'output mostra cosa è partito.
- Speedwalk con throttle configurabile e interruzione automatica su `moveFailed`.
- Cronologia con ricerca, completamento con Tab sulle parole viste di recente (nomi mob!).

## 3. Interfaccia

Ispirazione per la struttura: `riferimenti/esempio_struttura_interfaccia.jpg`, l'interfaccia
Mudlet di un altro giocatore. Se ne prende **la disposizione e il tipo di elementi**, non i
contenuti: le etichette citate qui sotto tra parentesi sono solo esempi di cosa ci starebbe.
Elementi previsti:

- **Layout a pannelli agganciabili** (trascina, affianca, schede, sgancia in finestra separata
  se dockview lo consente). Layout multipli salvabili per profilo ("caccia", "esplorazione").
- **Output principale**: rendering virtualizzato (decine di migliaia di righe senza rallentare),
  ricerca, selezione e copia, link cliccabili su nomi di stanze/mob se riconosciuti,
  separazione opzionale della chat in un pannello proprio.
- **Barre** HP/MP/MV con valore e massimo, colori a soglie configurabili.
- **Timer affetti**: una barra per incantesimo attivo con conto alla rovescia
  (es. STONE SKIN 4:26), in rosso negli ultimi secondi. Durate ricavate dalla prima volta
  che si osserva inizio e fine di un incantesimo, poi ricordate.
- **Posizione** (IN PIEDI, seduto, a terra…), **tank** e **target** con condizione.
- **Riga contatori** inventario (pozioni, pergamene… con icone) aggiornata dalle liste inv.
- **Interruttori** in alto (es. RINNOVO SPELL, LOOT, FABBRO, MAPPER): pulsanti
  definiti dall'utente, a due o più stati, che attivano gruppi di trigger o moduli.
- **Barra pulsanti** configurabile: etichetta, icona, colore, azione (comando, alias, percorso,
  script), scorciatoia da tastiera. Editor visuale, niente XML.
- **Statistiche di sessione**: XP guadagnata (oggi/sessione), XP/h, mob uccisi, oro, durata,
  pulsante "Reset sessione", tick del MUD con conto alla rovescia.
- **Allarmi**: es. `[FURTO?]` quando l'oro in tasca cala senza una spesa riconosciuta;
  banda rossa ben visibile nell'output, con suono opzionale.
- **Pannello Info a schede**: Stanza (descrizione, uscite, mob visti, note dalla mappa),
  Mob (uccisi nella sessione), Percorsi, Chat, Strumenti. Le schede sono moduli: se ne
  aggiungono altre senza toccare il resto.
- **Tema** scuro predefinito, caratteri monospaziati configurabili, scala dell'interfaccia.

## 4. Mappa

Decisione dell'utente (2026-11-14): **mappa nuova e mapper nuovo**, niente importazione da
Mudlet. La mappa nasce vuota e il client la costruisce mentre giochi. Il disegno prende come
modello la mappa dello screenshot di riferimento (`riferimenti/esempio_struttura_interfaccia.jpg`):
stanze quadrate con il numero, linee per le uscite, triangoli per su e giù, cerchio rosso sulla
stanza attuale, nome della stanza e della zona in alto, scelta della zona e zoom.

Del mapper Mudlet (`mappa_automatica.xml`) restano solo le cose imparate su Nebbie, scritte qui
come regole e non come codice da portare.

### 4.1 Modello (`mappa.json`)

- **Zone**: `id`, nome, tipo (`mondo` o `isola`).
- **Stanze**: `id` (numero progressivo, mostrato sulla mappa), zona, `x y z`, titolo,
  descrizione, firma, uscite collegate (`dir → id`), uscite viste nella riga `Uscite:`, vicini
  (nomi di "Uscite visibili"), uscite speciali (`comando → id`), porte (`dir → nome, chiave`),
  note, mob visti, colore, ora dell'ultima visita.
- Un file JSON salvato qualche secondo dopo ogni modifica: per qualche migliaio di stanze è
  veloce quanto basta, ed è coerente con gli altri dati del client. Se un giorno servisse, il
  passaggio a SQLite non cambia il modello.

### 4.2 Riconoscimento (regole imparate su Nebbie)

- **Firma** = titolo + impronta della descrizione. Le uscite non entrano nella firma: con `look`
  il MUD non mostra "Uscite visibili" e le porte chiuse cambiano la riga `Uscite:`.
- **Vicini** = i nomi delle stanze di "Uscite visibili". Due stanze con titolo e descrizione
  uguali ma vicini diversi sono stanze diverse; si confrontano solo le direzioni presenti in
  entrambe (i passaggi segreti possono mancare).
- **Camminando** (direzione nota dal comando mandato, anche più passi con `run`):
  1. l'uscita già nota si segue, se la stanza è coerente con quella vista;
  2. altrimenti una stanza già mappata nel punto atteso, con lo stesso titolo e vicini
     compatibili, viene collegata;
  3. altrimenti una stanza con la stessa firma altrove si riusa solo con **prova positiva**:
     dalla parte da cui arrivi deve indicare proprio la stanza da cui vieni;
  4. altrimenti è una stanza nuova, nel primo posto libero nella direzione del passo.
- **Arrivi senza passo** (portal, doorway, teleport, recall, diligenza): si cerca la stanza per
  firma e vicini; se non c'è, nasce un'**isola** (zona a parte) che verrà unita alla mappa quando
  la colleghi camminando. Senza un comando che spieghi lo spostamento la posizione diventa
  sconosciuta finché non riconosci una stanza.
- **Stanze identiche** (idea dell'utente, 2026-11-14): entrando in una stanza con descrizione
  e uscite identiche a un'altra della stessa zona, il client ci lascia monete una alla volta,
  un numero diverso per ogni stanza (1, 2, 3…). Le monete per terra ("One miserable gold
  coin.", poi "[ 1] One miserable gold coin.[N]") dicono quale stanza è: N monete = la stanza
  marcata con N, anche arrivandoci da una direzione illogica; nessuna moneta = non è una di
  quelle marcate. Un mucchio ("A pile of gold coins.") non dice il numero e non si usa. Mai
  durante un percorso; `mappa monete on|off`.
- `look <direzione>` e "Guardando…" non sono spostamenti; muri e porte chiuse annullano il passo.
- Porte: un `open` riuscito prima di un passo registra la porta su quell'uscita.

### 4.2b Registrazione a mano (2026-11-15)

- L'interruttore MAPPER accende la registrazione; all'avvio è sempre spenta. Spento, il mapper
  riconosce le stanze note (monete, uscita nota, punto atteso, firma unica) e aggiorna solo la
  posizione: la mappa non cambia.
- Accendendolo il client chiede la zona delle stanze nuove: una zona esistente o una zona nuova
  col nome dato. Se la zona nuova è vuota, la prima stanza nasce al centro (0, 0, 0).
- Isole: tasto destro → "Sposta isola nella zona…": le stanze passano nella zona scelta,
  allineate a un'uscita che collega le due zone, altrimenti a destra delle stanze esistenti;
  mai due stanze nello stesso punto; la zona dell'isola viene cancellata.
- Uscita illogica verso una stanza unica (una sola stanza della zona con la stessa firma, uscite
  e vicini, mai marcata) da una stanza diversa: è quella stanza. Con le uscite note o il punto
  atteso, un'uscita in più o in meno è una porta, non un'altra stanza.

### 4.3 Disegno (pannello Mappa)

- Canvas 2D, solo la zona e il piano (`z`) della stanza attuale, zoom e trascinamento.
- Stanze quadrate con il numero; linee tra stanze collegate; un tratto corto per le uscite viste
  ma non ancora esplorate; triangoli per su e giù; cerchio rosso sulla stanza attuale.
- In alto titolo della stanza e zona; sotto, scelta della zona, `+` e `−`, "centra".
- Clic su una stanza: informazioni (titolo, uscite, note) e **Vai qui**.

### 4.4 Navigazione

- **Vai qui**: percorso più breve sulle uscite note (le porte con il loro `open`), eseguito
  dall'esecutore (SPECIFICA 5.1): si ferma su un passo fallito o in combattimento.
- Più avanti: pesi (porte, zone da evitare), percorsi come semplici destinazioni.

### 4.5 Strumenti (2026-11-15)

- **Unisci** (tasto destro o riquadro → "Unisci con…", poi clic sull'altra stanza; oppure
  `mappa unisci <tieni> <togli>`): la seconda stanza sparisce nella prima, le uscite che
  puntavano a lei passano alla prima, uscite, porte, note, mob e monete si sommano.
- **Elimina** (con conferma; `mappa elimina <n> conferma`): la stanza e le uscite verso di lei.
  Un'isola rimasta vuota sparisce.
- **Rinomina zona** (✎ accanto alla scelta della zona; `mappa zona <nome>`).
- **Note e mob** nel riquadro della stanza (`mappa nota <testo>` sulla stanza attuale); i mob
  uccisi si aggiungono da soli alla stanza attuale mentre il mapper registra.
- **Ricerca** (⌕; `mappa cerca <testo>`): numero, titolo, note, mob, descrizione.
- **Unione automatica delle isole**: un passo che collega una stanza di un'isola a una stanza
  nota di un'altra zona sposta tutta l'isola in quella zona, allineata al passo. Partendo da
  un'isola le stanze nuove restano nell'isola finché non la colleghi.
- **Monete sparite**: senza monete per terra si esclude una stanza marcata, tranne quella che la
  posizione indica (uscita nota o punto atteso coerente): si riusa e le monete si rimettono.

## 5. Strumenti di gioco: percorsi, vestiario, automatismi

I pacchetti Mudlet (`percorsi_ui.xml`, `eqset.xml`, `fabbro_riparazioni.xml`,
`trigger_rinnovo_incantesimi.xml`) e la guida di MUD Client dicono **di cosa c'è bisogno**,
non come farlo. Qui sotto c'è il disegno nativo per questo client. Il codice portato da
Mudlet nella Fase 3 (moduli Fabbro, EqSet, second wind, trigger importati) resta solo
finché le versioni descritte qui non lo sostituiscono (vedi 5.6).

Regole comuni a tutto il capitolo:

- **Niente di nascosto.** Ogni automatismo ha un interruttore visibile, è spento per i
  personaggi nuovi e scrive nell'output ogni comando che manda e perché.
- **Ferma tutto**: un pulsante sempre visibile ed `Esc` nella riga di comando fermano
  qualsiasi sequenza in corso e mettono in pausa gli automatismi finché non li riattivi.
- **Per personaggio.** Set, incantesimi da mantenere, regole e contenitori si salvano per
  profilo; i percorsi sono comuni a tutti i personaggi.
- Mai comandi automatici da disconnessi, durante il login o mentre si scrive la password.

### 5.1 Esecutore di sequenze

Percorsi, cambio di set, riparazione, giro pozze e rilancio degli incantesimi sono tutti
"una lista di comandi da mandare controllando le risposte". Lo fa un solo componente.

- Una **sequenza** ha un nome, una categoria (`percorso`, `vestiario`, `incantesimi`…) e
  dei **passi**. Ogni passo è un comando con, se servono:
  - le risposte che vogliono dire **riuscito** e quelle che vogliono dire **fallito**
    (testo o regex, oppure un evento del parser come `moveFailed` o `room`);
  - un'**alternativa** se fallisce (es. `hold prisma` → `wear prisma`);
  - cosa fare se fallisce: fermarsi (predefinito), saltare il passo, ritentare N volte;
  - un'attesa massima, dopo la quale il passo conta come fallito.
- Il passo successivo parte quando arriva la risposta e il prompt del precedente, mai
  prima: niente raffiche di comandi che il MUD scarta.
- **Una sequenza alla volta.** Se ne parte un'altra mentre una è in corso, il client chiede
  se fermare quella attuale (o, per gli automatismi, la rimanda a dopo).
- I comandi scritti a mano passano sempre; la sequenza non si ferma, ma il passo in attesa
  non si confonde con la risposta al comando manuale.
- Si ferma da sola se inizia un combattimento (sempre per i percorsi; per il rilancio degli
  incantesimi no), se cade la connessione o con *Ferma tutto*.
- **Prova**: ogni sequenza si può mostrare senza eseguirla (elenco dei comandi che partirebbero).
- **Riprendi**: una sequenza fermata si può riprendere dal passo in cui si è fermata.
- Sopra la riga di comando una striscia mostra la sequenza in corso:
  `Percorso Mortaria → Tarnas  12/40  [Pausa] [Stop]`.

### 5.2 Percorsi

**Modello.** Un percorso ha: nome, zona, stanza di partenza e di arrivo (nome della stanza,
se noto), passi, note, avvertenze (es. "zona aggressiva"), origine (`pacchetto`,
`registrato`, `scritto a mano`), data dell'ultimo uso, preferito sì/no. I passi sono
comandi qualsiasi: direzioni, `run e`, `open frasca`, `enter portale`, `board diligenza`.
Nell'editor si scrivono nel formato compatto già in uso (`3n,open frasca,2w`).

**Pannello Percorsi.**
- Zone richiudibili, ricerca su nome, zona e note (senza badare ad accenti e maiuscole),
  sezioni *Preferiti* e *Usati di recente*.
- Clic su un percorso: dettaglio con passi, note, partenza e arrivo; pulsanti **Vai**,
  **Prova**, **Inverti**, **Modifica**, **Duplica**, **Elimina**.
- I 127 percorsi del pacchetto non si cancellano: si nascondono, oppure si modifica una
  copia che prende il loro posto.
- **Un passo alla volta** (richiesta del 2026-11-15): "A passi" nel pannello o
  `vai passo <nome>`. Il primo passo parte subito, poi il percorso si ferma dopo ogni passo
  riuscito; Invio sulla riga vuota, "Passo ▶" o `vai avanti` fanno il successivo, "Tutto" fa
  quelli rimasti di fila. Aprire una porta e ritentare fanno parte dello stesso passo.
- Comandi equivalenti dalla riga: `percorsi [zona]`, `vai <nome|numero>`, `vai stop`,
  `vai riprendi`.

**Registratore.**
- `rec` (o il pulsante nel pannello) inizia la registrazione e annota la stanza di partenza.
- Registra i comandi che mandi e che **spostano davvero**: un passo entra nel percorso solo
  quando arriva la stanza nuova; muri, porte chiuse e `look <direzione>` vengono scartati.
- Tiene anche `open`/`unlock` delle porte e i comandi dei mezzi (diligenza, mongolfiera,
  portali): sono quelli che non si ricostruiscono dalle sole direzioni.
- Nel pannello si vede il percorso crescere mentre cammini; `rec annulla` toglie l'ultimo
  passo, `rec pausa` sospende (es. per un combattimento lungo la strada).
- `rec fine` chiede nome, zona (proposta dalla zona della stanza, quando la mappa ci sarà) e
  note, e salva compattando le ripetizioni (`n,n,n` → `3n`).

**Inversione.** Crea il percorso di ritorno invertendo ordine e direzioni. I passi che non si
invertono da soli (mezzi, portali, porte da aprire dall'altra parte) vengono segnalati e
lasciati da sistemare a mano prima di salvare.

**Esecuzione.** Passa dall'esecutore (5.1).
- Se il percorso ha una stanza di partenza e tu non sei lì, il client lo dice e chiede se
  partire comunque.
- Si ferma su un passo fallito e scrive dove e perché (`fermo al passo 12/40: la porta e'
  chiusa`). Opzione per percorso: *apri le porte da solo* (un `open` e un nuovo tentativo).
- All'arrivo controlla, se nota, che la stanza sia quella attesa.

**Con la mappa (Fase 4).** Un percorso potrà essere anche solo una destinazione: "vai a X"
calcola la strada sulla mappa. I percorsi a passi restano per dove la mappa non arriva.

### 5.3 Vestiario

**Modello dell'equipaggiamento** (per personaggio), sempre aggiornato:
- **addosso**: slot → oggetto, con condizione (`in condizioni eccellenti`, `graffiato`…);
- **inventario**;
- **contenitori**: per ognuno il contenuto e quando è stato letto.

Si aggiorna in due modi:
- **letture complete**: le liste di `eq`, `inv` ed `exa <contenitore>`, già riconosciute dal parser;
- **messaggi dei singoli gesti**: indossi, togli, prendi, metti in, dai. Così il modello
  resta giusto anche senza rileggere tutto.

Ogni dato ha un'età. Se è vecchio o incerto, prima di un cambio di set il client rilegge
solo quello che serve.

**Oggetti.** Per ogni oggetto il client ricava la parola chiave (regole automatiche, come
oggi) e ricorda le eccezioni che imposti tu: parola chiave, comando per indossarlo
(`wear`/`hold`/`wield`), dove riporlo quando lo togli.

**Contenitori.** Sono un elenco configurabile per personaggio, non più "compendium e korred"
fissi. Per ognuno si indicano:
- nome e parola chiave;
- dove sta: indossato, in inventario o dentro un altro contenitore;
- se va tolto di dosso per poterlo usare.

**Pannello Equipaggiamento.**
- Slot con l'oggetto e la condizione a colori (verde eccellente, giallo/rosso usurato).
- Inventario e contenuto dei contenitori, con l'età della lettura e un pulsante *Aggiorna*.
- Elenco dei **set**: un clic per indossarlo; accanto, il confronto con quello che hai
  addosso (pezzi uguali, da cambiare, introvabili).
- Avviso quando un pezzo indossato scende sotto una condizione che scegli.

**Set.** Un set è una lista slot → oggetto.
- Si crea con *Salva quello che indosso* e poi si ritocca nel pannello: togli un pezzo,
  cambia l'oggetto di uno slot, imposta le eccezioni dei singoli oggetti.
- Lo slot può restare libero ("non mi interessa cosa c'è") o essere vuoto ("deve essere vuoto").
- Comando: `set <nome>` (e `set prova <nome>`, `set salva <nome>`).

**Cambio di set.**
1. Il piano parte dal modello, aggiornato se serve: cosa togliere, dove riporlo, dove prendere
   ogni pezzo nuovo, in che ordine (prima si liberano gli slot, poi il pezzo nuovo prende il
   posto del vecchio). L'algoritmo attuale di `plan.ts` è una buona base.
2. I pezzi introvabili vengono detti prima di partire; scegli se procedere senza.
3. L'esecutore manda i passi controllando le risposte, con le alternative (`hold` → `wear`).
4. Alla fine un `eq` conferma che il set è quello voluto e lo dice nell'output.

**Riparazione.**
- Il client riconosce il fabbro nella stanza (testo configurabile; oggi "fabbro molto
  esperto") e lo mostra nel pannello.
- **Ripara** elenca i pezzi non eccellenti e, su conferma, li toglie, li dà al fabbro e li
  rimette nello stesso slot, gestendo i doppi (stessa parola chiave) come fa oggi.
- Opzione *ripara da solo quando entro dal fabbro*, spenta di serie.

### 5.4 Automatismi

**Mantieni attivi** (sostituisce il rinnovo spell).
- Per personaggio, una lista di incantesimi presi dalla tabella delle abbreviazioni, con il
  bersaglio (di solito te stesso).
- Rilancio solo quando l'incantesimo **è finito** (messaggio di fine o lettera sparita dal
  prompt): finché è attivo il MUD non lo rilancia, quindi niente rilanci in anticipo e l'avviso
  "vacilla" non basta (correzione dell'utente del 2026-11-15).
- Se finisce in combattimento, il rilancio aspetta la fine del combattimento e il **loot del
  cadavere**: dopo un mob ucciso, finché arrivano righe "Prendi … da il corpo di …" (1,5 s di
  calma) o al massimo 6 s se il loot non c'è. Combattimento finito senza uccisioni (fuga):
  subito.
- Non rilancia: se i mana non bastano (il costo si ricava dal prompt e si ricorda), se dormi o sei in una posizione
  che non lo permette, durante un percorso (opzionale) o se l'ultimo tentativo è fallito da
  poco (attesa crescente, massimo di tentativi).
- Nel pannello Effetti gli incantesimi mantenuti hanno un segno e mostrano cosa farà il client.

**Regole sullo stato.** I trigger reagiscono al *testo*; le regole reagiscono a quello che il
client *sa*. Una regola è "quando *condizione* allora *azione*".
- Condizioni:
  - valori: HP, MP o MV sotto/sopra una soglia, anche in percentuale; oro;
  - posizione: a terra, seduto, in piedi;
  - fatti: mob ucciso, effetto finito, ingresso in una stanza (nome o mob presente),
    combattimento iniziato/finito, tick.
- Azioni: uno o più comandi, una sequenza (anche un percorso o un set), una notifica o un
  suono, accendere o spegnere un gruppo.
- Opzioni: attesa minima tra due scatti, numero massimo di scatti, solo in combattimento o
  solo fuori.
- Si scrivono in un editor a moduli (scegli condizione e azione da menu), non in codice;
  stanno nei gruppi già esistenti, con il loro interruttore.
- Arrivano già pronte, spente: *second wind sotto 70 MV*, *monete dal corpo dopo
  un'uccisione*, *in piedi dopo un bash*, *stand dopo un disarm fallito*.

  Per queste servono al parser due cose nuove: la **posizione** (a terra, seduto…) e la
  **morte del mob**.

**Giro pozze.** Una sequenza dell'esecutore con una lista di bersagli per personaggio.
- Per ogni bersaglio: `cast 'doorway' <bersaglio>`.
- Se il bersaglio non c'è, lo salta. Se il doorway fallisce, ritenta fino a N volte.
- Cosa succede a ogni pozza va ancora definito (vedi 5.7).

**Allarme furto**: già fatto, resta com'è.

### 5.5 Dove si vede

- Pannelli nuovi o rifatti: **Percorsi** (rifatto), **Equipaggiamento** (nuovo),
  **Automatismi** (nuovo: incantesimi mantenuti, regole, stato di ognuno, ultime azioni).
- Gli interruttori in alto restano: uno per *Mantieni attivi*, uno per gruppo di regole,
  uno per la riparazione automatica.
- La striscia dell'esecutore (5.1) sopra la riga di comando.

### 5.6 Cosa si toglie e cosa resta

| Oggi | Dopo |
|---|---|
| `src/nebbie/modules/eqset/` | Vestiario (5.3); `plan.ts` riusato come base del piano |
| `src/nebbie/modules/fabbro.ts` | Riparazione (5.3) |
| `src/nebbie/modules/secondWind.ts` | regola pronta (5.4) |
| trigger importati da Mudlet (rinnovo, monete, stand) | Mantieni attivi e regole pronte (5.4) |
| speedwalk e pannello percorsi attuali | esecutore (5.1) e Percorsi (5.2) |

I **dati** restano e si convertono da soli al primo avvio: i 127 percorsi del pacchetto, gli
8 registrati, i set e le eccezioni di `eqset.json`, le liste di incantesimi dei trigger.
Si tolgono anche il pulsante *Importa da Mudlet* e i preset relativi.

### 5.7 Domande aperte e risposte

1. **Giro pozze**: l'utente farà un giro con il log acceso mostrando tutti i casi
   (bersaglio presente, assente, doorway fallito). *In attesa del log.*
2. **Messaggi dei gesti** (wear, remove, get, put, give): l'utente manderà un cambio di
   alcuni pezzi. *In attesa del log.*
3. **Posizione e morte del mob**: per ora si usano i testi dei trigger Mudlet, già verificati
   in gioco; altri esempi (a terra, seduto, ti rialzi) quando capitano.
   - morte del mob: `Il tuo sangue si gela al grido di morte di (.+)\.`
   - bash subito: ` ti manda a gambe all'aria\.` (apostrofo dritto o tipografico, a volte
     seguito da `[numero]`)
   - disarm fallito: `Provi a disarmare (.+), ma fallisci miseramente\.`
4. **Costo in mana**: non è noto. Il client lo ricava dal prompt (MP subito prima e subito
   dopo il cast riuscito) e lo ricorda per incantesimo, come fa già con le durate.
5. **Percorso e combattimento**: il percorso si ferma **in entrambi i casi**, sia quando
   inizia un combattimento sia quando un passo fallisce.
6. **Ordine di lavoro**: da decidere con l'utente dopo l'esecutore.

## 6. Scripting utente

- Script TypeScript/JavaScript in un Web Worker, ricaricabili a caldo, con errori mostrati
  nell'output e nel pannello Strumenti.
- API minima: `send(cmd)`, `on(evento, fn)`, `trigger(regex, fn)`, `alias(regex, fn)`,
  `timer(ms, fn)`, `state` (sola lettura: pg, stanza, affetti), `ui.notify`, `ui.button`,
  `storage.get/set` per script. Nomi italiani in aggiunta dove esistono già nei pacchetti.
- Editor integrato semplice (CodeMirror 6) con evidenziazione e completamento dell'API.

## 7. Qualità

- Test dei parser su fixture reali: ogni bug di parsing diventa una nuova fixture.
- Prestazioni: 1.000 righe/secondo in ingresso senza perdere fluidità; mappa con 20.000
  stanze a 60 fps in trascinamento.
- Nessun dato inviato a terzi; nessuna telemetria.
