import type { NetworkInfo, BlockHeader, Tx, AddressBalance, Paged, TokenInfo, BoxLike, FullBlock } from './types'
import { FALLBACK_BASE, fallbackAllowed, worthFallingBack, errorInBody, isPhantomTx, adaptFallback } from './fallback'

/**
 * Client dell'Explorer API.
 * - fonte principale l'Explorer API ufficiale; se non risponde (rete, 5xx, 429, 15 s),
 *   ripiego su sigmaspace SOLO per gli endpoint dove la misura del 27/09/2026 ha trovato
 *   gli stessi valori (vedi fallback.ts). Un 404 o un 400 sono risposte: niente ripiego;
 * - cache in memoria con TTL, per non rifare la stessa chiamata
 *   durante la stessa visita.
 */
const PRIMARY = 'https://api.ergoplatform.com/api/v1'
// La riserva (sigmaspace) vive in fallback.ts, con la lista degli endpoint dove si può usare
// e le guardie per le sue due trappole. Qui si decide solo QUANDO chiamarla.

/** Le risposte arrivate dalla riserva, per dirlo in pagina (WeakMap: niente campi aggiunti ai dati). */
const fromReserve = new WeakSet<object>()
export const cameFromFallback = (x: unknown): boolean => !!x && typeof x === 'object' && fromReserve.has(x)

const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 30_000

/**
 * Errore che si ricorda COSA è andato storto, non solo che è andato storto.
 * Serviva: un hash inesistente e una fonte irraggiungibile producevano la
 * stessa frase, «la fonte potrebbe essere momentaneamente giù» — cioè il sito
 * indovinava, e quasi sempre sbagliava. Verificato sull'Explorer API il
 * 27/09/2026: una transazione o un token inesistenti danno 404, un indirizzo
 * scritto male dà 400 con «Checksum check fails».
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly path: string, readonly reason?: string) {
    super('HTTP ' + status + ' su ' + path + (reason ? ' — ' + reason : ''))
    this.name = 'ApiError'
  }
  /** La cosa cercata non c'è: non è un guasto, è una risposta. */
  get notFound(): boolean { return this.status === 404 }
  /** L'id è scritto male: lo dice la catena, non lo indovino io. */
  get malformed(): boolean { return this.status === 400 && /checksum/i.test(this.reason ?? '') }
}

async function get<T>(path: string, ttl = TTL_MS): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T

  const reserve = fallbackAllowed(path)
  let primaryErr: unknown, status: number | null = null
  try {
    // con una riserva disponibile non si aspetta all'infinito: 15 secondi, poi si ripiega
    const r = await fetch(PRIMARY + path, reserve ? { signal: AbortSignal.timeout(15_000) } : undefined)
    if (r.ok) {
      const data = (await r.json()) as T
      cache.set(path, { at: Date.now(), data })
      return data
    }
    status = r.status
    const reason = await r.text().then(t => { try { return JSON.parse(t).reason as string } catch { return undefined } }).catch(() => undefined)
    primaryErr = new ApiError(r.status, path, reason)
  } catch (e) { primaryErr = e }

  if (!reserve || !worthFallingBack(status)) throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr))
  try {
    const r = await fetch(FALLBACK_BASE + path, { signal: AbortSignal.timeout(15_000) })
    const body = await r.json() as unknown
    const inBody = errorInBody(body)
    if (!r.ok || inBody) throw new ApiError(inBody?.status ?? r.status, path, inBody?.reason)
    if (/^\/transactions\//.test(path) && isPhantomTx(body)) throw new ApiError(404, path, 'transazione a zero dalla fonte di riserva')
    const data = adaptFallback(path, body) as T
    fromReserve.add(data as object)
    cache.set(path, { at: Date.now(), data })
    return data
  } catch (e) {
    // una risposta certa della riserva (404, id malformato) vale; un suo guasto no: resta l'errore di prima
    if (e instanceof ApiError) throw e
    throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr))
  }
}

export const api = {
  info: () => get<NetworkInfo>('/info', 10_000),
  blocks: (limit = 8) => get<Paged<BlockHeader>>(`/blocks?limit=${limit}&sortBy=height&sortDirection=desc`, 15_000),
  tx: (id: string) => get<Tx>(`/transactions/${id}`),
  addressBalance: (addr: string) => get<AddressBalance>(`/addresses/${addr}/balance/confirmed`),
  addressTxs: (addr: string, offset = 0, limit = 20) =>
    // niente concise=true: ritorna solo i box dell'indirizzo stesso,
    // e la controparte del movimento diventerebbe invisibile
    get<Paged<Tx>>(`/addresses/${addr}/transactions?offset=${offset}&limit=${limit}`),
  token: (id: string) => get<TokenInfo>(`/tokens/${id}`),
  box: (id: string) => get<BoxLike>(`/boxes/${id}`, 300_000),
  /** Blocco per altezza. `/api/v1/blocks?minHeight=&maxHeight=` IGNORA i due filtri
   *  (misurato il 27/09/2026: restituisce gli ultimi blocchi), e la pagina di un'altezza
   *  mostrava il blocco più recente. Si usa l'endpoint v0 `/blocks/at/{h}` → [id] (CORS
   *  aperto), e si CONTROLLA che l'altezza torni: un blocco diverso da quello chiesto
   *  non si mostra mai. */
  blockAt: async (height: number): Promise<FullBlock | null> => {
    const r = await fetch(`https://api.ergoplatform.com/blocks/at/${height}`)
    if (!r.ok) throw new ApiError(r.status, `/blocks/at/${height}`)
    const ids = await r.json() as string[]
    if (!Array.isArray(ids) || !ids[0]) return null
    const full = await get<FullBlock>(`/blocks/${ids[0]}`, 60_000)
    return full?.block?.header?.height === height ? full : null
  },
  /** L'header di lista di un'altezza (porta nome e indirizzo del minatore), per SCARTO
   *  dalla cima: la paginazione funziona, i filtri per altezza no. Il blocco nuovo che
   *  arriva fra le due chiamate sposta lo scarto di uno: si riprova, e si controlla. */
  headerAt: async (height: number): Promise<BlockHeader | null> => {
    const tip = (await get<NetworkInfo>('/info', 10_000)).height
    for (let extra = 0; extra < 3; extra++) {
      const off = tip - height + extra
      if (off < 0) return null
      const p = await get<Paged<BlockHeader>>(`/blocks?offset=${off}&limit=1&sortBy=height&sortDirection=desc`, 60_000)
      const h = p.items?.[0]
      if (h?.height === height) return h
      if (!h || h.height < height) return null
    }
    return null
  },
  blockById: (id: string) => get<FullBlock>(`/blocks/${id}`, 60_000),
  tokenSearch: (q: string, limit = 100) => get<Paged<TokenInfo>>(`/tokens/search?query=${encodeURIComponent(q)}&limit=${limit}`, 60_000),
}



/** Ricerca di token per nome che non dipende dalle maiuscole. L'API cerca per PREFISSO
 *  e distingue le maiuscole (27/09/2026: «comet» 0 risultati, «COMET» 35, «Comet» 692):
 *  la pagella di COMET diceva «nessun altro token usa questo nome» mentre due «Comet»
 *  esistevano. Si chiedono le varianti e si uniscono per id. `truncated` = almeno una
 *  variante ha riempito la pagina da 100: i conteggi sono allora un minimo. */
export async function tokenSearchAnyCase(q: string): Promise<{ items: TokenInfo[]; truncated: boolean }> {
  const t = q.trim()
  const variants = [...new Set([t, t.toUpperCase(), t.toLowerCase(), t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()])]
  const res = await Promise.allSettled(variants.map(v => api.tokenSearch(v)))
  const ok = res.filter((r): r is PromiseFulfilledResult<Paged<TokenInfo>> => r.status === 'fulfilled')
  if (!ok.length) throw (res[0] as PromiseRejectedResult).reason
  const byId = new Map<string, TokenInfo>()
  for (const r of ok) for (const it of r.value.items ?? []) byId.set(it.id, it)
  return {
    items: [...byId.values()],
    truncated: ok.some(r => (r.value.items?.length ?? 0) >= 100 || (r.value.total ?? 0) > (r.value.items?.length ?? 0)),
  }
}

/** Statistiche del nodo (supply, hashrate, media transazioni): endpoint v0 /info. */
export interface NetworkStats { supply: number; hashRate: number; transactionAverage: number }
export async function networkStats(): Promise<NetworkStats | null> {
  try {
    const r = await fetch('https://api.ergoplatform.com/info')
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Mempool completa (endpoint v0), con dimensione e output per calcolare le commissioni. */
export interface UnconfirmedTx { id: string; creationTimestamp: number; size: number; outputs: { address?: string; value: number | string }[] }
export async function mempoolFull(limit = 8): Promise<{ items: UnconfirmedTx[]; total: number } | null> {
  try {
    const r = await fetch('https://api.ergoplatform.com/transactions/unconfirmed?limit=' + limit)
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Conteggio della mempool completa: endpoint v0, verificato con CORS aperto il 22/08/2026. */
export async function mempoolCount(): Promise<number | null> {
  try {
    const r = await fetch('https://api.ergoplatform.com/transactions/unconfirmed?limit=1')
    if (!r.ok) return null
    const j = await r.json()
    return typeof j.total === 'number' ? j.total : null
  } catch { return null }
}


/** Prezzi dei token dai pool Spectrum: token per 1 ERG (unità decimalizzate).
 *  Per ogni token si usa il pool col volume maggiore. Stima indicativa per natura:
 *  la pagina che la mostra lo dichiara. */
export async function spectrumTokenPerErg(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const r = await fetch('https://api.spectrum.fi/v1/price-tracking/markets')
    if (!r.ok) return out
    const markets = await r.json() as { baseId: string; quoteId: string; lastPrice: number; baseVolume?: { value?: number } }[]
    const best = new Map<string, { price: number; vol: number }>()
    for (const m of markets) {
      if (!/^0+$/.test(m.baseId) || !(m.lastPrice > 0)) continue // solo coppie con base ERG
      const vol = m.baseVolume?.value ?? 0
      const cur = best.get(m.quoteId)
      if (!cur || vol > cur.vol) best.set(m.quoteId, { price: m.lastPrice, vol })
    }
    best.forEach((v, k) => out.set(k, v.price))
  } catch { /* nessun prezzo: il grafico semplicemente non si mostra */ }
  return out
}

/** Prezzo ERG in USD/EUR: opzionale per definizione — se fallisce, il sito mostra i soli ERG. */
export async function ergPrice(): Promise<{ usd: number; eur: number } | null> {
  try {
    // prezzo opzionale per definizione: dopo 6 s si rinuncia, e la pagina mostra i soli ERG
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd,eur', { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = await r.json()
    return j?.ergo ?? null
  } catch { return null }
}

/* ---------------- mercati, storico prezzi, dati precalcolati ---------------- */

/** Dati notturni/periodici committati dalla Action: letti da raw.githubusercontent
 *  (CORS aperto), così non dipendono dal deploy del sito. */
export const RAW_DATA = 'https://raw.githubusercontent.com/Ergologica/robespierre/main/data'

export interface SpectrumMarket {
  baseId: string; quoteId: string; baseSymbol?: string; quoteSymbol?: string
  lastPrice: number; baseVolume?: { value?: number }
  quoteVolume?: { value?: number; units?: { asset?: { decimals?: number } } }
}

/**
 * Volume di un mercato nella finestra delle 24 ore, in nanoERG, contando ENTRAMBI i versi.
 *
 * Trovato il 27/09/2026 guardando la risposta vera: nella finestra l'API di Spectrum
 * riporta il volume per VERSO. Chi compra token con ERG fa crescere `baseVolume`
 * (ERG entrati), chi vende token per ERG fa crescere solo `quoteVolume` (token entrati).
 * Quel giorno CYPX aveva baseVolume 0 e quoteVolume 15.500 CYPX: contare solo il lato
 * ERG lo dava «non scambiato» mentre qualcuno lo aveva venduto. Il lato token si porta
 * in ERG col prezzo del mercato stesso (lastPrice = token per 1 ERG).
 */
export function windowVolNano(m: SpectrumMarket): number {
  const base = m.baseVolume?.value ?? 0
  const q = m.quoteVolume?.value ?? 0
  if (!(q > 0) || !(m.lastPrice > 0)) return base
  const dec = m.quoteVolume?.units?.asset?.decimals ?? 0
  return base + (q / 10 ** dec / m.lastPrice) * 1e9
}

/** Tutti i mercati (volume storico, per scegliere il pool) + volumi 24h reali (finestra). */
export interface Win24 { volNano: number; lastPrice: number }
export async function spectrumMarketsFull(): Promise<{ all: SpectrumMarket[]; win24: Map<string, Win24> } | null> {
  try {
    const to = Date.now(), from = to - 24 * 3600 * 1000
    const [allR, winR] = await Promise.all([
      fetch('https://api.spectrum.fi/v1/price-tracking/markets'),
      fetch(`https://api.spectrum.fi/v1/price-tracking/markets?from=${from}&to=${to}`),
    ])
    if (!allR.ok) return null
    const all = await allR.json() as SpectrumMarket[]
    // finestra 24h: volume VERO e prezzo dell'ultimo scambio recente (dal pool più attivo nella finestra)
    const win24 = new Map<string, Win24>()
    if (winR.ok) {
      const best = new Map<string, { vol: number; price: number; sum: number }>()
      for (const m of await winR.json() as SpectrumMarket[]) {
        if (!/^0+$/.test(m.baseId) || !(m.lastPrice > 0)) continue
        const vol = windowVolNano(m)                 // entrambi i versi, non solo gli ERG entrati
        const cur = best.get(m.quoteId)
        if (!cur) best.set(m.quoteId, { vol, price: m.lastPrice, sum: vol })
        else { cur.sum += vol; if (vol > cur.vol) { cur.vol = vol; cur.price = m.lastPrice } }
      }
      best.forEach((v, k) => win24.set(k, { volNano: v.sum, lastPrice: v.price }))
    }
    return { all, win24 }
  } catch { return null }
}

/** Prezzo ERG con variazione 24h (CoinGecko). Opzionale per definizione. */
export interface ErgQuote { usd: number; eur: number; usdChange24h: number | null }
export async function ergQuote(): Promise<ErgQuote | null> {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd,eur&include_24hr_change=true', { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const j = (await r.json())?.ergo
    return j ? { usd: j.usd, eur: j.eur, usdChange24h: typeof j.usd_24h_change === 'number' ? j.usd_24h_change : null } : null
  } catch { return null }
}

/** Serie giornaliera ERG/USD degli ultimi 12 mesi (CoinGecko): data ISO → prezzo.
 *  Oltre i 12 mesi la cella dell'export resta VUOTA, non inventata. */
let histCache: { at: number; map: Map<string, number> } | null = null
export async function ergHistoryUsd(): Promise<Map<string, number>> {
  if (histCache && Date.now() - histCache.at < 600_000) return histCache.map
  const map = new Map<string, number>()
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/ergo/market_chart?vs_currency=usd&days=365&interval=daily')
    if (r.ok) {
      const j = await r.json() as { prices?: [number, number][] }
      for (const [ts, p] of j.prices ?? []) map.set(new Date(ts).toISOString().slice(0, 10), p)
    }
  } catch { /* la mappa resta vuota: le celle prezzo restano vuote */ }
  histCache = { at: Date.now(), map }
  return map
}

/** Lista completa dei token coniati (paginata dall'API dell'explorer). */
export interface TokenListItem { id: string; name?: string | null; decimals?: number | null; emissionAmount?: number | string | null; type?: string | null }
export async function tokensList(offset = 0, limit = 100): Promise<{ items: TokenListItem[]; total: number } | null> {
  try {
    const r = await fetch(`https://api.ergoplatform.com/api/v1/tokens?offset=${offset}&limit=${limit}`)
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Concentrazione precalcolata dal job notturno, se il token è in lista. */
export interface PrecomputedHolders {
  at: string; total: number; holders: number
  top: { address: string; amount: string; pct: number }[]
  restPct: number; restCount: number
}
export async function precomputedHolders(tokenId: string): Promise<PrecomputedHolders | null> {
  try {
    const r = await fetch(`${RAW_DATA}/holders/${tokenId}.json`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Serie storica dei protocolli (una rilevazione ogni 6 ore, dalla Action). */
export interface ProtocolPoint { at: string; ratioOracle: number | null; ratioMarket: number | null; reserveErg: number; circUsd: number }
export async function protocolsLog(): Promise<ProtocolPoint[] | null> {
  try {
    const r = await fetch(`${RAW_DATA}/protocols/log.json`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** La copertura del decodificatore, misurata da scripts/coverage.ts (settimanale). */
export interface CoverageSummary {
  measuredAt: string
  blocks: { from: number; to: number; count: number }
  summary: { total: number; recognized: number; infra: number; rest: number; restRecognized: number }
}
export async function coverageSummary(): Promise<CoverageSummary | null> {
  try {
    const r = await fetch(`${RAW_DATA}/coverage.json`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json() as CoverageSummary
    return j.summary && j.summary.total > 0 && j.summary.rest > 0 ? j : null   // il vecchio formato non ha summary: si tace
  } catch { return null }
}
