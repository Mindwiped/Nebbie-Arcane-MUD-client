# Fixture

Qui vanno pezzi di log reali di Nebbie Arcane, usati dai test dei parser e dal replay.

Uno o più file per argomento, nomi parlanti, testo grezzo **con i codici colore** se possibile:

- `prompt.log`, `prompt_testo_attaccato.log`, `score.log`
- `stanza_normale.log`, `stanza_uscite_attaccate.log`, `stanza_porta_chiusa.log`
- `movimento_falliti.log`, `run.log`, `diligenza.log`, `mongolfiera.log`
- `eq_inv_forziere.log`, `fabbro.log`
- `combattimento_uccisione.log`, `incantesimi_fine.log`

In Mudlet: Impostazioni → Registrazione, attiva il log in formato testo (o HTML se serve
il colore), gioca la situazione, poi copia qui la parte utile.

## Fixture reali presenti

- `sessione_reale_prompt.log` — estratto di una sessione di Rigel (formato log del
  client, con codici colore): prompt, una stanza vista con `l`, testo di aiuto, avviso
  "armatura magica vacilla". Tolti login, lista dei pg dell'account e azioni di altri giocatori.
- `stanze_reali.log` — look, passi, run di tre stanze di fila, porte della citta' di Myst.
- `combattimento_reale.log` — chain lightning con righe `(x6)`, uccisione con raccolta delle
  monete, prompt con incantesimi attivi e tank/bersaglio, fine di mirror images.
- `eq_inv_reale.log` — equipaggiamento completo (22 slot) e vuoto, inventario con quantità.
- `score_att_reale.log` — comandi `score` e `att` (incantesimi attivi con durata).
- `trasporti_porte_reale.log` — mongolfiera (torre, cestello, primo scalo), diligenza (fermate fino a New Thalos), porte aperte/chiuse e porta chiusa.
