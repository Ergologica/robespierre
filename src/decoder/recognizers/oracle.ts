import type { Tx, BoxLike } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { ORACLE } from '../protocols'
import { longReg } from '../regs'
import { formatTokenAmount } from '../../lib/format'
import { L } from '../../i18n'

/**
 * Oracoli — gli operatori che portano in catena il prezzo ERG/USD (e quello dell'oro).
 * Sono quasi metà del traffico di Ergo (misura del 27/09/2026 su 1.000 blocchi: 46,2%).
 *
 * Tutto si riconosce dai gettoni, che sono unici per costruzione (verificati con /tokens/{id}):
 *   pool v2 «cooperativo» USD e oro — NFT del pool, NFT del refresh, gettone dell'operatore
 *     datapoint: un operatore spende e ricrea il suo box, col prezzo in R6
 *     refresh:   il pool raccoglie i datapoint e fissa il nuovo prezzo in R4
 *   pool v1 ERG/USD — quello che legge la banca SigmaUSD
 *     datapoint: box col gettone del partecipante (ERGUSD-PT), prezzo in R6
 *     raccolta:  il box col pool NFT passa da «epoca in corso» a «preparazione», col prezzo in R4
 *     apertura:  da «preparazione» a «epoca in corso»
 *
 * Unità del prezzo USD: nanoERG per 1 dollaro. Verificato il 27/09/2026: R6 = 2.997.682.791
 * → 1 ERG = 0,3336 $, contro 0,327 $ di mercato lo stesso giorno. Per l'ORO l'unità non è
 * stata verificata: si dice che il prezzo è stato pubblicato, non quale.
 */
const has = (b: BoxLike, tokenId: string) => (b.assets ?? []).some(a => a.tokenId === tokenId)

/** nanoERG per dollaro → «0,3336 $» per 1 ERG, in BigInt (4 decimali, arrotondati). */
function usdPerErg(nanoPerUsd: bigint | null): string | null {
  if (nanoPerUsd == null || nanoPerUsd <= 0n) return null
  const x = (10n ** 13n + nanoPerUsd / 2n) / nanoPerUsd   // (1e9 / r) × 1e4
  return x > 0n ? formatTokenAmount(x, 4) + ' $' : null
}

type Pool = { poolNft: string; refreshNft: string; oracleToken: string }
function v2(tx: Tx, pool: Pool, name: string, withPrice: boolean): Decoded | null {
  const poolIn = tx.inputs.find(b => has(b, pool.poolNft))
  if (poolIn) {
    const poolOut = tx.outputs.find(b => has(b, pool.poolNft))
    if (!poolOut || !tx.inputs.some(b => has(b, pool.refreshNft))) return null
    const n = tx.inputs.filter(b => has(b, pool.oracleToken)).length
    const price = withPrice ? usdPerErg(longReg(poolOut, 'R4')) : null
    return { kind: 'oracle-refresh', headline: L.dec_oracle_refresh(name, price, n), confidence: 'certa' }
  }
  const opIn = tx.inputs.filter(b => has(b, pool.oracleToken))
  const opOut = tx.outputs.filter(b => has(b, pool.oracleToken))
  if (opIn.length === 1 && opOut.length === 1 && opIn[0]!.address === opOut[0]!.address) {
    const r6 = longReg(opOut[0], 'R6')
    if (r6 == null) return null                        // senza datapoint non è una pubblicazione
    return { kind: 'oracle-datapoint', headline: L.dec_oracle_datapoint(name, withPrice ? usdPerErg(r6) : null), confidence: 'certa' }
  }
  return null
}

export const oracle: Recognizer = {
  id: 'oracle',
  recognize(tx: Tx): Decoded | null {
    // pool v1 — il box col pool NFT si SPENDE (la banca SigmaUSD lo legge come dataInput: lì non c'è)
    const nftIn = tx.inputs.find(b => has(b, ORACLE.ergUsdNft))
    if (nftIn) {
      const nftOut = tx.outputs.find(b => has(b, ORACLE.ergUsdNft))
      if (!nftOut) return null
      if (nftIn.address === ORACLE.v1LiveEpochAddress && nftOut.address === ORACLE.v1EpochPrepAddress) {
        // gli operatori sono i datapoint letti come dataInput. L'API non riporta i token dei
        // dataInput (lista vuota), quindi si contano dall'indirizzo del contratto dei datapoint
        const n = ((tx as Tx & { dataInputs?: BoxLike[] }).dataInputs ?? []).filter(b => b.address === ORACLE.v1DatapointAddress).length
        return { kind: 'oracle-v1-collect', headline: L.dec_oracle_v1_collect(usdPerErg(longReg(nftOut, 'R4')), n), confidence: 'certa' }
      }
      if (nftIn.address === ORACLE.v1EpochPrepAddress && nftOut.address === ORACLE.v1LiveEpochAddress) {
        return { kind: 'oracle-v1-epoch', headline: L.dec_oracle_v1_epoch, confidence: 'certa' }
      }
      return null                                        // altre mosse del pool v1: non catalogate
    }
    const ptIn = tx.inputs.filter(b => has(b, ORACLE.ergUsdPt))
    const ptOut = tx.outputs.filter(b => has(b, ORACLE.ergUsdPt))
    if (ptIn.length === 1 && ptOut.length === 1 && ptIn[0]!.address === ptOut[0]!.address) {
      const r6 = longReg(ptOut[0], 'R6')
      if (r6 == null) return null
      return { kind: 'oracle-datapoint', headline: L.dec_oracle_datapoint(L.oracle_v1_name, usdPerErg(r6)), confidence: 'certa' }
    }
    return v2(tx, ORACLE.usd, L.oracle_usd_name, true)
      ?? v2(tx, ORACLE.gold, L.oracle_gold_name, false)
  },
}
