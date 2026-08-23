import type { Tx } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { ROSEN } from '../protocols'
import { FEE_ADDRESS } from './simple-transfer'
import { formatErg, shortId } from '../../lib/format'
import { L } from '../../i18n'

/**
 * Rosen Bridge — pagamenti dal bridge verso Ergo.
 * Riconoscimento per indirizzo etichettato (hot wallet): la lettura resta
 * 'certa' per la direzione in arrivo (il pattern è inequivocabile: hot wallet
 * negli input, destinatario P2PK negli output); l'eventuale flusso inverso
 * è segnalato come 'probabile' perché il lock lato Ergo usa più contratti.
 */
export const rosenBridge: Recognizer = {
  id: 'rosen-bridge',
  recognize(tx: Tx): Decoded | null {
    const fromBridge = tx.inputs.some(b => b.address === ROSEN.hotWallet)
    const toBridge = tx.outputs.some(b => b.address === ROSEN.hotWallet)

    if (fromBridge) {
      const recipients = tx.outputs.filter(o => o.address.startsWith('9') && o.address !== FEE_ADDRESS)
      if (!recipients.length) return null
      const main = recipients.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b))
      const tokenNames = [...new Set(recipients.flatMap(r => (r.assets ?? []).map(a => a.name?.trim() || 'token')))]
      const tokens = tokenNames.length ? ` + ${tokenNames.slice(0, 2).join(', ')}${tokenNames.length > 2 ? '…' : ''}` : ''
      return {
        kind: 'rosen-in',
        headline: L.dec_rosen_in(formatErg(BigInt(main.value), 2), tokens, shortId(main.address, 8)),
        to: main.address,
        confidence: 'certa',
      }
    }
    if (toBridge) {
      const sent = tx.outputs.filter(o => o.address === ROSEN.hotWallet)
        .reduce((s, o) => s + BigInt(o.value), 0n)
      return {
        kind: 'rosen-out',
        headline: L.dec_rosen_out(formatErg(sent, 2)),
        confidence: 'probabile',
      }
    }
    return null
  },
}
