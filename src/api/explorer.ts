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
  tokenSearch: (q: string) => get<Paged<TokenInfo>>(`/tokens/search?query=${encodeURIComponent(q)}`, 60_000),
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
