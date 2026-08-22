# Robespierre — l'explorer che interpreta

Front-end per la blockchain **Ergo**. Gli altri explorer elencano dati; Robespierre li spiega.
Il nome viene dal soprannome storico — *l'Incorruttibile* — che è anche la regola del progetto:
il decodificatore **tace piuttosto che indovinare**, e ogni etichetta cita una fonte.

Prototipo in Fase 1 del piano operativo (vedi il progetto "Ergo" su claude.ai).

## Avvio

```bash
npm install
npm run dev       # sviluppo su http://localhost:5173
npm test          # vitest: conversioni e decodificatore su fixture reali
npm run build     # typecheck + build statica in dist/
```

Il sito è statico: si pubblica su GitHub Pages con la Action inclusa
(`.github/workflows/deploy.yml`) o su qualunque hosting di file.

## Architettura

```
src/
  lib/format.ts        conversioni: BigInt ovunque (mai Number sugli importi grezzi)
  api/explorer.ts      client Explorer API: failover su più basi, cache con TTL
  decoder/             il cuore del progetto
    index.ts           motore: prova i riconoscitori dal più specifico al più generico
    recognizers/       uno per protocollo — vedi recognizers/README.md per contribuire
    fixtures/          transazioni REALI scaricate dalla mainnet: i test girano su queste
  views/               una vista per pagina; escape obbligatorio su ogni dato di catena
  labels.json          address book aperto: ogni etichetta cita una fonte pubblica
```

## Regole non negoziabili

1. **Il decodificatore tace nel dubbio.** Una decodifica sbagliata è peggio di nessuna.
2. **BigInt sugli importi grezzi**, sempre: alcuni superano 2^53.
3. **Mai `innerHTML` su dati di catena** senza `esc()`: nomi e descrizioni dei token sono input ostile.
4. **Ogni riconoscitore nasce con 3 fixture reali**: tipico, limite, e uno che NON deve riconoscere.
   (La regola ha già pagato: l'indirizzo del contratto fee scritto "a memoria" aveva un carattere
   sbagliato — l'ha scoperto la fixture, non un occhio umano.)
5. **Etichette**: fonte pubblica citata; indirizzi personali con nomi di persona, mai.
6. Ogni dato precalcolato mostra la propria età ("aggiornato N ore fa").

## Stato — Fase 0 e 1

- [x] CORS aperto su `api.ergoplatform.com` e `api.spectrum.fi` (verificato 22/08/2026 da origine terza)
- [x] mempool completa via endpoint v0 `/transactions/unconfirmed` (CORS aperto)
- [x] 8 richieste sequenziali senza throttling (~150 ms l'una)
- [x] pagine dal vivo: rete, transazione, indirizzo (paginata), token
- [x] motore del decodificatore + riconoscitore `simple-transfer` con 3 fixture
- [x] raccolta prezzi giornaliera (Action) — parte ora perché serve alla Fase 4
- [x] **Fase 2**: riconoscitori `sigmausd` (mint/riscatto via Bank NFT), `spectrum-n2t`
      (swap/deposito/ritiro via ΔLP del pool), `rosen-bridge` (arrivi dal hot wallet) —
      costanti dei contratti derivate dalla catena, 8 fixture reali, 23 test + 7 dal vivo
- [ ] Fase 2.1: pool T2T di Spectrum (token↔token), lock verso Rosen, mint SigUSD in fixture
      appena la banca ne emette una (il riconoscitore è già simmetrico)
- [x] **Fase 3**: pagella del token (v2) + pagina `/protocolli` — riserva SigmaUSD letta
      dal box col Bank NFT, circolante = emissione − banca, tasso di riserva indicativo
      dichiarato come tale (prezzo di mercato, non oracolo), fondi hot wallet Rosen
- [x] **Fase 3.1**: oracolo ERG/USD letto dal box in catena (NFT derivato dai dataInput
      di una tx reale della banca): tasso ufficiale accanto a quello di mercato
- [ ] **Lancio**: post a forum/Telegram con tre link e la domanda "lo usereste, per cosa?"

## Palette

Blu `#3987e5/#2a78d6` (accento, serie 1) · Verde `#0ca30c/#008300` (entrate, serie 2)
· Magenta `#d55181/#c2417f` (serie 3) · Rosso solo per le uscite/negativi.
Validata per daltonismo e contrasto in entrambi i temi su tutte le coppie
(ΔE CVD ≥ 9,9; visione piena ≥ 25,6; contrasto ≥ 3:1). Il viola scuro era stato
scartato dal validatore: ΔE 1,9 dal blu sotto protanopia. Icone SVG originali
in `src/icons.ts` (tratto 1,8, griglia 24).
