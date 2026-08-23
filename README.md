# Robespierre — l'explorer che interpreta

Front-end per la blockchain **Ergo**. Gli altri explorer elencano dati; Robespierre li spiega.
Il nome viene dal soprannome storico — *l'Incorruttibile* — che è anche la regola del progetto:
il decodificatore **tace piuttosto che indovinare**, e ogni etichetta cita una fonte.

Prototipo con Fasi 0–3.1 complete più il pacchetto pre-lancio (piano operativo nel progetto "Ergo" su claude.ai). Sito: https://ergologica.github.io/robespierre/

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
7. **Una scrittura asincrona nel DOM deve dimostrare di essere ancora la pagina
   corrente** (`lib/nav.ts`). Trovato riproducendo il difetto: con l'URL su
   `#/token/B` si vedeva il contenuto di A, e i dati notturni di A comparivano
   sotto la pagella di B. Mostrare il dato di un altro con sicurezza è il
   peggiore dei difetti per un explorer che promette di non indovinare.
8. **Un solo prezzo per token in tutto il sito** (`lib/prices.ts`): prima Mercati
   e wallet ne mostravano due diversi. E ogni prezzo dichiara da dove viene:
   pool sottile (< 100 ERG di volume storico) e nome condiviso con altri token.

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
- [x] **Pacchetto pre-lancio**: bilingue IT/EN (`src/i18n.ts`, italiano lingua sorgente e
      inglese tipato su di esso: una chiave mancante non compila; separatori numerici e
      tempi relativi seguono la lingua) · ricerca token per nome con risultati in linea ·
      pagina del blocco (`#/block/altezza-o-id`, navigazione ‹ › tra blocchi) · filtri
      Ricevuti/Inviati sui movimenti (dichiarati: valgono sulla pagina corrente) ·
      avviso storage rent (unicità di Ergo: box fermi da 4 anni; controllo dichiarato
      sui primi 300 box) · immagine EIP-4 dal box di conio, caricata SOLO su richiesta
      esplicita (R7=0101, R9→URL, solo https; ipfs→gateway) · riprova negli errori ·
      tabelle scorrevoli su mobile
- [x] **Movimenti interpretati (v5)**: ogni riga mostra la cosa più grande che si è mossa
      (token col nome quando l'ERG è ~0), tag di protocollo al posto dell'indirizzo del contratto
- [x] **Mercati + lista token + F4 (v6)**: #/mercati (prezzi Spectrum col volume 24h reale,
      ERG da CoinGecko), #/tokens (tutti i token, paginati), prezzo/valore nel wallet,
      export CSV con controvalore alla data (tetto e approssimazioni dichiarati nel file),
      job dati (holders notturno, protocolli ogni 6h) letti da raw.githubusercontent
- [x] **Valore totale del wallet**: ERG + token con prezzo, in $ — con i token
      senza prezzo dichiarati ed ESCLUSI dalla somma (non valgono zero: non si sanno)
- [ ] **Lancio**: post a forum/Telegram con tre link e la domanda "lo usereste, per cosa?"

## Sistema visivo

**Caratteri.** IBM Plex Sans (variabile) e IBM Plex Mono, ospitati in `src/fonts/`
— nessuna richiesta a terzi, coerente con la promessa "nessun tracciamento".
Plex perché metà di questo sito sono indirizzi e hash: il mono è disegnato
insieme al sans, non accostato a caso. Con `system-ui` il peso 650 usato prima
era una scommessa diversa su ogni sistema operativo.

**Scala tipografica — sette gradini** (`--fs-display` 28 · `--fs-xl` 22 ·
`--fs-lg` 17 · `--fs-md` 15 · `--fs-sm` 13 · `--fs-xs` 12 · `--fs-2xs` 11).
Prima erano quattordici misure decise una alla volta, coi mezzi pixel
(12,5 · 13,5 · 15,5 · 16,5): non una scala, un mucchio. **Tre pesi** invece di
cinque. **Spazi su base 4** (`--sp-1`…`--sp-6`) invece di quattordici valori
a occhio. Nessuna misura di carattere vive più dentro un `style=` nelle viste:
i ruoli hanno un nome (`.t-title`, `.t-sub`, `.t-note`, `.t-cap`, `.t-micro`).

**Una sola lingua di etichette**: le etichette delle tessere e le intestazioni
di tabella usano lo stesso trattamento (maiuscoletto 11 px, spaziatura .075em,
colore terziario). **Cifre tabellari ovunque** (`tabular-nums`): in un explorer
le colonne di importi devono incolonnarsi davvero.

**Impaginazione.** Corpo a colonna piena: il piè di pagina resta in fondo anche
sulle pagine corte (prima restavano 227 px di vuoto sotto). Stacco fra schede
(24 px) ≥ padding interno, mai il contrario. I grafici si **ridisegnano** alla
larghezza della scheda invece di essere stirati: stirare un SVG con viewBox
ingrandisce anche il testo, e prima metà scheda restava vuota. Le tacche delle
scale usano passi 1·2·5 (`niceScale`), non il massimo diviso cinque.

**Contrasto verificato**, non dichiarato: ogni ruolo di testo ≥ 4,5:1 sul
proprio fondo in entrambi i temi. Tre valori sono stati corretti perché non
passavano — `--text-3` in entrambi i temi e un `--link` più scuro per il testo
nel tema chiaro (l'accento delle serie resta quello validato per il daltonismo).
**Fuoco da tastiera** visibile su ogni comando: prima non esisteva alcuno stile.

## Palette

Blu `#3987e5/#2a78d6` (accento, serie 1) · Verde `#0ca30c/#008300` (entrate, serie 2)
· Magenta `#d55181/#c2417f` (serie 3) · Rosso solo per le uscite/negativi.
Validata per daltonismo e contrasto in entrambi i temi su tutte le coppie
(ΔE CVD ≥ 9,9; visione piena ≥ 25,6; contrasto ≥ 3:1). Il viola scuro era stato
scartato dal validatore: ΔE 1,9 dal blu sotto protanopia. Icone SVG originali
in `src/icons.ts` (tratto 1,8, griglia 24).
