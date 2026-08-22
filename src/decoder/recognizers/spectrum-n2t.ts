import type { Tx, BoxLike } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { SPECTRUM } from '../protocols'
import { formatErg, formatTokenAmount } from '../../lib/format'

/**
 * Spectrum Finance — pool N2T (ERG ↔ token), contratto condiviso da tutti i pool.
 * Struttura: un box del pool in input e uno in output, stesso indirizzo,
 * stesso pool NFT (primo asset, quantità 1).
 *
 * Lettura dei delta del pool (out − in):
 *   ΔLP = 0  → swap        (le riserve si muovono in direzioni opposte)
 *   ΔLP < 0  → deposito    (il pool cede LP, entrambe le riserve salgono)
 *   ΔLP > 0  → ritiro      (il pool riassorbe LP, entrambe le riserve scendono)
 *
 * Nel dubbio strutturale (asset mancanti, forma inattesa) si restituisce null.
 * I pool T2T (token ↔ token) hanno un altro contratto: TODO Fase 2.1.
 */
export const spectrumN2T: Recognizer = {
  id: 'spectrum-n2t',
  recognize(tx: Tx): Decoded | null {
    const pin = tx.inputs.find(b => b.address === SPECTRUM.n2tPoolAddress)
    const pout = tx.outputs.find(b => b.address === SPECTRUM.n2tPoolAddress)
    if (!pin || !pout) return null

    const aIn = pin.assets ?? [], aOut = pout.assets ?? []
    if (aIn.length < 2 || aOut.length < 2) return null
    const nft = aIn[0] as { tokenId: string }
    if (!aOut.some(a => a.tokenId === nft.tokenId)) return null // NFT deve restare nel pool

    const amountOf = (assets: typeof aIn, id: string) => BigInt(assets.find(a => a.tokenId === id)?.amount ?? 0)
    const lp = aIn[1] as { tokenId: string; name?: string | null }
    const dLp = amountOf(aOut, lp.tokenId) - amountOf(aIn, lp.tokenId)
    const dErg = BigInt(pout.value) - BigInt(pin.value)

    // l'asset scambiato: il token del pool che non è NFT né LP
    const tok = aIn.find(a => a.tokenId !== nft.tokenId && a.tokenId !== lp.tokenId)
    if (!tok) return null
    const dTok = amountOf(aOut, tok.tokenId) - amountOf(aIn, tok.tokenId)
    const tokName = tok.name?.trim() || 'token'
    const tokDec = tok.decimals ?? 0
    const abs = (n: bigint) => (n < 0n ? -n : n)
    const user = tx.outputs.find(o => o.address.startsWith('9'))?.address

    let headline: string
    if (dLp === 0n) {
      if (dErg === 0n || dTok === 0n || (dErg > 0n) === (dTok > 0n)) return null // uno swap muove le riserve in direzioni opposte
      headline = dErg > 0n
        ? `Swap su Spectrum: ${formatErg(dErg, 2)} → ${formatTokenAmount(abs(dTok), tokDec)} ${tokName}`
        : `Swap su Spectrum: ${formatTokenAmount(abs(dTok), tokDec)} ${tokName} → ${formatErg(abs(dErg), 2)}`
    } else if (dLp < 0n) {
      headline = `Spectrum: deposito di liquidità nel pool ERG/${tokName} (${formatErg(abs(dErg), 2)} + ${formatTokenAmount(abs(dTok), tokDec)} ${tokName})`
    } else {
      headline = `Spectrum: ritiro di liquidità dal pool ERG/${tokName} (${formatErg(abs(dErg), 2)} + ${formatTokenAmount(abs(dTok), tokDec)} ${tokName})`
    }
    return { kind: 'spectrum-n2t', headline, to: user, confidence: 'certa' }
  },
}
