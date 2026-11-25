# Fixture sintetiche

**Non sono log reali.** Sono montate a mano usando solo i testi già documentati in
`docs/PROTOCOLLO_NEBBIE.md`, per avere qualcosa su cui far girare test e mock-server
finché non arrivano i log veri. I colori ANSI e i nomi di stanze/mob sono di fantasia.

Quando ci sono log reali sugli stessi argomenti, vanno aggiunti accanto (in `fixtures/`)
e i test devono usare anche quelli. Se un log reale contraddice una fixture sintetica,
ha ragione il log reale: si corregge la fixture.

- `prompt_testo_attaccato.log` — prompt con testo attaccato, prompt multipli sulla stessa
  riga, due personaggi diversi (il client non deve dipendere dal pg).
- `sessione_mock.log` — piccola sessione da usare con il mock-server:
  `npm run mock -- fixtures/sintetici/sessione_mock.log`
