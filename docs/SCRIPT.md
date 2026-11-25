# Script utente

Gli script sono pezzi di JavaScript tuoi che reagiscono a quello che succede nel gioco.
Li trovi in **Automazioni… → Script…**.

- **+ Nuovo script** crea uno script con un esempio.
- **Prova** lo avvia subito, anche senza salvare.
- **Ferma** lo spegne.
- **parte da solo** lo accende a ogni avvio del client.
- **Salva** tiene le modifiche (in `script.json`) e riavvia gli script che partono da soli.

Da tastiera:
- `script` mostra quali script ci sono e se sono accesi.
- `script avvia <nome>` e `script ferma <nome>` li accendono e spengono.

## Sicurezza

Ogni script gira in un **Web Worker** isolato. Vede solo l'oggetto `nebbie`: non vede la
finestra, i file, il portachiavi né le password, e non può collegarsi a internet perché la
politica di sicurezza dell'app lo blocca.

Non ci sono automatismi nascosti. Ogni comando che uno script manda compare nell'output, così:
`⚙ Script <nome> → comando`.

Se uno script manda più di **40 comandi in 10 secondi**, il client lo ferma, per non inondare
il MUD. Un errore nello script compare nell'output, ma non lo ferma.

## API

| Funzione | Cosa fa |
|---|---|
| `nebbie.send(cmd, …)` | Manda uno o più comandi al MUD, come se li scrivessi: valgono `;`, alias e abbreviazioni. |
| `nebbie.echo(testo)` | Scrive una riga nell'output, senza mandarla al MUD. |
| `nebbie.onLine(pattern, (m, riga) => …)` | Su ogni riga del MUD. `pattern` è una RegExp (`m` sono i gruppi) o un testo da cercare nella riga. |
| `nebbie.onPrompt((stato) => …)` | A ogni prompt. |
| `nebbie.on(evento, (dati) => …)` | Su un evento del client (tabella sotto). |
| `nebbie.command('parola', (argomenti) => …)` | Un comando tuo: se scrivi `parola …` nella riga di comando, non va al MUD e lo gestisce lo script. |
| `nebbie.state` | Lo stato all'ultimo prompt. |
| `nebbie.after(ms, fn)` / `nebbie.every(ms, fn)` / `nebbie.cancel(id)` | Attesa e ripetizione. Ripetere ogni meno di 250 ms non è permesso. |

**Stato** (`nebbie.state` e l'argomento di `onPrompt`):
- `nome`: il tuo personaggio (dal prompt);
- punti vita, mana e movimento: `hp`, `hpMax`, `mp`, `mpMax`, `mv`, `mvMax`;
- `oro` e `stanza` (titolo);
- combattimento: `tank`, `bersaglio`, `inCombattimento`;
- `effetti`: incantesimi attivi, dalle lettere del prompt.

**Eventi**:

| Evento | Dati |
|---|---|
| `stanza` | `{ titolo, uscite, contenuti, guardata }` |
| `mobUcciso` | `{ nome }` |
| `combattimento` | `{ inizio }` (`true` all'inizio, `false` alla fine) |
| `aTerra` | `{ causa }`: `bash`, `disarm`, `finger` o `ancora` (stand non riuscito) |
| `incantesimoFinito` | `{ nome, avviso }` (`avviso` = sta per finire, "vacilla") |
| `messaggio` | `{ da, gruppo, testo }`: "ti dice" o "dice al gruppo" |

## Esempi

Una pozione quando gli HP scendono sotto un terzo, al massimo una ogni 10 secondi:

```js
let ultima = 0;
nebbie.onPrompt((s) => {
  if (s.hp < s.hpMax / 3 && Date.now() - ultima > 10000) {
    ultima = Date.now();
    nebbie.send('quaff rossa');
  }
});
```

Un comando `cura <nome>`:

```js
nebbie.command('cura', (chi) => nebbie.send("cast 'cure light' " + (chi || nebbie.state.nome)));
```

Rispondere a chi ti scrive mentre sei via:

```js
nebbie.on('messaggio', (m) => {
  if (!m.gruppo) nebbie.send(`tell ${m.da} sono AFK, ti rispondo appena torno`);
});
```
