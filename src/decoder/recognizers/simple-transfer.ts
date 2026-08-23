import type { Tx, BoxLike } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { formatErg, shortId } from '../../lib/format'
import { L } from '../../i18n'

/** Indirizzo del contratto fee del protocollo (mainnet). */
export const FEE_ADDRESS =
  '2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe'

/** Su mainnet gli indirizzi P2PK iniziano con 9; tutto il resto è un contratto. */
const isP2PK = (addr: string) => addr.startsWith('9')

/**
 * Trasferimento semplice: tutti gli input sono P2PK, e gli output sono
 * (destinatari P2PK estranei agli input) + (resto agli input) + (fee).
 * Se compare un contratto da qualunque lato, questo riconoscitore tace:
 * quel caso appartiene a un riconoscitore di protocollo.
 */
export const simpleTransfer: Recognizer = {
  id: 'simple-transfer',
  recognize(tx: Tx): Decoded | null {
    if (!tx.inputs.length || !tx.outputs.length) return null
    if (!tx.inputs.every(i => isP2PK(i.address))) return null

    const inputAddrs = new Set(tx.inputs.map(i => i.address))
    const recipients = tx.outputs.filter(
      o => o.address !== FEE_ADDRESS && !inputAddrs.has(o.address),
    )
    if (!recipients.every(o => isP2PK(o.address))) return null
    if (recipients.length === 0 || recipients.length > 2) return null // più di 2: batch, non "semplice"

    const total = recipients.reduce((s, o) => s + BigInt(o.value), 0n)
    // mittente "protagonista": l'input col valore maggiore
    const from = tx.inputs.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b)).address
    const to = (recipients[0] as BoxLike).address

    return {
      kind: 'transfer',
      headline: recipients.length === 1
        ? L.dec_transfer(shortId(from, 8), shortId(to, 8), formatErg(total))
        : L.dec_transfer_n(shortId(from, 8), recipients.length, formatErg(total)),
      from, to,
      confidence: 'certa',
    }
  },
}
