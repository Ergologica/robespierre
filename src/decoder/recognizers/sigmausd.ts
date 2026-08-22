import type { Tx } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { SIGMAUSD } from '../protocols'
import { formatErg, formatTokenAmount, shortId } from '../../lib/format'

/**
 * SigmaUSD (AgeUSD) — mint e riscatto di SigUSD/SigRSV contro la riserva.
 * La banca è identificata dal Bank NFT dentro il box, non dal solo indirizzo:
 * l'NFT è unico per costruzione, l'indirizzo potrebbe cambiare versione.
 *
 * Lettura dei delta (out − in del box banca):
 *   ΔSigUSD < 0 → la banca ha EMESSO SigUSD → mint (l'utente ha versato ERG)
 *   ΔSigUSD > 0 → la banca ha RITIRATO SigUSD → riscatto (l'utente ha ricevuto ERG)
 *   idem per SigRSV.
 */
const hasNft = (b: { assets?: { tokenId: string }[] }) =>
  (b.assets ?? []).some(a => a.tokenId === SIGMAUSD.bankNft)

export const sigmaUsd: Recognizer = {
  id: 'sigmausd',
  recognize(tx: Tx): Decoded | null {
    const bankIn = tx.inputs.find(hasNft)
    const bankOut = tx.outputs.find(hasNft)
    if (!bankIn || !bankOut) return null

    const delta = (tokenId: string) =>
      BigInt(bankOut.assets?.find(a => a.tokenId === tokenId)?.amount ?? 0) -
      BigInt(bankIn.assets?.find(a => a.tokenId === tokenId)?.amount ?? 0)

    const dUsd = delta(SIGMAUSD.sigUsd)
    const dRsv = delta(SIGMAUSD.sigRsv)
    const dErg = BigInt(bankOut.value) - BigInt(bankIn.value)
    const abs = (n: bigint) => (n < 0n ? -n : n)

    // il protagonista: l'output P2PK che riceve i token emessi o l'ERG riscattato
    const user = tx.outputs.find(o => o.address.startsWith('9'))?.address

    let headline: string | null = null
    if (dUsd !== 0n) {
      const amt = formatTokenAmount(abs(dUsd), SIGMAUSD.sigUsdDecimals) + ' SigUSD'
      headline = dUsd < 0n
        ? `SigmaUSD: mint di ${amt} contro ${formatErg(abs(dErg), 2)} di riserva`
        : `SigmaUSD: riscatto di ${amt} per ${formatErg(abs(dErg), 2)}`
    } else if (dRsv !== 0n) {
      const amt = formatTokenAmount(abs(dRsv), 0) + ' SigRSV'
      headline = dRsv < 0n
        ? `SigmaUSD: mint di ${amt} (quota di riserva) contro ${formatErg(abs(dErg), 2)}`
        : `SigmaUSD: riscatto di ${amt} per ${formatErg(abs(dErg), 2)}`
    }
    if (!headline) return null // la banca è passata di mano senza emettere né ritirare: non è un'operazione utente

    return { kind: 'sigmausd', headline, to: user, from: user ? shortId(user, 8) : undefined, confidence: 'certa' }
  },
}
