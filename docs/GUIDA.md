# Guida ai pannelli

Come si usa Nebbie Client, pannello per pannello. Per installarlo e farlo partire la prima
volta vedi il [README](../README.md); per creare l'app firmata vedi [PACCHETTO.md](PACCHETTO.md).

I comandi che cominciano con `eqset`, `vai`, `rec`, `mantieni`, `regole`, `mappa`, `percorsi`
li legge il client e non arrivano al MUD.

## Primo collegamento

1. **Account**: in *Profili… → Account e accesso* imposta server (`nebbie.nebbie.it`, porta
   `4000`), nome dell'account e codice di accesso. Il codice finisce nel Portachiavi di macOS,
   mai nei file del client. Al primo uso macOS chiede il permesso: scegli "Consenti sempre".
   Con *Accesso automatico* il client entra da solo e sceglie dal menu il pg del profilo.
2. **Profili**: al primo avvio si apre l'editor. Crea un profilo per ogni personaggio, con il
   nome come appare nel menu di accesso, la regex del prompt, i massimi di HP/MP/MV se il prompt
   non li mostra, le abbreviazioni degli incantesimi e il log. Il campo "Prova la regex" dice
   subito cosa legge da una riga di prompt.
3. **Collega**: scegli il personaggio in alto e premi *Collega*. Il client non si ricollega mai
   da solo.

## Riga di comando

Invio manda (il testo resta selezionato), `;` separa i comandi, `#3 nord` ripete. Le frecce su e
giù scorrono i comandi già mandati; se hai scritto qualcosa, mostrano solo quelli che
cominciano così. Tab completa con le parole viste nell'output, Esc svuota, PagSu e PagGiù
scorrono l'output.

Le abbreviazioni degli incantesimi (`mm`, `acid drago`, `di rig`…) diventano `cast '…'` se sono
attive nel profilo, e l'eco mostra cosa è partito davvero. Quando il server chiede la password
il testo viene nascosto e non finisce né in cronologia né nel log.

## Disporre i pannelli

Ogni pannello si sposta trascinando la scheda: accanto, sopra, sotto o nello stesso gruppo. Dal
menu *Pannelli* si mostrano e si nascondono, si salvano layout con un nome (per esempio
"caccia") e si torna a quello predefinito.

A destra delle schede di ogni gruppo ci sono tre comandi:
- `⇩` impila il pannello sotto un altro, o lo mette come sua scheda, senza trascinare;
- `↕` adatta l'altezza del gruppo al contenuto;
- `A` la tiene adattata quando il contenuto cambia (resta salvato col layout).

Così i pannelli piccoli come Effetti e Statistiche occupano solo lo spazio che serve.

## Output

Il testo del MUD con i suoi colori, con lo sfondo rosso o verde sulle righe delle cadute. Gli
avvisi con suono e notifica si scelgono in *Impostazioni*, dove ci sono anche i
temi Scuro, Nero e Chiaro.

## Stanza

Titolo, uscite e cosa c'è nella stanza dove sei, letti dal testo del MUD.

## Effetti

Gli incantesimi attivi con il tempo che resta. Per ognuno:
- il pulsante di rilancio manuale lo lancia subito;
- l'interruttore accanto accende o spegne il rilancio automatico solo per quell'incantesimo,
  senza toglierlo dalla lista di Mantieni attivi.

## Statistiche

Uccisioni, esperienza e oro della sessione, con le ultime azioni.

## Automatismi

**Mantieni attivi** rilancia un incantesimo quando finisce. Non lo fa mai in combattimento e
aspetta la fine del loot. Da riga di comando:
- `mantieni` mostra la lista;
- `mantieni <incantesimo> [bersaglio]` aggiunge;
- `mantieni via <incantesimo>` toglie;
- `mantieni on|off` accende o spegne tutto.

**Regole** sono azioni legate allo stato del pg (`regole`, `regole on|off`), tra cui la
divisione dell'oro preso da un cadavere con il gruppo. Il fabbro ha un interruttore nella barra
in alto.

## Automazioni

Dal pulsante *Automazioni…* si creano alias (per esempio `kk (\w+)` → `kill $1;bash $1`) e
trigger (testo o regex sulle righe del MUD che mandano comandi, colorano o nascondono la riga).
Stanno in gruppi, validi per tutti i personaggi o per uno solo. Un gruppo con "Interruttore in
alto" diventa un pulsante ON/OFF sotto la barra. Per le cose più complicate ci sono gli script
in JavaScript: vedi [SCRIPT.md](SCRIPT.md).

## Pulsanti

La barra sopra HP/MP/MV (✎ per modificarla) ha pulsanti con un comando, un colore e una
scorciatoia (F1-F12, ⌥1-⌥0) che funziona anche mentre scrivi.

## Percorsi

I percorsi del pacchetto e i tuoi: doppio clic per partire, e nel dettaglio Prova, Inverti,
Modifica e Duplica. Da riga di comando:
- `percorsi`, `percorsi <zona>`;
- `vai <nome|numero>`, `vai prova <nome>`;
- `vai stop|pausa|riprendi|salta|chiudi`.

Per registrarne uno: `rec`, cammina, `rec fine <nome>` (ci sono anche `rec annulla`, `pausa`,
`riprendi` e `scarta`). Esc sulla riga vuota ferma tutto.

## Mappa

Si disegna da sola mentre cammini, con l'interruttore MAPPER acceso. Clic su una stanza per
"Vai qui". Ci sono la ricerca, lo zoom, la scelta della zona e gli strumenti per unire due
stanze uguali, spostare isole e aggiungere note. Da riga di comando: `mappa`,
`mappa pausa|riprendi`, `mappa sono <n>`, `mappa vai <n>`, `mappa zona <nome>`,
`mappa reset conferma`.

## Equipaggiamento

Set di equipaggiamento, cosa hai addosso, inventario e contenitori. Dal pannello si salva come
set quello che indossi, e lo si indossa, prova o elimina; un singolo pezzo si toglie da un set
con ✕.

Il cambio di set toglie i pezzi, li mette ognuno nel suo contenitore e indossa quelli nuovi.
Dove va un pezzo dipende dall'oggetto e non dal set. Da riga di comando:

| Comando | Cosa fa |
|---|---|
| `eqset <set>` / `eqset prova <set>` | cambia set / mostra i comandi senza mandarli |
| `eqset salva <nome>`, `eqset elimina <set>`, `eqset mostra <set>` | gestisce i set |
| `eqset chiave <parola> = <nome>` | parola chiave di un oggetto |
| `eqset usa wear\|hold\|wield = <nome>` | come si indossa |
| `eqset posto <contenitore>\|inv = <nome>` | dove va quando lo togli |
| `eqset destinazione <contenitore>\|inv` | dove vanno i pezzi senza un posto |
| `eqset contenitore <parola> indossato\|inventario [togli]` | contenitore addosso o in inventario |
| `eqset contenitore <parola> dentro <altro>` | contenitore dentro un altro |
| `eqset riordina [prova]`, `eqset chiavi` | rimette ogni pezzo al suo posto, cerca parole doppie |
| `ripara`, `ripara auto on\|off`, `fabbro si\|no` | riparazione dal fabbro |

`eqset aiuto` mostra tutto.

## Reliquiario

Il database degli oggetti identificati. Si attiva scegliendo la cartella in *Impostazioni →
Reliquiario*: da lì in poi ogni `identify` aggiorna `identi.js` nello stesso formato della
pagina `identi.html`. La vista Mob mostra il bestiario (`mob.js`) con livello, immunità,
equipaggiamento e zona di nascita, e un pulsante per camminare fin lì.

## Log e replay

Le sessioni si salvano, se è attivo nel profilo, in
`~/Library/Application Support/io.github.mindwiped.nebbie-client/logs/`; le ultime cinque
restano in chiaro, le altre vengono compresse. Con *Replay log…* si rivede una sessione senza
collegarsi.
