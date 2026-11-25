# Changelog — Nebbie Client

## Non rilasciato

### Pronto per GitHub (2026-11-25)
- Licenza MIT (Mindwiped), README nuovo con certificato di firma e primo avvio spiegati passo
  passo, guida ai pannelli in `docs/GUIDA.md`.
- La versione pubblicata è una copia del repository di sviluppo, senza le note di lavoro e con
  nomi d'esempio al posto dei personaggi veri.
- Le 74 abbreviazioni della vecchia guida sono scritte direttamente nel test.
- mudder: una stanza segnaposto senza uscite (`null.wld`) non sostituisce più quella vera:
  l'Accademia di magia torna raggiungibile da Myst.

### Vestiario: zaino, riordino delle borse, parole chiave univoche (2026-11-24)
- Nuovo: `eqset riordina [prova]` mette ogni pezzo nel suo posto (`eqset posto`): apre il
  compendium, tira fuori e legge le borse interne, sposta i pezzi sbagliati e rimette tutto.
- Nuovo: parole chiave univoche (`eqset chiavi`, e da solo a ogni cambio di set e riordino).
  Il MUD prende anche l'inizio di una parola (`bracciale` prende i braccialetti, `calzari` i
  coturni, che tra le parole chiave hanno "calzari"): per i pezzi con una parola in comune ne
  sceglie una che nessun altro ha, tra quelle vere del Reliquiario (identify, file d'area) o in
  mancanza tra le parole del nome. Le chiavi scritte a mano restano.
- Corretto: a fine cambio di set i pezzi doppi prendevano tutti lo slot del primo (due
  braccialetti "al polso destro", due lobi "all'orecchio destro"); così un bracciale restava
  senza coppia e `remove bracciale` toglieva il braccialetto (log del 2026-11-24, ritorno da
  istanza a default fermo sul bracciale). Ora uno slot ciascuno, e i pezzi con parole una
  l'inizio dell'altra si tolgono tutti subito, prima la più lunga (rimettendo quello che resta).
- Parole chiave che sono l'inizio di altre (`bracciale` e `braccialetto`): nel cambio di set e
  nel riordino il pezzo con la parola più lunga si muove prima, così `bracciale` non prende il
  braccialetto.
- Cambio di set: un pezzo in una borsa interna non letta si cerca prima nel suo posto, e se non
  c'è si leggono anche le altre borse (prima solo la prima).

### Mondo dai file d'area: oggetti, mob, percorsi (2026-11-23)
- Nuovo: `tools/mudder` estrae dai file d'area (formato SillyMUD) stanze, mob, oggetti e reset
  delle zone, con i nomi dei flag letti dal binario del server. Nessun dato del gioco nel repo.
- Reliquiario: gli oggetti del mondo entrano in `identi.js`; quelli già identificati restano
  com'erano e ricevono le note `MUD:` (numero, zona, quali mob li indossano o li portano).
- Nuovo bestiario `mob.js` e vista **Mob** nel pannello Reliquiario: livello, classe, razza,
  PF/AC/danno, incantesimi attivi, resistenze, immunità, suscettibilità, comportamento, stanze
  di spawn con il percorso a piedi da Myst (pulsante Vai), equipaggiamento e inventario.
  Ricerca per parole e livello (`lvl>40 sanctuary`).
- Percorsi con origine `mud` (◆ nel pannello): l'ingresso di ogni zona raggiungibile a piedi.

### Versione Windows (2026-11-22)
- Nuovo: il client si compila anche per Windows dal Mac (`npm run pacchetto:windows`, con
  cargo-xwin, LLVM/lld e NSIS). Password nel Gestore credenziali di Windows, come nel
  Portachiavi su macOS. Etichette dei tasti per sistema (Alt+1 e Ctrl+A su Windows, ⌥1 e ⌘A
  su Mac), selezione multipla nella mappa anche con Ctrl, font Consolas come ripiego.
- Limite noto: il `makensis` 3.13 di Homebrew va in crash su questo macOS (anche con uno
  script minimo che usa `Exch`), quindi l'installer `.exe` non si crea ancora; l'eseguibile
  sì, e si distribuisce come zip portabile.

### Icona nuova: il lich nella nebbia (2026-11-22)
- Icona dell'app e favicon: un lich originale incappucciato, con corona di ferro e occhi
  necrotici verdi, su cielo tempestoso e nebbia. Sorgente in `assets/icona.svg`.

### Pannelli ad altezza su misura (2026-11-19)
- Nuovo: a destra delle schede di ogni gruppo di pannelli, ↕ porta il gruppo all'altezza del
  suo contenuto e lascia il resto agli altri gruppi della stessa colonna; A tiene l'altezza
  adattata da sola quando il contenuto cambia (per esempio i timer di Effetti) e si salva col
  layout. Per impilare i pannelli piccoli uno sopra l'altro si trascina la scheda sul bordo
  basso di un altro pannello; la linea tra i due gruppi si trascina sempre a mano.
- Corretto: nell'app il trascinamento delle schede non funzionava, perché la finestra
  intercettava i trascinamenti per i file (`dragDropEnabled` di Tauri, ora spento). In più c'è
  ⇩ accanto a ↕: "Impila sotto" un altro pannello, o "Come scheda di", senza trascinare.

### Mantieni attivi: rilancio automatico spegnibile per incantesimo (2026-11-18)
- Nuovo: nel pannello Automatismi, accanto al ⟳ (lancio a mano), il tasto "auto" spegne e
  riaccende il rilancio automatico di un solo incantesimo, che resta in elenco. Lo stesso dal
  pannello Effetti: clic sul ↻ accanto al timer (barrato = spento). Il ⟳ a mano funziona anche
  da spento; se l'incantesimo aspettava già il rilancio, esce dalla coda. `mantieni` lo segnala
  nell'elenco.

### Split automatico delle monete del loot (2026-11-18)
- Nuovo: regola pronta "split delle monete prese dal cadavere". Quando prendi monete da un
  corpo o da una pila di polvere ("Prendi gold coins da il corpo di …" seguito da "C'erano
  10.000 monete."), manda `split 10000`. Prima non esisteva: la regola del loot faceva solo
  `get all.coin`, e nel log del 2026-11-18 gli split erano tutti a mano. Nei profili esistenti
  la regola compare spenta nel pannello Automatismi. Le monete non prese da un cadavere non si
  dividono. Nelle regole a evento c'è "monete prese da un cadavere", con `{nome}` = quante.

### Percorsi un passo alla volta, timer, zone senza magia (2026-11-18)
- Corretto: con "un passo alla volta" gli automatismi (Mantieni attivi, loot delle regole)
  restavano in coda per tutto il percorso, anche nelle pause tra un passo e l'altro in cui si
  combatte, e alla fine partivano tutti insieme (log reale: 11 `get all.coin corp` e 11
  `get all.coin dust` di fila, più i rilanci). Ora in pausa girano subito; il passo successivo
  aspetta che i comandi automatici abbiano risposto (al massimo 8 s), così la loro risposta non
  viene presa per quella del passo. Un comando uguale già in coda non si ripete.
- Corretto: il conto alla rovescia degli incantesimi corti era sbagliato perché la durata si
  imparava in secondi, mentre gli incantesimi finiscono su uno scatto del tick (anti magic
  shell: 91, 107, 130, 134, 143 s, ma sempre al 2° tick dopo il lancio). Ora si impara anche il
  numero di scatti e la fine prevista cade sullo scatto giusto (serve conoscere il tick; la
  prima volta si impara).
- Mantieni attivi: "Il mana si rifuta di scorrere in questa zona." non conta come tentativo; si
  riprova entrando in un'altra stanza (prima: tre lanci a vuoto nella banca di Myst).

### Reliquiario (2026-11-17)
- Il client aggiorna il database degli oggetti della pagina `identi.html` come faceva lo script
  Mudlet "Identi", nello stesso file `identi.js` e nello stesso formato (pagina, Mudlet e client
  restano compatibili). Ogni identify (pergamena o incantesimo) si salva col nome preso
  dall'ultimo "Smetti di usare / Prendi / Impugni / Tieni in mano"; ogni `eq` salva
  l'equipaggiamento del pg del prompt così com'è (lo script Mudlet teneva i pezzi tolti, e l'eq
  salvato non era più quello vero; nome e posto dei pezzi tolti restano sull'oggetto).
- Si accende in **Impostazioni → Reliquiario** scegliendo la cartella di `identi.js` (vuota =
  spento: chi riceve il client non ha la tua cartella). Prima di ogni scrittura il file si
  rilegge, così le modifiche fatte con la pagina non si perdono; un file che non si legge non
  viene sovrascritto.
- Pannello **Reliquiario**: ricerca per nome, flag o statistica con la scheda dell'oggetto, e
  l'eq di ogni pg con le statistiche dal database ("da identificare" per quelli mancanti). Nel
  pannello Equipaggiamento le statistiche compaiono passando sopra ai pezzi.
- Comandi: `reliquiario` (stato), `reliquiario ricarica`.
- **Oggetti nelle borse**: ogni oggetto può avere il suo contenitore (campo `contenitore` in
  identi.js; i nomi scelti in `contenitori`). Sezione **Nelle borse** del pannello con filtro per
  contenitore e l'elenco dei nomi da modificare; il contenitore si cambia dalla scheda di ogni
  oggetto.
- **Importa…**: incolli uno o più identify (es. dal documento con i copia-incolla) e scegli in
  che contenitore sono; righe vuote, note e prompt in mezzo non danno fastidio.
- Corretto: un oggetto con una sola parola chiave (`cero`) non veniva mai riconosciuto
  ("Cero della Veglia Funebre" restava "da identificare" e l'identify non prendeva il nome).
  Ora basta quella parola, ma solo per gli oggetti senza nome: `elmo` della wiki ("Vikinghi
  Elmo Soti") non diventa "L'elmo con maschera oscura".
- Dopo un identify in gioco un riquadro in basso a destra chiede se l'oggetto sta in un
  contenitore (Salva / No / Dopo); non blocca il gioco e più identify fanno la coda.

### Mantieni attivi: niente lanci doppi (2026-11-16)
- Corretto: dopo un dispel magic gli incantesimi partivano tutti insieme; il MUD li esegue in
  coda e "Pronunci le parole" degli ultimi arrivava dopo i 6 s di attesa, così il client li
  rilanciava quando erano già attivi (fireshield due volte). Ora i rilanci partono uno alla
  volta, il successivo dopo la risposta del precedente; si riprova solo se il MUD tace per 8 s.
- "Non c'e' nessuno con quel nome qui." in risposta a un rilancio (es. invisibile senza detect
  invisibility, il tuo nome non ti trova): avviso e niente altri tentativi.

### Spostare stanze tra le zone (2026-11-16)
- Mappa, tasto destro su una stanza (o scheda della stanza): **Sposta in un'altra zona…**.
  Sposta tutto il gruppo collegato (le stanze unite da uscite dentro la stessa zona) o solo
  quella stanza, in una zona esistente o in una zona nuova col nome che scegli. Le stanze
  tengono la loro forma e si allineano a un'uscita che le collega già alla zona di arrivo.
  Per le isole sposta tutta l'isola (sostituisce il vecchio "Sposta isola nella zona").
- Selezione di più stanze nella mappa: **Maiusc+clic** (o ⌘+clic) aggiunge o toglie una
  stanza, **Maiusc+trascina** seleziona quelle dentro un rettangolo, dal tasto destro
  "Seleziona il gruppo collegato" e "Aggiungi/Togli dalla selezione". Le stanze scelte hanno il
  bordo rosso; la barra in alto le conta e le sposta tutte insieme. Serve a separare un pezzo
  di zona anche quando è collegato al resto.
- Corretto: una stanza nuova nata nella zona di registrazione mentre eri in un'altra zona
  prendeva le coordinate della zona di partenza e finiva in un punto a caso (il Palazzo di
  Agamennone). Ora va al centro se la zona è vuota, altrimenti ai margini, con un avviso.
- Se il mapper registra e la stanza in cui sei si sposta, le stanze nuove vanno nella zona di
  arrivo.

### Contenitori del vestiario per personaggio (2026-11-16)
- Finestra **Contenitori…** (pannello Equipaggiamento): per ogni personaggio scegli dove si
  cercano i pezzi da indossare (inventario e poi i contenitori, in ordine; nessuno, uno o più,
  anche uno dentro l'altro) e dove vanno quelli tolti. Gli oggetti visti in eq e inventario si
  aggiungono con un clic. Niente nomi di contenitori predefiniti.
- Al primo cambio di set di un personaggio mai impostato la finestra si apre da sola e il
  cambio parte dopo il salvataggio. Nuovo campo `destinazione` in vestiario.json e comando
  `eqset destinazione <contenitore>|inv`. Le configurazioni esistenti non cambiano.
- Icona nuova dell'app: torre nella nebbia (sorgente in `assets/icona.svg`).

### Pacchetto per macOS (2026-11-15, Fase 6)
- `npm run tauri build` crea `Nebbie Client.app` e il `.dmg`, firmati con il certificato
  locale "Nebbie Client Locale" (`bundle.macOS.signingIdentity`). Identità stabile tra una
  compilazione e l'altra: un solo "Always Allow" per la password nel portachiavi.
  Istruzioni in docs/PACCHETTO.md.
- Pacchetto redistribuibile: `npm run pacchetto` toglie dalla parte Rust i percorsi con il nome
  utente; il server MUD finto non entra più nell'app; la vecchia configurazione EqSet non ha più
  oggetti di un personaggio preciso come valori predefiniti.

### Log compressi (2026-11-15)
- I log di sessione restano in chiaro solo gli ultimi 5: i più vecchi diventano `.log.gz`
  (gzip, data originale conservata), all'avvio del client e a ogni collegamento. Il replay legge
  anche i `.log.gz`. Prima compressione: 47 log, da 6,5 MB a 956 KB.

### Script utente (2026-11-15, Fase 5)
- **Automazioni… → Script…**: script JavaScript tuoi, editor CodeMirror (colori, numeri di
  riga), Prova/Ferma, "parte da solo"; salvati in `script.json`; comandi `script`,
  `script avvia|ferma <nome>`.
- Ogni script in un Web Worker isolato con l'API `nebbie` (docs/SCRIPT.md): send, echo, onLine,
  onPrompt, eventi (stanza, mobUcciso, combattimento, aTerra, incantesimoFinito, messaggio),
  comandi tuoi, stato, attese. Niente finestra, file, password né rete (CSP: solo
  `worker-src 'self' blob:` in più).
- Comandi degli script visibili nell'output (`⚙ Script <nome>`); oltre 40 in 10 s lo script si
  ferma; gli errori si vedono e non lo fermano.
- CodeMirror 6 (codemirror 6.0.2, lang-javascript 6.2.5, theme-one-dark 6.1.3), dipendenze
  risolte a versioni di almeno due settimane.

### Abbreviazioni di tutti gli incantesimi (2026-11-15)
- La tabella predefinita copre tutto l'elenco `ALL` del MUD: 181 incantesimi (chierico, mago,
  druido, stregone) e 34 poteri psionici, oltre alle 74 abbreviazioni Mudlet che restano
  uguali; le 46 abilità (bash, kick, parry…: mana 0 o 200) sono escluse.
- I poteri psionici sono comandi diretti (log reali: `doorway niobe`): `doorw niobe` →
  `doorway niobe`, senza `cast`.
- Abbreviazioni proposte: parola corta intera, prime 5 lettere, 2+2 lettere per due parole,
  iniziali per tre o più (`pfe` = protection from evil); mai un comando del MUD (`cturn`).
- **Editor** (Automazioni… → Abbreviazioni incantesimi…): cerca, modifica, aggiungi, elimina,
  "Diretto", ripristina le predefinite; righe doppie o vuote segnate in rosso.
  Salvate in `abbreviazioni.json`.
- **Importa da ALL**: il client legge l'elenco quando lo scrivi nel gioco (tutte le pagine) e
  aggiunge solo gli incantesimi che non hanno ancora un'abbreviazione.

### Impostazioni: aspetto e avvisi (2026-11-15, Fase 6)
- Finestra **Impostazioni…** (in alto): tema Scuro o Nero (contrasto alto), dimensione del testo
  dell'output, scala dell'interfaccia; anteprima immediata, "Annulla" torna a com'era.
  Salvate in `impostazioni.json`.
- **Avvisi** con suono (toni generati, niente file audio) e notifica di sistema (solo con la
  finestra non in primo piano), scelti evento per evento: furto, finito a terra, messaggio
  privato ("ti dice"), messaggio al gruppo, HP sotto una soglia (una volta, si riarma sopra
  soglia + 5%), collegamento perso (non quando scolleghi tu). Stesso avviso entro 2,5 s: uno.
- Plugin notifiche di Tauri 2.8.0.
- **Tema chiaro**: fondo chiaro, pulsanti, campi, pannelli, mappa e finestre chiari; i 16 colori
  del MUD hanno una tavolozza scurita (giallo e bianco altrimenti non si leggono). I colori dei
  pannelli sono diventati variabili del tema (`src/app.css`).

### Mapper acceso a mano, zone e isole (2026-11-15)
- L'interruttore **MAPPER** accende la registrazione, che parte sempre spenta. Spento, il
  mapper segue solo la posizione sulle stanze già note: non crea, non collega, non posa monete.
- Accendendolo, il client chiede se le stanze nuove fanno parte di una zona che hai già (la
  scegli) o di una zona nuova (le dai il nome). Comandi: `mappa on [zona]`, `mappa off`.
- **Sposta isola nella zona**: tasto destro su una stanza di un'isola (o dal riquadro della
  stanza): tutte le stanze dell'isola passano nella zona scelta, allineate all'uscita che le
  collega se c'è, altrimenti accanto, mai sovrapposte; l'isola sparisce.
- **Strumenti della mappa**: unisci due stanze, elimina (con conferma), rinomina zona (✎), note
  e mob nel riquadro (i mob uccisi si aggiungono da soli mentre registri), ricerca (⌕). Comandi
  `mappa unisci|elimina|nota|cerca`.
- **Mantieni attivi**: rilancia solo quando l'incantesimo è finito (tolti "all'avviso" e
  "30/60 s prima": finché è attivo il MUD non lo rilancia); se finisce in combattimento aspetta
  la fine del combattimento e il loot del cadavere.
- **Percorsi un passo alla volta**: "A passi" nel pannello Percorsi o `vai passo <nome>`; dopo
  ogni passo il percorso aspetta Invio sulla riga vuota (o "Passo ▶", `vai avanti`); "Tutto"
  fa i passi rimasti di fila, "A passi" nella striscia lo accende su un percorso già partito.
- **Mappa**: unione automatica delle isole quando le colleghi camminando; se le monete di una
  stanza marcata spariscono (raccolte da altri), la posizione basta a riconoscerla e le monete
  si rimettono, senza doppioni.
- **Sfondi**: rosso sulla riga dell'azione che ti manda a terra (bash subito, disarm fallito),
  verde su "Ti alzi." o sullo `stand` mandato dopo.
- **Combattimento con sir Goldblum** (log del 2026-11-15): un effetto finito nel prompt che
  apre il combattimento non viene più rilanciato in mezzo (prima si leggevano le lettere, poi
  il combattimento); dopo il combattimento Mantieni attivi aspetta le risposte ai comandi di
  loot (`get … corp|dust`, anche "da a pile of dust and bones" e "Non vedi nessun …"), al
  massimo 15 s; "Pensavi di poter combattere da seduto?" = ancora a terra (rosso, la regola
  stand riparte).
- **Tick**: una lettera che sparisce dal prompt conta come tick solo se l'effetto è scaduto
  davvero (dopo la minuscola, o fuori combattimento per gli effetti che non si rompono da soli).
  Invisibilità rotta attaccando e immagini distrutte dai colpi spostavano il tick di 15 s e
  falsavano la durata (72,5 s invece di 75); durate accettate solo tra 70 e 80 s.
- Correzioni dal giro del 2026-11-14: una porta chiusa non crea più una stanza nuova; i vicini
  tutti con lo stesso nome non valgono come prova; un'uscita illogica verso una stanza unica
  ritrova quella stanza; il pannello disegna subito le stanze nuove.

### Mappa e mapper nuovi (2026-11-14, Fase 4, SPECIFICA cap. 4)
- Niente importazione da Mudlet: la mappa nasce vuota e si costruisce giocando
  (`mappa.json`, salvata 3 secondi dopo l'ultima modifica).
- **Mapper automatico**: ogni comando aspetta il suo prompt, un `run` porta più stanze.
  Camminando segue l'uscita nota, poi la stanza già mappata nel punto atteso, poi la stessa
  stanza altrove solo con prova positiva (dalla parte da cui arrivi indica la stanza da cui
  vieni), altrimenti crea una stanza nuova. Firma = titolo + prime due righe della descrizione
  (in fondo il MUD aggiunge righe che cambiano, come il sangue); vicini da "Uscite visibili".
  Arrivi senza passo: stanza ritrovata per firma, altrimenti isola (comando di viaggio) o
  posizione sconosciuta. Porte aperte prima di un passo ricordate sull'uscita.
- **Pannello Mappa** (in alto a destra nel layout predefinito): canvas con stanze numerate,
  linee, tratti per le uscite non esplorate, frecce per i sensi unici, triangoli su/giù,
  cerchio rosso sulla stanza attuale; zoom con rotella o +/−, trascinamento, ◎ per tornare a
  seguire, scelta della zona e del piano; clic su una stanza: uscite, descrizione, **Vai qui**
  (percorso più breve con le porte, eseguito come un percorso) e **Sono qui**.
- Interruttore MAPPER; comandi `mappa`, `mappa on|off` (prima `pausa|riprendi`), `mappa sono <n>`,
  `mappa vai <n>`, `mappa zona <nome>`, `mappa reset conferma`.
- **Stanze identiche marcate con le monete** (idea dell'utente): entrando in una stanza con
  descrizione e uscite identiche a un'altra della zona, il client posa 1, 2, 3… monete (una alla
  volta) e da quelle per terra riconosce la stanza, anche arrivandoci da una direzione illogica,
  e collega l'uscita di conseguenza. Puntino dorato sulla mappa; `mappa monete on|off`.
- Correzione dalla prova in gioco: la marcatura scattava anche nelle stanze uniche (la stanza
  stessa contava come "un'altra identica"), e ripassandoci senza monete la stanza veniva
  esclusa e rifatta, creando doppioni. Ora si marca solo se esiste davvero un'altra stanza
  identica; caricando la mappa le marche inutili si tolgono da sole; monete già per terra che
  nessuna stanza usa diventano la marca della stanza.
- Niente marcatura se ci sono altri passi già mandati (es. `d;e;e;s` scritto di fila): il drop
  arriverebbe al MUD dopo di loro e le monete cadrebbero più avanti (log reale).
- La marca si assegna solo quando le monete vengono posate davvero: durante un percorso non si
  posano e prima la stanza restava "marcata" senza monete (rischio di doppioni). Al caricamento
  si tolgono le marche senza monete.
- Provato rigiocando un log vero di 50 minuti: 71 stanze, nessuna sovrapposizione.

### Automatismi nativi (2026-11-13, SPECIFICA 5.4)
- **Mantieni attivi** (per personaggio): rilancia gli incantesimi scelti alla fine, all'avviso
  ("vacilla", lettera minuscola nel prompt: vale anche per le pozioni) o 30/60 s prima della fine
  stimata. Impara il costo in mana dal prompt e aspetta i mana se non bastano; riprova fino a 3
  volte se non arriva "Pronunci le parole". Comandi `mantieni`, `mantieni <incantesimo>
  [bersaglio]`, `mantieni via <incantesimo>`, `mantieni on|off`, `mantieni lancia <incantesimo>`.
  Nel pannello Effetti gli incantesimi mantenuti hanno ↻.
- **Regole sullo stato**: "quando HP/MP/MV/oro sotto o sopra una soglia (anche in %) / mob ucciso
  / a terra / incantesimo finito / inizio o fine combattimento / ingresso in una stanza, allora
  comandi (con `{pg}` e `{nome}`) o un avviso", con attesa minima, combattimento sì/no/sempre.
  Pronte e spente: second wind sotto 70 MV, monete dopo un'uccisione, in piedi dopo bash o disarm
  fallito. `regole`, `regole on|off`.
- Gli automatismi non mandano niente in mezzo a una sequenza (percorso, cambio di set): aspettano
  che finisca. Tutto quello che parte si vede nell'output e nelle ultime azioni del pannello.
- **Pannello Automatismi** (scheda accanto a Effetti): incantesimi mantenuti con bersaglio,
  momento del rilancio, costo, "lancia adesso"; regole con editor a moduli; ultime azioni.
- Interruttori MANTIENI ATTIVI e REGOLE al posto di SECOND WIND. `automatismi.json` (per
  profilo); il vecchio second wind di moduli.json diventa la regola corrispondente, accesa.
- Dalle prove in gioco: il costo in mana imparato è il più alto misurato (con la rigenerazione
  tra due prompt la differenza può risultare più bassa: shield risultava 1).
- Parser: nuovi eventi per bash subito e disarm fallito (a terra), inizio e fine combattimento.
- Tolti il modulo Second wind, il pulsante *Importa da Mudlet* e i trigger convertiti da Mudlet.

### Vestiario nativo (2026-11-13, SPECIFICA 5.3)
- **Modello dell'equipaggiamento**: addosso, inventario e contenitori con l'ora della lettura,
  aggiornati da `eq`, `inv`, `exa` e dai messaggi dei gesti (Smetti di usare, Indossi, Ti
  metti, Prendi … da, Metti … in, Posi, Dai).
- **Contenitori generici** per personaggio al posto di compendium e korred fissi:
  `eqset contenitori`, `eqset contenitore <parola> indossato|inventario [togli]`,
  `eqset contenitore <parola> dentro <altro>`, `eqset contenitore via <parola>`.
- **Cambio di set sull'esecutore**: legge eq e inventario, toglie ed esamina i contenitori,
  tira fuori quelli interni solo se servono, esegue con controllo delle risposte (hold → wear),
  rimette tutto a posto e verifica. Si vede nella striscia; fermato, si riprende o si salta il
  passo, e chiudendolo i contenitori tornano a posto. I contenuti dei contenitori interni già
  letti non si rileggono.
- **Riparazione sull'esecutore**: `ripara` (o il pulsante nel pannello) con il fabbro nella
  stanza, riconosciuto dai mob della stanza; `ripara auto on|off` (interruttore FABBRO) ripara
  dopo un `eq` scritto da te.
- **Pannello Equipaggiamento**: set con confronto e Indossa/Prova, pezzi del set (togli un
  pezzo), salva quello che indossi, addosso con condizione a colori, inventario, contenitori.
- Correzione: scegliendo il profilo l'interfaccia entrava in un ciclo infinito di Svelte
  (lo stato degli interruttori veniva letto e riscritto nello stesso effetto) e smetteva di
  aggiornarsi: barre, oro e pannelli fermi. Ora il profilo si applica con `untrack` e gli
  interruttori si ricavano dai moduli senza leggere lo stato.
- Dalle prove in gioco: con due pezzi dalla stessa parola chiave di cui uno resta (due
  Verdespina, come luce e in mano) il cambio li toglie entrambi e rimette quello giusto, perché
  `remove` sceglie da solo quale togliere; riconosciuti altri messaggi di vestizione ("Indossi
  X.", "Usi X.", "Ti avvolgi con X.", "Prendi X in mano.", "Metti X sulle mani."). Messaggi
  annotati in `docs/PROTOCOLLO_NEBBIE.md`.
- `vestiario.json` (per profilo) sostituisce `eqset.json`, convertito da solo al primo avvio;
  la riparazione automatica eredita l'interruttore Fabbro. Tolti i moduli EqSet e Fabbro portati
  da Mudlet.

### Oro accanto alle barre (2026-11-13)
- Le monete in tasca lette dal prompt si vedono accanto alle barre HP/MP/MV.

### Esecutore di sequenze e percorsi nativi (2026-11-13, SPECIFICA 5.1–5.2)
- **Esecutore**: manda i comandi uno alla volta, il successivo al prompt del precedente, e
  controlla ogni passo. Un movimento deve portare in una stanza nuova; muro, porta chiusa,
  nessuna risposta in 8 s o un combattimento fermano la sequenza, che resta riprendibile
  (`vai riprendi`) o permette di saltare il passo fallito (`vai salta`). Sostituisce lo
  speedwalk.
- **Striscia** sopra la riga di comando con la sequenza in corso o ferma (Pausa, Stop,
  Riprendi, Salta, Chiudi) e la registrazione in corso. **Esc** sulla riga vuota ferma tutto.
- **Percorsi**: id stabili, stanza di partenza e di arrivo, preferiti, usati di recente,
  opzione "apri le porte chiuse da solo". Lontano dalla partenza `vai` chiede conferma
  (ripetere entro 15 s); all'arrivo controlla la stanza. `vai prova <nome>` mostra i comandi.
- **Pannello Percorsi** rifatto: preferiti, usati di recente, dettaglio con Vai, Prova,
  Inverti, Modifica, Duplica, Elimina/Nascondi. I percorsi del pacchetto non si cancellano: si
  nascondono, e modificarli crea una copia che li sostituisce.
- **Registratore** `rec`: tiene solo i passi che portano davvero in un'altra stanza, più porte
  aperte e portali; `rec fine <nome>`, `rec annulla`, `rec pausa`, `rec riprendi`, `rec scarta`,
  o dal pannello. Salva compattando (`n,n,n` → `3n`) con partenza e arrivo.
- **Inversione**: percorso di ritorno con le porte davanti allo stesso passaggio; i passi che
  non si invertono da soli sono segnalati prima di salvare.
- Dalle prove in gioco: le NEWS del login non diventano più il titolo della prima stanza
  (sbagliava la partenza dei percorsi registrati); "Apri una frasca." e simili contano come
  porte aperte (il registratore tiene `open frasca`); "Non ti pare il caso di correre in quella
  direzione." è un passo impossibile.
- `percorsi.json` passa alla versione 2 (conversione automatica dei registrati); un file
  danneggiato non viene più sovrascritto.

### Moduli dai pacchetti Mudlet (2026-11-13, anticipati dalla Fase 3)
- **Fabbro** (da `fabbro_riparazioni.xml`): con "fabbro molto esperto" nella stanza, dopo `eq`
  ripara i pezzi non in condizioni eccellenti; doppi senza `2.` (remove, give, remove, give,
  wear, wear); spostarsi fa perdere il fabbro. Comandi `fabbro`, `fabbro si|no|on|off`.
- **EqSet 2** (da `eqset.xml`): `eqset <set>`, `salva`, `forza`, `prova`, `mostra`, `elimina`,
  `chiave`, `usa`, `posto`, `borsa`, `compendium`, `errori`, `errore`, `stop`. Legge eq,
  inventario, compendium e borsa (`exa`), esegue un comando alla volta, prova `wear` se `hold`
  fallisce, rimette borsa e compendium e verifica. Configurazione per personaggio in
  `eqset.json`; quella di Rigel importata da `eqset_set.lua` (set standard, default,
  istanza).
- **Second wind**: sotto 70 MV lancia `cast 'second wind' <pg>`, riprova dopo 8 s.
  Comandi `secondwind on|off|<soglia>`.
- Interruttori Fabbro e Second wind nella barra in alto; impostazioni in `moduli.json`.
- Output: le dimensioni si misurano subito all'avvio (prima, con la finestra non disegnata,
  l'output poteva restare fermo alle prime righe).

### Trigger da Mudlet (2026-11-13)
- Pulsante **Importa da Mudlet** nelle Automazioni: aggiunge i gruppi Rinnovo incantesimi (stone,
  minor/major invulnerability, armor, shield, strength, fly), Loot (monete dopo un'uccisione) e
  Combattimento (stand dopo bash o disarm fallito), convertiti da `trigger_rinnovo_incantesimi.xml`,
  ognuno con il suo interruttore. Non duplica gruppi già presenti.
- Segnaposto `{pg}` nei comandi di alias, trigger e pulsanti: il nome del personaggio collegato.
- Non convertito: second wind sotto 70 MV (diventerà un modulo con condizione sul prompt).

### Percorsi da Mudlet (2026-11-13, anticipato dalla Fase 5)
- I 127 percorsi in 52 zone del pacchetto `percorsi_ui.xml` (versione installata) in
  `src/nebbie/paths/percorsi.json`; gli 8 percorsi registrati con `rec` in Mudlet
  (`percorsi_salvati.lua`) importati nei dati del client (`percorsi.json`).
- Pannello **Percorsi** (scheda accanto a Stanza): zone richiudibili, ricerca su nome, nota, zona
  e info, doppio clic o "Vai" per partire, percorso in corso con "Ferma".
- Comandi del client: `percorsi`, `percorsi <zona>`, `vai <nome|numero>`, `vai stop`.
- Speedwalk: un comando alla volta, il successivo al prompt (o dopo 4 s); si ferma su muro o
  porta chiusa, non sulla fine di un `run`.

### Fase 2, passo 5 — barra pulsanti (2026-11-13)
- Barra pulsanti sopra le barre HP/MP/MV: etichetta, colore, comando (alias, `;`, `#n`,
  abbreviazioni), scorciatoia F1-F12 o ⌥1-⌥0, per tutti i personaggi o per uno solo. I comandi
  non entrano nella cronologia e compaiono come `▶ etichetta → comandi`. Editor con ordine dei
  pulsanti e controllo delle scorciatoie in conflitto; salvati in `pulsanti.json`.

### Fase 2, passo 4 — alias, trigger, interruttori (2026-11-13)
- **Automazioni…**: editor di gruppi, alias e trigger, con prova sul campo. Gruppi validi per
  tutti i personaggi o per uno solo, accesi o spenti in blocco; salvati in `automazioni.json`.
- **Alias**: regex ancorata con `$1`…`$9`, più comandi con `;` e `#n`, alias che usano altri alias
  (con limite); espansi prima delle abbreviazioni degli incantesimi, l'eco mostra cosa parte.
- **Trigger**: testo o regex sulle righe del MUD; mandano comandi (scritti nell'output col nome
  del trigger), colorano o nascondono la riga. Un trigger che scatta più di 5 volte al secondo
  si spegne da solo con un avviso.
- **Interruttori in alto** per i gruppi segnati "Interruttore in alto".
- Barra in alto che va a capo nelle finestre strette; colonna destra del layout predefinito
  larga 360 px anche se l'area non è ancora disegnata.

### Fase 2, passo 3 — timer, statistiche, allarme furto (2026-11-13)
- **Timer degli incantesimi** nel pannello Effetti con conto alla rovescia: da `att` (tick ≈ 75 s,
  misurato sui log) e dalle durate imparate tra lancio e fine, ricordate per profilo
  (`durate.json`). Rossi negli ultimi 30 s, gialli dopo l'avviso "vacilla".
- **Statistiche di sessione** in un pannello nuovo: durata, XP (dalla X del prompt), XP/h,
  XP persa, mob uccisi (anche per nome), monete raccolte, "Reset sessione".
- **Allarme furto** `[FURTO?]` in rosso nell'output quando l'oro del prompt cala senza un comando
  recente (attivo solo se il prompt mostra l'oro).

- **Tick** con conto alla rovescia nel pannello Statistiche, ricavato dalle scadenze degli
  incantesimi (Nebbie non segnala il tick); la durata parte da 75 s e si affina da sola. I timer
  di `att` finiscono allo scatto del tick quando la sua fase è nota.
- Corretto: "La tua immagine illusoria svanisce." è un'immagine distrutta in combattimento, non
  la fine di mirror images (non toglie il timer e non conta come tick).

- **Dispel e pozioni**: con la fase del tick stabile, una fine fuori tempo (dispel) toglie il
  timer ma non sposta il tick e non insegna la durata. Le lettere del prompt avviano e chiudono
  i timer anche per gli effetti da pozione (sanctuary, fireshield…); il primo prompt dopo la
  connessione fa solo da riferimento.

- **Corretto**: i timer di `att` finivano un tick prima (un incantesimo con durata N scade al
  (N+1)-esimo tick, verificato con stone skin nei log); senza fase del tick il primo scatto si
  conta a mezzo tick. La fase del tick si ricava anche da due `att` ravvicinati in cui una durata
  è scesa. A zero il timer dice "a breve" finché l'incantesimo non finisce davvero (mirror images
  non scende di 1 a ogni tick: fa fede la lettera M del prompt).

- **Prompt con l'oro**: la regex predefinita legge `G29.640.568` (monete in tasca) e non richiede
  più `>>` alla fine (il prompt nuovo dell'utente non lo ha: prima non veniva riconosciuto). Con
  l'oro nel prompt si attiva l'allarme furto e le Statistiche mostrano oro in tasca e variazione.

### Mezzi di trasporto, porte e privacy (2026-11-13)
- **Privacy**: il nome utente mandato dall'accesso automatico (spesso un'email) non viene più
  scritto nel log di sessione, come già la password.
- Porta chiusa col testo reale (`La porta e' chiusa.`); nuovo evento `door` per le porte aperte
  o chiuse da te o da altri.
- Fermate della diligenza con righe rientrate; stanze dei mezzi con titolo `La diligenza: …` /
  `La mongolfiera: …` e campo `fermata`; stanze senza riga `Uscite:` (cestello) riconosciute.
- Fixture reale `trasporti_porte_reale.log`.

### Fase 2, passo 2 — interfaccia a pannelli (2026-11-13)
- Area a pannelli agganciabili con `dockview` 8: si trascinano le schede per affiancare,
  impilare o separare i pannelli. Layout salvato da solo in `layout.json`; più layout con nome,
  ripristino del predefinito, menu "Pannelli" per mostrare/nascondere i pannelli.
- Pannello **Stanza**: titolo, uscite con il nome delle stanze vicine e le porte chiuse, mob e
  oggetti, descrizione a richiesta.
- Pannello **Effetti**: effetti attivi dal prompt (in scadenza evidenziati), durate dall'ultimo
  `att`, tank e bersaglio.

### Fase 2, passo 1 — parser del testo di Nebbie (2026-11-13)
- `src/nebbie/parser/`: stanza (portata da mappa_automatica.xml: titolo, descrizione, uscite,
  uscite visibili, contenuti, look direzionali), passi falliti, fine del run, mob uccisi con
  `(xN)`, esperienza singola e di zona, monete raccolte, incantesimi lanciati e finiti,
  achievement, liste di equipaggiamento/inventario/contenitore, fermate di diligenza e
  mongolfiera. Eventi pubblicati sul bus della sessione.
- Formati del MUD in `src/nebbie/parser/formati.json` (dati, non codice).
- Prompt: la regex predefinita legge anche gli incantesimi attivi (`[STM]`) e la condizione di
  tank/bersaglio; i profili con la vecchia regex predefinita vengono aggiornati da soli.
- Fixture reali: `stanze_reali.log`, `combattimento_reale.log`, `eq_inv_reale.log`,
  `score_att_reale.log`.
- `score`: massimi HP/MP/MV (usati dalle barre prima di quelli del profilo), esperienza, monete,
  livelli, posizione. `att`: elenco degli incantesimi attivi con la durata residua. Funzionano
  anche con il testo incollato senza a capo.
- Lettere degli effetti nel prompt (`[FsTM]`): maiuscola attivo, minuscola in scadenza;
  T true sight, S sanctuary, F fireshield, M mirror images, A anti magic shell, D protezione
  dal drain, P polymorph, I invisibility (tabella in `flagPrompt.json`). Nello stato
  della sessione insieme a tank e bersaglio, pronte per i pannelli.

### Account e accesso automatico (2026-11-13)
- Server, porta, codifica e nome utente diventano l'**account**, comune a tutti i pg; i file
  dei profili della versione precedente vengono convertiti da soli.
- Password nel **Portachiavi** di macOS (crate `keyring`): mai nei file né nei log; il backend
  la legge solo per mandarla al server (`invia_password`).
- **Accesso automatico** con interruttore nella barra in alto: utente, password, scelta del pg
  dal menu, ogni passo scritto nell'output; si ferma se il server richiede il nome utente.
- L'editor si apre su "Account e accesso" finché l'account non è impostato; se il server
  chiede il nome utente con l'accesso automatico spento, l'output dice dove attivarlo; se il pg
  non è nel menu, il messaggio elenca i nomi presenti.
- Confermato dal log: Nebbie manda GA/EOR dopo il prompt.

### Correzioni (2026-11-13)
- Cronologia: freccia su ora va subito al comando precedente anche se nella riga c'è ancora
  il comando appena inviato; la ricerca per prefisso vale solo per il testo scritto dopo
  l'ultimo invio. In modalità password le frecce non mostrano la cronologia.
- Niente più sfondo grigio sotto il testo: lo sfondo nero ANSI (`ESC[40m`), che Nebbie
  manda su ogni riga, ora coincide con il fondo della finestra.

### Anticipato dalla Fase 3 (2026-11-13)
- Abbreviazioni degli incantesimi: le 74 voci dei pacchetti Mudlet (`mm`, `acid`, `di`,
  `pwk`…) in `src/nebbie/spells/incantesimi.json`; `acid drago` → `cast 'acid blast' drago`.
  Attivabili per profilo; l'eco mostra il comando espanso.

### Fase 1 — Nucleo giocabile (2026-11-13, chiusa: provata su Nebbie con due pg)
- Prima fixture reale (`fixtures/sessione_reale_prompt.log`) con test: prompt con colori e
  XP con i punti; protocollo aggiornato (accesso, righe vuote, avviso armatura).
- Il log di sessione dice se il server manda GA/EOR e quante righe parziali sono state
  consegnate col timeout.
- Backend: telnet (GA/EOR come fine prompt, ECHO per la password, rifiuto delle opzioni non
  supportate), UTF-8 con ripiego Latin-1, ANSI 16/256/truecolor, prompt senza `\n`
  consegnato dopo GA/EOR o 150 ms.
- Connessione TCP con timeout e keepalive, mai riconnessione automatica.
- Log di sessione con tempi in `<cartella dati>/logs/` (password mai registrate); replay di
  log o testo semplice con velocità regolabile (`--replay file --velocita n` o pulsante).
- `mock-server` locale: un blocco di log per ogni comando (`npm run mock -- file.log`).
- Profili di personaggio in `profili.json`, editor con prova della regex del prompt.
- Separatore del prompt (testo attaccato, prompt multipli, numeri con i punti).
- Output virtualizzato con blocco dello scorrimento; riga di comando con cronologia e
  ricerca per prefisso, `;`, `#n`, Tab, modalità password.
- Barre HP/MP/MV con massimo da prompt, profilo o stima.
- Fixture sintetiche dai testi documentati (in attesa di log reali).

### Documentazione
- Il client è agnostico rispetto al personaggio: nuova sezione "Profili di personaggio" nella
  specifica, principio in CLAUDE.md, profili in Fase 1 della roadmap. Rigel resta solo
  l'esempio da cui vengono prompt e log.

### Fase 0 — Fondamenta (2026-11-13)
- Progetto Tauri 2 (Rust 1.100) + Svelte 5 + TypeScript + Vite, avviabile con `npm run tauri dev`.
- Struttura cartelle `src-tauri/`, `src/core/`, `src/nebbie/`, `src/ui/`, `fixtures/`, `tools/`.
- Bus di eventi tipizzato in `src/core/eventBus.ts` con test Vitest.
- Comando backend di prova `versione_backend` con test `cargo test`.
- ESLint + Prettier (frontend), rustfmt + clippy (backend); `.gitignore` che esclude log,
  database, mappe esportate e lo screenshot di riferimento dell'altro giocatore.
- README con istruzioni di installazione su macOS.

### Pacchetto iniziale
- Pacchetto di istruzioni iniziale: CLAUDE.md, specifica, protocollo Nebbie, roadmap,
  esportatore mappa Mudlet, riferimenti ai pacchetti Mudlet.
- Lo screenshot in `riferimenti/` è di un altro giocatore: usato solo come idea di struttura.
  Tolti prompt, schede e dati di quel personaggio; gli esempi vengono da Rigel.
