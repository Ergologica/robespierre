import { api } from '../api/explorer'
import { isCurrent } from '../lib/nav'
import { paideiaDao, readStakeOp, readStakeState, buildPosition } from './paideia'
import type { StakeOp, StakePosition } from './paideia'
import type { Asset, Tx, BoxLike } from '../api/types'

export type { StakePosition } from './paideia'

/** Tetto di NFT interrogati per wallet: un portafoglio con centinaia di
 *  figurine non deve far partire centinaia di richieste. Dichiarato. */
export const MAX_NFT_CHECKED = 24

async function unspentByToken(tokenId: string): Promise<BoxLike | null> {
  try {
    const r = await fetch(`https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${tokenId}?limit=1`)
    if (!r.ok) return null
    return (await r.json()).items?.[0] ?? null
  } catch { return null }
}

/** Tetto di transazioni del contratto lette per ricostruire una posizione.
 *  Un DAO piccolo ci sta tutto; su uno grande la lettura è parziale — e lo dice. */
export const MAX_CONTRACT_TXS = 200

/**
 * PURA — il ruolo della chiave in una transazione, e con esso il diritto di
 * attribuirle la variazione del box di stato.
 *
 * Il problema è vero e l'ho visto sulla catena: il box del wallet che paga una
 * transazione di staking contiene spesso ALTRE chiavi (Sigmanauts, Walrus,
 * Paideia…) e decine di NFT qualunque. Contarle come coinvolte significherebbe
 * scrivere sotto il nome di uno l'importo di un altro.
 *
 * Restano due soli casi in cui l'attribuzione è certa, perché la chiave stessa
 * nasce o muore nella transazione:
 *   - `conio`  → la chiave c'è in uscita e non in entrata: è l'INGRESSO in staking
 *   - `rogo`   → la chiave c'è in entrata e non in uscita: è l'USCITA
 * Tutto il resto (la chiave sta ferma in un box che viene speso) è ambiguo:
 * non si conta, e la ricostruzione si dichiara parziale.
 */
export function ruoloChiave(tx: Tx, keyId: string): 'conio' | 'rogo' | 'ambiguo' {
  const ha = (bs: { assets?: { tokenId: string }[] }[]) =>
    bs.some(b => (b.assets ?? []).some(a => a.tokenId === keyId))
  const dentro = ha(tx.inputs), fuori = ha(tx.outputs)
  if (!dentro && fuori) return 'conio'
  if (dentro && !fuori) return 'rogo'
  return 'ambiguo'
}

/** I due nomi con cui Paideia battezza le chiavi, nelle due generazioni. */
const SUFFISSI = ['Membership', 'Stake Key']

/** PURA: altre chiave DELLO STESSO DAO presenti nella transazione. Con la
 *  chiave che sta ferma in un box (un rincalzo del deposito), la variazione è
 *  attribuibile solo se nessun'altra chiave dello stesso DAO è in ballo:
 *  altrimenti non si sa di chi sia, e non si indovina.
 *  Confronto per nome esatto «<DAO> Membership» / «<DAO> Stake Key»: gli altri
 *  NFT del wallet — e sono decine — non c'entrano. */
export function altreChiaviDelDao(tx: Tx, dao: string, keyId: string): number {
  const attesi = SUFFISSI.map(x => (dao + ' ' + x).toLowerCase())
  const viste = new Set<string>()
  for (const b of [...tx.inputs, ...tx.outputs])
    for (const a of b.assets ?? [])
      if (BigInt(a.amount) === 1n && a.tokenId !== keyId
        && attesi.includes((a.name ?? '').trim().toLowerCase())) viste.add(a.tokenId)
  return viste.size
}

/** Tutte le operazioni di QUESTA chiave sul contratto di staking, fin dove si legge. */
async function opsForKey(contract: string, dao: string, keyId: string, stateTokenId: string):
  Promise<{ ops: StakeOp[]; partial: boolean }> {
  const ops: StakeOp[] = []
  let partial = false
  for (let off = 0; off < MAX_CONTRACT_TXS; off += 50) {
    let page: { items: Tx[]; total: number }
    try { page = await api.addressTxs(contract, off, 50) } catch { break }
    for (const tx of page.items ?? []) {
      const tocca = [...tx.inputs, ...tx.outputs].some(b => (b.assets ?? []).some(a => a.tokenId === keyId))
      if (!tocca) continue
      const op = readStakeOp(tx, stateTokenId)
      if (!op || op.delta === 0n) continue        // il box di stato non si è mosso: non è un'operazione
      const ruolo = ruoloChiave(tx, keyId)
      if (ruolo === 'ambiguo' && altreChiaviDelDao(tx, dao, keyId)) { partial = true; continue }
      // conio e rogo hanno un segno obbligato; se non concorda non si è capito
      if (ruolo !== 'ambiguo' && (ruolo === 'conio') !== (op.delta > 0n)) { partial = true; continue }
      ops.push(op)
    }
    const tot = page.total ?? 0
    if (off + 50 >= tot) break
    if (off + 50 >= MAX_CONTRACT_TXS) partial = partial || tot > MAX_CONTRACT_TXS
  }
  return { ops, partial }
}

/** PURA: unisce l'operazione di ingresso con quelle trovate scorrendo il contratto,
 *  senza contare due volte la stessa transazione. */
export function mergeOps(first: StakeOp, found: StakeOp[]): StakeOp[] {
  const byTx = new Map<string, StakeOp>()
  for (const o of [first, ...found]) byTx.set(o.txId, o)
  return [...byTx.values()].sort((a, b) => a.at - b.at)
}

/** PURA: gli NFT del wallet nell'ordine in cui vale la pena interrogarli.
 *  Un wallet con novanta figurine (ne ho visto uno vero) manderebbe la chiave
 *  oltre il tetto delle richieste: chi si CHIAMA come una chiave passa avanti.
 *  È un ordine, non un filtro — sotto il tetto si guardano anche gli altri. */
export function ordinaCandidati(tokens: Asset[]): Asset[] {
  const pare = (t: Asset) => SUFFISSI.some(x => (t.name ?? '').trim().toLowerCase().endsWith(x.toLowerCase()))
  return tokens
    .filter(t => BigInt(t.amount) === 1n && (t.decimals ?? 0) === 0)
    .sort((a, b) => Number(pare(b)) - Number(pare(a)))
}

/** Ricostruisce le posizioni in staking a partire dai token del wallet.
 *  Nessuna costante scritta a mano: tutto deriva dalla chiave. */
export async function findStakes(tokens: Asset[], gen?: number): Promise<StakePosition[]> {
  const vivo = () => gen == null || isCurrent(gen)
  const nft = ordinaCandidati(tokens).slice(0, MAX_NFT_CHECKED)
  const out: StakePosition[] = []
  for (const t of nft) {
    if (!vivo()) return out
    let info
    try { info = await api.token(t.tokenId) } catch { continue }
    const dao = paideiaDao(info)
    if (!dao || !info.boxId) continue                     // non è una chiave Paideia
    try {
      const mint = await api.box(info.boxId)
      const tx = await api.tx(mint.transactionId!)
      const first = readStakeOp(tx)
      if (!first) continue                                // la chiave c'è ma non è un ingresso in staking: si tace
      const contract = tx.outputs.find(o =>
        (o.assets ?? []).some(a => a.tokenId === first.stateTokenId))?.address
      if (!contract) continue
      const [scan, stateBox] = await Promise.all([
        opsForKey(contract, dao, t.tokenId, first.stateTokenId),
        unspentByToken(first.stateTokenId),
      ])
      if (!vivo()) return out
      const state = stateBox ? readStakeState(stateBox, first.stateTokenId) : null
      if (!state) continue
      // l'ingresso c'è sempre: unito alle altre operazioni, mai contato due volte
      const pos = buildPosition(dao, t.tokenId, mergeOps(first, scan.ops), state, scan.partial)
      if (pos) out.push(pos)
    } catch { /* una chiave illeggibile non rompe la pagina */ }
  }
  return out
}
