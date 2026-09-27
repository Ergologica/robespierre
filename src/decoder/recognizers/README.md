# Come si scrive un riconoscitore

1. Una funzione pura `(tx) => Decoded | null`. Nessuna chiamata di rete.
2. Nel dubbio si restituisce `null`: una decodifica sbagliata è peggio di nessuna decodifica.
3. Ogni riconoscitore nasce con **almeno 3 fixture** in `../fixtures/`:
   il caso tipico, un caso limite, e un caso che NON deve riconoscere.
   Le fixture sono transazioni reali scaricate con `scripts/fetch-fixture.mjs`.
4. `confidence: 'certa'` solo per pattern strutturali inequivocabili
   (indirizzo di contratto noto + forma dei box). Tutto il resto è `'probabile'`.
5. Registrare il riconoscitore in `../index.ts`, dal più specifico al più generico.

In coda per la Fase 2: `spectrum-swap` (il codice di ricognizione DEX di ergo-bot
si porta qui quasi intatto), `sigmausd` (mint/redeem), `rosen-bridge` (in/out).

## Quali riconoscitori mancano

Non si indovina: lo dice la misura. `npm run coverage` scarica le transazioni degli ultimi
1.000 blocchi, le passa al decodificatore e mette in fila i contratti che restano muti,
raggruppati per modello di ErgoTree (lo stesso contratto con costanti diverse — la chiave
di chi ha fatto l'ordine, quella del minatore — conta una volta). Il prossimo
riconoscitore si sceglie dalla cima di quella classifica, in `data/coverage.json`.
