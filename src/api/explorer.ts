import type { NetworkInfo, BlockHeader, Tx, AddressBalance, Paged, TokenInfo, BoxLike, FullBlock } from './types'

/**
 * Client dell'Explorer API.
 * - lista di basi con scorrimento al primo errore (un explorer che muore
 *   quando muore la sua fonte non è un explorer);
 * - cache in memoria con TTL, per non rifare la stessa chiamata
 *   durante la stessa visita.
 */
const BASES = [
  'https://api.ergoplatform.com/api/v1',
  // aggiungere qui eventuali mirror/nodi propri
]

const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 30_000

async function get<T>(path: string, ttl = TTL_MS): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T
  let lastErr: unknown
  for (const base of BASES) {
    try {
      const r = await fetch(base + path)
      if (!r.ok) throw new Error('HTTP ' + r.status + ' su ' + path)
      const data = (await r.json()) as T
      cache.set(path, { at: Date.now(), data })
      return data
    } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
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
  /** Header di lista a una data altezza (portano nome e indirizzo del minatore). */
  blocksRange: (height: number) =>
    get<Paged<BlockHeader>>(`/blocks?minHeight=${height}&maxHeight=${height}`, 60_000),
  /** Blocco per altezza: prima l'header nell'intervallo, poi il blocco completo. */
  blockAt: async (height: number): Promise<FullBlock | null> => {
    const page = await get<Paged<BlockHeader>>(`/blocks?minHeight=${height}&maxHeight=${height}`, 60_000)
    const id = page.items?.[0]?.id
    return id ? get<FullBlock>(`/blocks/${id}`, 60_000) : null
  },
  blockById: (id: string) => get<FullBlock>(`/blocks/${id}`, 60_000),
  tokenSearch: (q: string, limit = 100) => get<Paged<TokenInfo>>(`/tokens/search?query=${encodeURIComponent(q)}&limit=${limit}`, 60_000),
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
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd,eur')
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
        const vol = m.baseVolume?.value ?? 0
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
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd,eur&include_24hr_change=true')
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
