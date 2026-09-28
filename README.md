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
npm run check:ui  # dopo build: nessun testo fuori dai grafici, nessuno scroll di lato (11 pagine × 2 temi × 2 larghezze)
                  # (una volta sola: npm i -D playwright && npx playwright install chromium)
LIVE=1 npx vitest run src/live   # verifica contro la mainnet (serve rete)
npm run coverage  # quante tx degli ultimi 1.000 blocchi il decodificatore spiega → data/coverage.json
node scripts/api-compat.mjs      # API ufficiale contro sigmaspace, endpoint per endpoint
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
    explain.ts         «come lo sappiamo»: su cosa si regge ogni lettura, e su quante fixture
    recognizers/       uno per protocollo — vedi recognizers/README.md per contribuire
    fixtures/          transazioni REALI scaricate dalla mainnet: i test girano su queste
  stake/               staking dei DAO Paideia: paideia.ts (pure) + index.ts (catena) + card.ts
  lib/movement.ts      chi ha dato cosa a chi, per differenza: il libro mastro della transazione
  lib/feed.ts          il flusso della home, parti pure: categorie, pre-selezione, titolo dalla misura
  views/               una vista per pagina; escape obbligatorio su ogni dato di catena
    feed.ts            «Adesso sulla catena»: ultimi 10 blocchi, dal vivo
    palette.ts         la ricerca: dice cosa ha riconosciuto prima di andarci
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
9. **Quando un dato non si può leggere, si dichiara** invece di stimarlo. Lo
   staking Paideia tiene le quote in un albero autenticato (`Coll[AvlTree]`):
   il saldo di oggi con le ricompense NON è leggibile, e il sito lo dice al
   posto di inventare un numero verosimile. E una variazione si attribuisce a
   una chiave solo quando la chiave **nasce o muore** in quella transazione,
   o quando nessun'altra chiave dello stesso DAO è in ballo: il box che paga
   una transazione di staking contiene spesso decine di NFT, comprese le
   chiavi di altri DAO. Scrivere sotto il nome di uno l'importo di un altro
   sarebbe il modo più rapido di bruciare la fiducia.
10. **Un testo dentro un grafico non esce mai dal riquadro** (`fit()` in
   `charts.ts`, misurato con `getComputedTextLength()` dopo l'inserimento).
   Nasce da un difetto vero: nella ciambella «61,6%» usciva a sinistra e si
   leggeva «1,6%» — un numero sbagliato, non un problema estetico.
   `npm run check:ui` lo verifica su 11 pagine × 2 temi × 2 larghezze.
11. **Nessuna frase scritta a mano su un numero che cambia.** Il titolo della home
   («Quasi due transazioni su tre, spiegate in una riga») si calcola dalla copertura
   misurata ogni domenica (`fractionOf` in `lib/feed.ts`): la frazione più semplice
   entro 2 punti, e «quasi» quando il vero sta sotto — 66,4% non è «due su tre».
   Lo stesso per «verificato su N transazioni reali»: `explain.test.ts` decodifica le
   fixture e fallisce se il numero dichiarato non è quello vero. La proposta grafica
   prometteva 3 fixture per Rosen; sono 1, e la pagina dice 1.

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
- [x] **Staking Paideia nel wallet (v11)**: la chiave di staking porta al box di
      stato del DAO — contratto, token di stato e token depositato ricavati DALLA
      TRANSAZIONE di ingresso, nessuna costante scritta a mano. Riconosciute
      **entrambe le generazioni** di chiavi: «<DAO> Membership» (descrizione con
      la firma completa) e «<DAO> Stake Key» (descrizione «Powered by Paideia»,
      col nome del DAO solo nel nome del token — è la più vecchia, Sigmanauts
      2024, Walrus DAO, RosenGuards). La scheda mostra depositato, totale nel
      pool e partecipanti; il saldo di oggi con le ricompense è **dichiarato
      illeggibile** (AvlTree) e la posizione resta FUORI dal valore totale.
      Chi ha ritirato tutto tiene la chiave ma non ha una posizione: non compare
      nessuna scheda. Verificato dal vivo su quattro DAO
- [x] **Copertura misurata (27/09/2026)** — `npm run coverage`, ripetuta ogni domenica dalla
      Action `coverage.yml` e mostrata in home con DUE numeri: sul totale, e escluse mining e
      oracoli (che sono quasi l'80% del traffico e da soli gonfierebbero il primo). Prima misura
      6,7%; con i riconoscitori `oracle` (pool v1 di SigmaUSD, pool v2 USD e oro) e `mining`
      (emissione, commissioni, incasso delle ricompense, ri-emissione EIP-27): **85,1% del
      totale, 30,7% escluse mining e oracoli**. Il prezzo dell'oro non si mostra: l'unità del
      registro non è stata verificata
- [x] **Wallet e commissioni (27/09/2026)** — i trasferimenti dicono COSA arriva (prima i
      token, coi loro decimali; l'ERG solo se non è il minimo del box: prima si leggeva
      «0 ERG» mentre partivano 2.000 token), più destinatari, movimenti interni
      (consolidamenti, token bruciati), commissione pura (dai contratti conta fra il mining,
      da un wallet no). Un token nuovo negli output è un conio: il trasferimento tace.
      Copertura: **93,8% del totale, 66,4% escluse mining e oracoli**
- [x] **Fonte di riserva (27/09/2026)** — se l'Explorer API non risponde (rete, 5xx, 429,
      15 s) transazioni, box, token, movimenti di un indirizzo e `/info` arrivano da
      sigmaspace, adattati (registri ricostruiti da `serializedValue`) e dichiarati in pagina;
      lo stato speso/non speso degli output diventa «stato non noto». Guardie sulle due
      trappole misurate: la transazione finta tutta a zero e l'errore dentro un 200.
      Saldo, blocchi e ricerca non hanno riserva (`src/api/fallback.ts`, `node scripts/api-compat.mjs`)
- [x] **Deploy solo quando serve** — i commit dei job in `data/` non ricostruiscono più il sito
      (`paths-ignore`): il sito li legge da raw.githubusercontent
- [x] **Rinnovo «Cronaca» (27/09/2026)** — la frase decodificata diventa il prodotto.
      **Home**: apre con la copertura misurata e il flusso delle transazioni degli ultimi
      10 blocchi, dette in una riga, con filtri per tipo; mining e oracoli nascosti (e
      dichiarati) finché non si chiedono; stato della rete in una colonna, mempool su
      `#/mempool`. **Transazione**: la frase è il titolo, sotto chi l'ha letta
      (riconoscitore, confidenza, fixture, link al sorgente), poi tre livelli —
      Racconto (libro mastro per differenza e resto dichiarato) · Schema UTXO · Box;
      il tab scelto finisce nell'URL. **Ricerca**: palette
      (`/` o ⌘K) che dice cosa ha riconosciuto; un id da 64 caratteri si chiede alla
      catena (tx, token o blocco); i nomi si cercano in tutte le maiuscole, perché l'API
      distingue («comet» 0 risultati, «COMET» 35). **Mercati**: ERG come titolo, quattro
      tessere, filtri, ordinamento, volume 24 h come barra e volume storico come colonna.
      Corretti per strada: il volume 24 h contava un solo verso degli scambi; «N simboli
      condivisi» contava righe; «+0 GIF» su un importo che non è zero
- [x] **Tutte le pagine nello stile «Cronaca» (27/09/2026)** — indirizzo, token, lista dei
      token, blocco, protocolli, mempool ed errori hanno la stessa grammatica della home: riga di
      contesto, testata aperta (il nome o la frase, e il numero che conta), tessere piatte,
      sezioni separate da una riga. Il **blocco** racconta le sue transazioni come il flusso; i
      **movimenti** di un indirizzo dicono cosa è successo quando il decodificatore lo sa; la
      **pagella** mostra il prezzo (lo stesso del resto del sito), l'altezza di conio e i detentori;
      **Protocolli** apre con lo stato di SigmaUSD detto in una frase. Corretti per strada:
      la pagina di un'**altezza mostrava l'ultimo blocco** (l'API ignora `minHeight/maxHeight`: ora
      `/blocks/at/{h}` e controllo dell'altezza); la pagella dava **«nessun altro token usa questo
      nome» a COMET** mentre esistono dei «Comet» (ricerca in tutte le maiuscole,
      `tokenSearchAnyCase`); la mempool poteva dire **«vuota»** quando l'API dichiarava 12
      transazioni senza restituirle; sotto il 400% il sito diceva «i riscatti restano aperti», ma il
      **riscatto di SigRSV è chiuso** (solo quello di SigUSD resta aperto); CoinGecko senza risposta
      teneva ferma la pagina Protocolli (ora si rinuncia dopo 6 s)
- [x] **Tolto il selettore Base/Avanzato (28/09/2026)** — dopo il rinnovo decideva solo su quale
      tab si apriva una transazione; nel resto del sito non cambiava niente. Ora la transazione
      apre sul Racconto, Schema e Box sono a un clic e il tab scelto resta nell'URL
- [ ] **Lancio**: post a forum/Telegram con tre link e la domanda "lo usereste, per cosa?"

## Come si misura la copertura

Il numero in cima alla home viene da `npm run coverage` (`scripts/coverage.ts`),
che la Action `coverage.yml` ripete ogni domenica e salva in `data/coverage.json`.
Scarica **tutte** le transazioni degli ultimi 1.000 blocchi, le passa al
decodificatore, e conta quante ne sa raccontare. I numeri sono due, e la home li
mostra entrambi: sul **totale**, e **escluse mining e oracoli**. Mining e oracoli
sono circa l'80% del traffico e si riconoscono con poco: da soli farebbero del
primo numero una vetrina. Il secondo è quello che conta, ed è quello del titolo.
Le transazioni che l'API non restituisce non si contano e si dichiarano; oltre il
2% la misura non si pubblica. Il file dice blocchi, data e conteggi per tipo:
chiunque può rifare il conto.

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

**Gradini di vetrina (rinnovo «Cronaca»).** Sopra i sette gradini ce ne sono tre,
solo per i titoli che *sono* il contenuto: `--fs-giant` 64 (il 66,4% della home,
«1 ERG = …» nei Mercati), `--fs-hero` 46 (il titolo della home), `--fs-head` 40 (la
frase della transazione). Tutto il resto resta sulla scala di prima. La gerarchia
della «Cronaca»: la frase prima, la fonte della lettura subito sotto, i dati dopo —
senza schede attorno a ciò che si legge per primo.

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
