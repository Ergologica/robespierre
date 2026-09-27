import type { Tx, BoxLike } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { MINING } from '../protocols'
import { FEE_ADDRESS } from './simple-transfer'
import { formatErg, groupThousands } from '../../lib/format'
import { L } from '../../i18n'

/**
 * Mining — le transazioni che fa la rete da sola. Sono un terzo del traffico di Ergo
 * (misura del 27/09/2026 su 1.000 blocchi: 32,2%), e nessun explorer le spiega.
 *
 * Quattro forme, tutte strutturali (lettura 'certa'):
 *   emissione       il box col «Emission Contract NFT» crea la ricompensa del blocco
 *   commissioni     il minatore raccoglie i box del contratto delle commissioni
 *   incasso         il minatore spende ricompense ormai mature (720 blocchi)
 *   ri-emissione    i versamenti EIP-27 confluiscono nel contratto col «Reemission Contract NFT»
 *
 * EIP-27, in una riga: di ogni ricompensa di blocco una parte è vincolata da «Reemission
 * Token» (1 token = 1 nanoERG); quando il minatore la spende deve versare altrettanti ERG
 * al contratto di ri-emissione, che li restituirà ai minatori dopo la fine dell'emissione.
 */

/** Il contratto delle ricompense: stessa forma per tutti, cambia solo la chiave del minatore. */
export function isMinerReward(b: BoxLike): boolean {
  const t = b.ergoTree
  const m = MINING.minerRewardTree
  return !!t && t.length === m.length && t.startsWith(m.prefix) && t.endsWith(m.suffix)
}
const has = (b: BoxLike, tokenId: string) => (b.assets ?? []).some(a => a.tokenId === tokenId)
const tokenAmount = (b: BoxLike, tokenId: string) =>
  (b.assets ?? []).filter(a => a.tokenId === tokenId).reduce((s, a) => s + BigInt(a.amount), 0n)
const sum = (bs: BoxLike[]) => bs.reduce((s, b) => s + BigInt(b.value), 0n)

export const mining: Recognizer = {
  id: 'mining',
  recognize(tx: Tx): Decoded | null {
    // 1. emissione: il box dell'emissione si spende e si ricrea, e nasce una ricompensa
    const emIn = tx.inputs.find(b => has(b, MINING.emissionNft))
    if (emIn) {
      const reward = tx.outputs.find(isMinerReward)
      if (!reward || !tx.outputs.some(b => has(b, MINING.emissionNft))) return null
      const vincolati = tokenAmount(reward, MINING.reemissionToken)   // nanoERG da versare alla ri-emissione
      return {
        kind: 'mining-emission',
        headline: L.dec_emission(
          tx.inclusionHeight ? groupThousands(String(tx.inclusionHeight)) : '—',
          formatErg(BigInt(reward.value), 2),
          vincolati > 0n ? formatErg(vincolati, 2) : null),
        confidence: 'certa',
      }
    }

    // 2. ri-emissione: i versamenti EIP-27 entrano nel contratto
    const reIn = tx.inputs.find(b => has(b, MINING.reemissionNft))
    if (reIn) {
      const reOut = tx.outputs.find(b => has(b, MINING.reemissionNft))
      const versamenti = tx.inputs.filter(b => b.address === MINING.payToReemissionAddress)
      if (!reOut || !versamenti.length) return null
      return {
        kind: 'mining-reemission',
        headline: L.dec_reemission(versamenti.length, formatErg(BigInt(reOut.value) - BigInt(reIn.value), 2)),
        confidence: 'certa',
      }
    }

    // 3. commissioni: TUTTI gli input sono box del contratto delle commissioni, e vanno a una ricompensa
    if (tx.inputs.length && tx.inputs.every(b => b.address === FEE_ADDRESS)) {
      const reward = tx.outputs.filter(isMinerReward)
      if (reward.length !== 1 || tx.outputs.length !== 1) return null
      return {
        kind: 'mining-fees',
        headline: L.dec_fees(formatErg(BigInt(reward[0]!.value)), tx.inputs.length),
        confidence: 'certa',
      }
    }

    // 4. incasso: si spendono ricompense mature (720 blocchi dopo la creazione)
    const mature = tx.inputs.filter(isMinerReward)
    if (mature.length) {
      const versato = sum(tx.outputs.filter(b => b.address === MINING.payToReemissionAddress))
      const dovuto = mature.reduce((s, b) => s + tokenAmount(b, MINING.reemissionToken), 0n)
      // se il versamento non torna col vincolo dei token, la forma non è quella che conosciamo
      if (versato !== dovuto) return null
      const destinatari = new Set(tx.outputs
        .filter(b => b.address !== FEE_ADDRESS && b.address !== MINING.payToReemissionAddress)
        .map(b => b.address)).size
      return {
        kind: 'mining-reward',
        headline: L.dec_reward(formatErg(sum(mature), 2), mature.length,
          versato > 0n ? formatErg(versato, 2) : null, destinatari),
        confidence: 'certa',
      }
    }
    return null
  },
}
