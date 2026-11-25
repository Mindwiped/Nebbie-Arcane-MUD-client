# Il testo di Nebbie Arcane — cosa sappiamo

Nebbie Arcane (nebbie.nebbie.it:4000) è un DikuMud/AlarMUD in italiano, con alcune zone in
inglese. **Non manda GMCP né MSDP**: ogni informazione si ricava dal testo.
Le voci segnate *da verificare* vanno confermate con un log reale prima di costruirci sopra.

## Prompt

Il prompt è configurabile dal giocatore (comando `prompt` del MUD): il client deve
accettare una regex a gruppi nominati per profilo, con tutti i campi opzionali.
Ogni personaggio può avere un prompt diverso: la regex sta nel profilo e **non deve contenere
il nome del pg** (se serve, lo cattura con un gruppo `nome`).

**Prompt attuale di Rigel** (dal 2026-11-13 pomeriggio, con l'oro e senza `>>` finale):
```
Rigel H539 M950 V257 X-134.368.570 G29.640.568 [TM] graffiato/tagliata
```
`G…` = monete in tasca. La regex predefinita accetta sia questo sia il formato precedente.

**Esempio precedente: prompt di Rigel**, uno dei pg dell'utente:
```
Rigel H481 M493 V247 X-28602993 [T] */*>>
```

| Pezzo | Significato |
|---|---|
| `Rigel` | nome del pg (cambia col personaggio) |
| `H481 M493 V247` | punti ferita, mana, movimento attuali (senza massimi) |
| `X-28602993` | non è l'esperienza al prossimo livello: in un log reale `X-134.366.565` = 400.000.000 − esperienza totale (534.366.565), cioè la soglia per donare xp mostrata da `score`. Quando X scende, l'esperienza sale della stessa quantità |
| `[T]` | effetti di incantesimi o protezioni attivi; **maiuscola = attivo, minuscola = in scadenza**; `[]` = nessuno. Dall'utente: `T` true sight, `S` sanctuary, `F` fireshield, `M` mirror images, `A` anti magic shell, `D` protezione/immunità dal drain, `P` polymorph, `I` invisibility. Tabella modificabile in `src/nebbie/prompt/flagPrompt.json` |
| `*/*` | condizione del tank / condizione del bersaglio, `*` = nessuno (log reali: `eccellente/graffiato`, `graffiato/squarciato`…) |

Regex usata oggi in Mudlet: `H-?\d+ M-?\d+ V(-?\d+) X`.

Il MUD permette prompt più ricchi (massimi, affetti, condizione di tank e bersaglio, oro):
per un pg con un prompt diverso basta un'altra regex nel suo profilo. I massimi
di HP/MP/MV, finché il prompt non li mostra, si ricavano dal comando `score` (*formato da
raccogliere*) o si impostano a mano.

**Confermato da un log reale** (2026-11-13, `fixtures/sessione_reale_prompt.log`):
- il prompt arriva senza `\n` finale e contiene codici colore (`[T]` in ciano chiaro, poi un
  reset `ESC[0;40;37m` dopo `>> `): il riconoscimento va fatto sul testo senza colori;
- l'esperienza può avere i punti delle migliaia: `X-132.726.485`;
- i messaggi che arrivano da soli (non in risposta a un comando) iniziano con una riga vuota
  dopo il prompt; il testo attaccato al prompt capita quindi con le risposte ai comandi;
- **il server manda GA/EOR dopo il prompt** (confermato dal log del 2026-11-13 delle 11:56):
  il prompt viene consegnato subito, senza aspettare il timeout.

**Testo attaccato al prompt**: spesso la riga successiva arriva sulla stessa riga del prompt
(`…>> Stai trasportando:`). Il separatore del prompt deve gestirlo sempre.

## Accesso

1. Banner, poi `Email o nome del personaggio su Nebbie Arcane? ` (senza a capo).
2. Codice di accesso (il server attiva l'eco lato server: input nascosto).
3. Menu `Scegli un personagggio` con i pg dell'account numerati e il prompt `>`.

## score

Una frase per riga (log reale in `fixtures/score_att_reale.log`):
```
Sei nato nel Giorno dei Martelli, 24^ del Mese dell'Inverno, nell'anno 853 dopo Nebbie.
Hai 539(539) hit, 930(950) mana e 135(259) movimento.        ← attuale(massimo)
Hai effettuato 534.366.565 exp, ed hai 29.640.568 monete d'oro.
Non puoi donare xp se hai meno di: 400.000.000 exp
Exp al prossimo livello: M:-103.366.565 K:-103.366.565
I tuoi livelli: M:51 K:51
Sei in piedi.
```
Il client usa i massimi di `score` per le barre (prima di quelli scritti nel profilo).

## att

Dopo età, peso, caratteristiche e bonus, la sezione degli incantesimi attivi:
```
Spells attivi:
--------------
Spell : 'detect invisibility' - 99
Spell : 'armor' - 4
```
Il numero è la durata residua in tick: l'incantesimo finisce quando scende sotto zero, cioè al
(N+1)-esimo tick dopo la lettura (stone skin `2` → scaduto 181 s dopo). Eccezione: mirror images
scende più lentamente degli altri (−9 contro −11 in 784 s), per lui fa fede la lettera `M` del
prompt. `La tua immagine illusoria vacilla per un attimo.` è un'immagine colpita, non una fine. Le righe `Stai trasportando 0
etti…` / `…oggetti su 39.` non sono l'intestazione dell'inventario (`Stai trasportando:`).

## Tick e rigenerazione

- **Tick ≈ 75 secondi**: le durate di `att` scendono di 1 ogni 70-77 s (log reali), come i
  tick dei DikuMud classici.
- **Rigenerazione ogni ~12 secondi**: HP/MP/MV salgono molto più spesso del tick, quindi i
  salti del prompt non servono a trovare il tick.
- Nebbie **non segnala il tick** (confermato dall'utente). Si ricava dalle scadenze degli
  incantesimi, che cadono sul tick: nei log 374,9 s tra due scadenze = 5,00 tick, 150,0 s tra
  "vacilla" e "si dissolve" = 2,00 tick.
- `La tua immagine illusoria svanisce.` **non è una scadenza**: è un'immagine di mirror images
  distrutta da un colpo, arriva in qualunque momento del combattimento.

## Stanza

Ordine dei blocchi:

1. titolo
2. descrizione (più righe)
3. `Uscite: Nord Est …` — **a volte attaccata all'ultima riga della descrizione**
4. mob e oggetti presenti
5. `-----------------`
6. `Uscite visibili:` seguito da righe `Dir - Nome stanza`
7. `-----------------`

Note:
- Autoexits è attivo.
- `look` **non** mostra le "Uscite visibili".
- Le porte chiuse **mancano** da `Uscite:` ma **compaiono** nelle "Uscite visibili".
- Look direzionali (`look nord`) non vanno scambiati per un cambio di stanza.

**Uscite: riga propria o attaccata.** Nei log reali del 2026-11-13 (170 stanze) `Uscite:` è
sempre su una riga sua; il caso "attaccata all'ultima riga della descrizione" viene comunque
gestito come nel mapper Mudlet.

**Mob e oggetti** tra `Uscite:` e il separatore: `Una guardia scelta [6]` (numero = quanti),
`*Nome…` (asterisco iniziale, significato *da verificare*), righe di stato come
`… brilla di luce propria!`.

**Run**: le stanze attraversate arrivano di fila, senza prompt in mezzo; ognuna si chiude con
il separatore dopo le "Uscite visibili".

## Movimento

| Situazione | Testo |
|---|---|
| Passo impossibile | `Non puoi andare da quella parte...` |
| Porta chiusa | `La porta e' chiusa.` (log reale; il documento originale diceva `La door/gate/doorway e' chiusa.`) |
| Fine di un run | `Mi spiace, ma non riesci a correre ulteriormente.` |

Il comando `run` seguito da una direzione percorre più stanze in un colpo.

**Porte** (log reali): `Apri una porta.` / `Chiudi una porta.` (tu), `Il Califfo di New Thalos
apre una porta.` (altri), `La porta e' aperta dall'altro lato.`, `Prima devi chiudere la
porta.` (lock su porta aperta), `E' gia' aperta!`, `Non vedi porte ad ovest.`

## Mezzi di trasporto

**Diligenza** — a ogni fermata, senza titolo di stanza (log reale: righe rientrate con spazi e
tab, seguite da `Uscite: Basso`; con `look` il titolo è `La diligenza: <fermata>`):
```
   Ci siamo fermati presso la Contea.
	Per scendere qui, andare verso il basso.
	Prossima fermata: Mordilnia.
Uscite: Basso
```
Fermate viste: l'area di carico di Myst → la Contea → Mordilnia → New Thalos → BofGorRak.

**Mongolfiera** (dalla cima della torre sbilenca, log reale): il cestello (`dentro il cestello
della Mongolfiera`) non ha la riga `Uscite:` ma solo `Uscite visibili:` / `Nessuna!`; durante il
volo arrivano frasi descrittive; allo scalo `Primo scalo!!! Citta' di Imrryr e foresta incantata,
scenda chi lo desidera…` seguito da `Uscite: Basso`.
`Primo scalo!!! …`, `Secondo attracco: …`, `Terzo attracco: …`, `…giunti al capolinea…`.
Nome della zona capolinea ancora provvisorio: "Grecia (capolinea)".

## Teletrasporti

| Esito doorway | Testo |
|---|---|
| Riuscito | `You close your eyes and open a portal and quickly step through.` |
| Fallito | `You cannot open a portal at this time.` |
| Bersaglio assente | `You can't sense that person anywhere.` |

## Combattimento e uccisioni

**Righe ripetute**: il MUD raggruppa le righe uguali con ` (xN)` in fondo
(`Il tuo sangue si gela al grido di morte di una guardia scelta. (x6)` = sei uccisioni).
Esperienza di un attacco ad area: `Hai ucciso 7 nemici e guadagnato 10.200 punti esperienza.`

- Morte di un mob: `Il tuo sangue si gela al grido di morte di X.`
- Esperienza: `La tua esperienza e' aumentata di 411.508 punti.`
- Raccolta oro: `Prendi gold coins da a pile of dust and bones.` / `C'erano 309.364 monete.`
- Atterrato: `… ti manda a gambe all'aria.` (apostrofo dritto o tipografico, a volte seguito da `[n]`)
- Disarmo fallito: `Provi a disarmare X, ma fallisci miseramente.`
- Danni tra parentesi quadre a fine riga, es. `[390]`, `[44]`.
- Achievement: `Skill Achievement #147 'Punitore' 2640/10000.`, `Race Achievement …`,
  `Other Achievement …`.

## Fine degli incantesimi (per il rinnovo)

```
La tua pelle torna normale.                                   → stone skin
Il globo protettivo attorno al tuo corpo si dissolve.          → minor invulnerability
Il globo protettivo attorno al tuo corpo brilla e si dissolve improvvisamente.  → major
La tua armatura magica si dissolve.                            → armor
Il tuo scudo magico si dissolve.                               → shield
Non ti senti piu' cosi' forte.                                 → strength
Non voli piu'. / Torni dolcemente a terra, la tua capacita' di volare svanisce. → fly
```
Avviso prima della fine (log reale): `La tua armatura magica vacilla.`

Accenti alternati: `ù`/`u'`, `ì`/`i'`, `à`/`a'`; `Il`/`II` (refuso del MUD) nel globo.

Lancio: `Pronunci le parole, '<incantesimo>'.` seguito dal messaggio d'effetto
(*da raccogliere* per gli incantesimi usati dai pg dell'utente).

## Liste

| Lista | Intestazione |
|---|---|
| Equipaggiamento | `Stai usando:` |
| Inventario | `Stai trasportando:` |
| Contenitore | `… (usa) :` oppure `… (trasporta) :` |

Righe: `[ n] <slot> Nome (in … condizioni)`, con quantità `[2]` in coda per gli oggetti multipli.
Log reali: lo slot è allineato in colonna (`[ 2] <sul dito destro>       Un Anello…`), le note
sono tra parentesi (`(ha un alone luminoso)`, `(invisibile)`), la quantità è attaccata senza
spazio (`(ha un alone luminoso)[11]`); equipaggiamento vuoto: ` Nulla.`. La lista finisce con
una riga vuota. Contenitori (`(usa) :` / `(trasporta) :`) *da verificare* con un log.
Regex Mudlet per l'eq: `^\[\s*(\d+)\] <([^>]+)>\s+(.+)$`.
Le intestazioni possono arrivare attaccate al prompt.

## Vestirsi e spostare oggetti (log reali del 2026-11-13)

| Gesto | Risposta |
|---|---|
| `remove x` | `Smetti di usare <nome>.` |
| `wear x` | `Indossi <nome> su un dito della mano destra.` · `Indossi <nome> sulle gambe.` · `Indossi <nome>.` (corpo) · `Ti metti <nome> in testa / ai piedi / intorno al collo / sulle spalle.` · `Metti <nome> sulle mani.` · `Usi <nome>.` (scudo) · `Ti avvolgi con <nome>.` (mantello) · `Prendi <nome> in mano.` (oggetto tenuto) |
| `hold x` | `Prendi <nome> in mano.`; errori: `Stai gia' usando una sorgente di luce.`, `Stai gia' usando qualcosa.`, `Non ti sembra che <nome> illumini molto.` |
| `get x c` | `Prendi <nome> da <contenitore>.` (più pezzi: ` (x3)` in fondo) |
| `put x c` | `Metti <nome> in <contenitore>.` |
| `drop x` | `Posi <nome>.` |
| errori | `Non sembra che tu abbia un '2.ane'.`, `Non vedi nessun compendium.`, `Non lo vedi qui intorno.` |

- Lo slot nei messaggi ("su un dito della mano destra") non è quello delle liste ("sul dito
  destro"): lo slot vero lo dà solo `eq`.
- Con due oggetti dalla stessa parola chiave, `remove` ne sceglie uno da solo e `2.x` non
  funziona: il client li toglie tutti e rimette quelli che restano.
- `exa` di un contenitore indossato non mostra il contenuto: va tolto prima.

## Monete per terra (2026-11-14)

- `drop 1 coin` → `Posi una moneta.`
- Per terra: una moneta = `One miserable gold coin.`; più monete posate una alla volta =
  `[ 1] One miserable gold coin.[N]` (N esatto, provato fino a 100). Un drop di più monete
  insieme diventa `A pile of gold coins.`, senza numero.

## Fabbro

- Presenza: `un fabbro molto esperto` nella stanza.
- Riparazione: `give <oggetto> fabbro`.
- Il prefisso `2.` **non** funziona con `remove` dall'equipaggiamento: per gli oggetti doppi
  la sequenza è remove, give, remove, give, wear, wear.

## Varie

- Messaggi in inglese misti all'italiano (`You hear squeaking noises nearby`,
  `Your lore aids your attack!`, `… is stunned, but will probably regain consciousness again.`).
- Il banner di login contiene apici inversi: attenzione ai trigger troppo larghi.
