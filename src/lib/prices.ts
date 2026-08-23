import { spectrumMarketsFull } from '../api/explorer'
import type { SpectrumMarket, Win24 } from '../api/explorer'

/**
 * UN SOLO prezzo per token in tutto il prodotto.
 *
 * Prima ce n'erano due: la pagina Mercati usava l'ultimo scambio delle 24 ore,
 * la composizione del wallet il pool col volume storico maggiore. Stesso token,
 * due numeri diversi nello stesso sito: un explorer che interpreta non può
 * avere due verità. Questo modulo è la sola fonte.
 *
 * Cosa dichiara, oltre al numero:
 * - `fresh`: il prezzo viene da uno scambio delle ultime 24 ore (non da mesi fa);
 * - `thin`: il pool è sottile — sulla catena Ergo la metà dei pool ha meno di
 *   ~45 ERG di volume storico, e un prezzo che nasce lì non regge il peso che
 *   la parola "prezzo" suggerisce;
 * - `sharedName`: quanti ALTRI token portano lo stesso simbolo (imitazione:
 *   il 23/08/2026 "RSN" era già duplicato sui mercati, l'originale con 2,4M ERG
 *   di volume e l'omonimo con 2).
 */

/** Sotto questo volume storico il pool è dichiarato sottile. Soglia discutibile via PR. */
export const THIN_POOL_ERG = 100

export interface TokenPrice {
  tokenId: string
  symbol: string
  ergPerToken: number   // quanti ERG vale 1 token
  vol24Erg: number      // scambi delle ultime 24 ore nel pool scelto
  volCumErg: number     // volume storico del pool scelto
  fresh: boolean
  thin: boolean
  sharedName: number    // altri token con lo stesso simbolo
}

/** PURA: dai mercati Spectrum alla mappa dei prezzi. Testata. */
export function buildPrices(markets: SpectrumMarket[], win24: Map<string, Win24>): Map<string, TokenPrice> {
  // per ogni token: il pool col volume storico maggiore
  const best = new Map<string, { m: SpectrumMarket; vol: number }>()
  for (const m of markets) {
    if (!/^0+$/.test(m.baseId) || !(m.lastPrice > 0)) continue  // solo coppie con base ERG
    const vol = m.baseVolume?.value ?? 0
    const cur = best.get(m.quoteId)
    if (!cur || vol > cur.vol) best.set(m.quoteId, { m, vol })
  }
  // conteggio dei simboli ripetuti, prima di comporre le righe
  const symCount = new Map<string, number>()
  best.forEach(({ m }) => {
    const s = (m.quoteSymbol ?? '').trim().toLowerCase()
    if (s) symCount.set(s, (symCount.get(s) ?? 0) + 1)
  })

  const out = new Map<string, TokenPrice>()
  best.forEach(({ m, vol }, tokenId) => {
    const win = win24.get(tokenId)
    const rate = win?.lastPrice ?? m.lastPrice          // unità di token per 1 ERG
    if (!(rate > 0)) return
    const sym = (m.quoteSymbol ?? '').trim()
    out.set(tokenId, {
      tokenId,
      symbol: sym || tokenId.slice(0, 8) + '…',
      ergPerToken: 1 / rate,
      vol24Erg: (win?.volNano ?? 0) / 1e9,
      volCumErg: vol / 1e9,
      fresh: !!win,
      thin: vol / 1e9 < THIN_POOL_ERG,
      sharedName: sym ? Math.max(0, (symCount.get(sym.toLowerCase()) ?? 1) - 1) : 0,
    })
  })
  return out
}

/** Cache di sessione: la stessa chiamata da 393 mercati non si rifà a ogni pagina. */
let cache: { at: number; map: Map<string, TokenPrice> } | null = null
const TTL_MS = 60_000

export async function tokenPrices(): Promise<Map<string, TokenPrice>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map
  const mk = await spectrumMarketsFull()
  const map = mk ? buildPrices(mk.all, mk.win24) : new Map<string, TokenPrice>()
  if (mk) cache = { at: Date.now(), map }   // un errore non si mette in cache
  return map
}
