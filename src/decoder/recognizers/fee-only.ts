import type { Tx } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { FEE_ADDRESS } from './simple-transfer'
import { formatErg, shortId } from '../../lib/format'
import { L } from '../../i18n'

/**
 * Commissione pura: TUTTO quello che si spende finisce nel contratto delle commissioni,
 * cioè al minatore del blocco. Nessun altro output.
 *
 * Misura del 27/09/2026 su 1.000 blocchi: 256 transazioni. 216 spendono contratti
 * (il più frequente è l'ErgoTree `0008d3`, cioè `sigmaProp(true)`: un box che può spendere
 * chiunque), 40 spendono wallet. Chi crei quei box e perché non è stabilito, quindi la frase
 * dice solo quello che si vede: dove va il valore.
 *
 * Le due forme hanno un kind diverso di proposito: quella dai contratti conta fra le
 * transazioni di mining (è un pagamento ai minatori fatto da una macchina), quella da un
 * wallet no. La copertura «escluse mining e oracoli» non si gonfia con i bot.
 */
const TRUE_TREE = '0008d3'   // sigmaProp(true), verificato con ergoTreeScript dall'API

export const feeOnly: Recognizer = {
  id: 'fee-only',
  recognize(tx: Tx): Decoded | null {
    if (!tx.inputs.length || !tx.outputs.length) return null
    if (!tx.outputs.every(o => o.address === FEE_ADDRESS)) return null
    if (tx.inputs.some(i => i.address === FEE_ADDRESS)) return null    // è il minatore che raccoglie: mining
    if (tx.inputs.some(i => (i.assets ?? []).length)) return null      // dei token sparirebbero: forma non nota
    const erg = formatErg(tx.outputs.reduce((s, o) => s + BigInt(o.value), 0n))

    if (tx.inputs.every(i => i.address.startsWith('9'))) {
      const from = tx.inputs[0]!.address
      if (tx.inputs.some(i => i.address !== from)) return null
      return { kind: 'fee-only', headline: L.dec_fee_wallet(shortId(from, 8), erg), from, confidence: 'certa' }
    }
    if (tx.inputs.some(i => i.address.startsWith('9'))) return null     // misto: non si sa di chi è l'iniziativa
    const anyone = tx.inputs.every(i => i.ergoTree === TRUE_TREE)
    return { kind: 'mining-tip', headline: L.dec_fee_contract(erg, anyone), confidence: 'certa' }
  },
}
