import type { Tx, BoxLike } from '../../api/types'
import type { Recognizer, Decoded } from '../types'
import { formatErg, formatTokenAmount, shortId } from '../../lib/format'
import { L } from '../../i18n'

/** Indirizzo del contratto fee del protocollo (mainnet). */
export const FEE_ADDRESS =
  '2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe'

/** Su mainnet gli indirizzi P2PK iniziano con 9; tutto il resto è un contratto. */
const isP2PK = (addr: string) => addr.startsWith('9')

/** Sotto questa soglia l'ERG che accompagna dei token è il minimo di un box, non «il» pagamento. */
const ERG_WORTH_SAYING = 10_000_000n   // 0,01 ERG

type Tok = { tokenId: string; name: string | null; decimals: number; amount: bigint }
function tokenTotals(boxes: BoxLike[]): Map<string, Tok> {
  const m = new Map<string, Tok>()
  for (const b of boxes) for (const a of b.assets ?? []) {
    const t = m.get(a.tokenId) ?? { tokenId: a.tokenId, name: a.name?.trim() || null, decimals: a.decimals ?? 0, amount: 0n }
    t.amount += BigInt(a.amount)
    m.set(a.tokenId, t)
  }
  return m
}
const tokText = (t: Tok) => `${formatTokenAmount(t.amount, t.decimals)} ${t.name ?? shortId(t.tokenId, 6)}`
function tokList(ts: Tok[]): string {
  const first = ts.slice(0, 2).map(tokText).join(', ')
  return ts.length > 2 ? `${first} ${L.dec_more_tokens(ts.length - 2)}` : first
}

/**
 * Movimenti fra wallet: tutti gli input sono P2PK, e gli output sono P2PK o commissione.
 * Se compare un contratto da qualunque lato, questo riconoscitore tace: quel caso
 * appartiene a un riconoscitore di protocollo.
 *
 * Tre forme:
 *   trasferimento   uno o più destinatari estranei agli input. La frase dice COSA arriva:
 *                   prima i token, poi l'ERG se non è solo il minimo del box. Prima diceva
 *                   solo l'ERG: «Trasferimento: A → B, 0 ERG» mentre partivano 2.000 token.
 *   interno         nessun destinatario estraneo: i box tornano agli stessi indirizzi
 *                   (consolidamenti, divisioni), eventualmente bruciando dei token.
 *   conio           un token che non era negli input: NON è un trasferimento. Qui si tace.
 */
export const simpleTransfer: Recognizer = {
  id: 'simple-transfer',
  recognize(tx: Tx): Decoded | null {
    if (!tx.inputs.length || !tx.outputs.length) return null
    if (!tx.inputs.every(i => isP2PK(i.address))) return null
    if (!tx.outputs.every(o => isP2PK(o.address) || o.address === FEE_ADDRESS)) return null

    const tin = tokenTotals(tx.inputs)
    const tout = tokenTotals(tx.outputs)
    if ([...tout.keys()].some(id => !tin.has(id))) return null     // conio: non è un trasferimento
    const burned: Tok[] = [...tin.values()]
      .map(t => ({ ...t, amount: t.amount - (tout.get(t.tokenId)?.amount ?? 0n) }))
      .filter(t => t.amount > 0n)
    const burnText = burned.length ? L.dec_burn(tokList(burned)) : ''

    // mittente "protagonista": l'input col valore maggiore
    const from = tx.inputs.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b)).address
    const inputAddrs = new Set(tx.inputs.map(i => i.address))
    const recipients = tx.outputs.filter(o => o.address !== FEE_ADDRESS && !inputAddrs.has(o.address))

    if (!recipients.length) {
      const own = tx.outputs.filter(o => o.address !== FEE_ADDRESS)
      if (!own.length) return null                                // tutto in commissione: è di fee-only
      return {
        kind: 'wallet-internal',
        headline: (inputAddrs.size === 1
          ? L.dec_wallet_reorg(shortId(from, 8), tx.inputs.length, own.length)
          : L.dec_wallet_internal(inputAddrs.size, tx.inputs.length, own.length)) + burnText,
        from,
        confidence: 'certa',
      }
    }

    const erg = recipients.reduce((s, o) => s + BigInt(o.value), 0n)
    const toks = [...tokenTotals(recipients).values()]
    const what = toks.length
      ? tokList(toks) + (erg >= ERG_WORTH_SAYING ? ` + ${formatErg(erg)}` : '')
      : formatErg(erg)
    const to = (recipients[0] as BoxLike).address
    const n = new Set(recipients.map(r => r.address)).size
    return {
      kind: 'transfer',
      headline: (n === 1
        ? L.dec_transfer(shortId(from, 8), shortId(to, 8), what)
        : L.dec_transfer_n(shortId(from, 8), n, what)) + burnText,
      from, to,
      confidence: 'certa',
    }
  },
}
