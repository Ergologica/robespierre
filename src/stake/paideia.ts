import type { Tx, BoxLike } from '../api/types'

/**
 * Staking dei DAO su Paideia (app.paideia.im).
 *
 * COSA SI PUÒ SAPERE E COSA NO — la parte importante.
 * Chi entra in uno staking Paideia riceve nel wallet una chiave: un NFT da 1
 * unità con descrizione «<DAO> - Powered by Paideia - https://app.paideia.im».
 * I token depositati NON restano nel wallet: finiscono tutti in un unico box
 * di stato del DAO, insieme al suo «<DAO> Stake State».
 *
 * Le quote dei singoli partecipanti stanno in un ALBERO AUTENTICATO (il
 * registro R4 del box di stato è di tipo Coll[AvlTree]): l'Explorer API non
 * sa espanderlo, e nessuno può leggere da lì quanto vale oggi una posizione
 * comprese le ricompense maturate. Questo modulo quindi NON stima il saldo
 * corrente: ricostruisce quello che la catena dice davvero — quanto è stato
 * depositato, quando, quanti partecipanti ci sono e quanto c'è in tutto — e
 * dichiara apertamente il resto. Meglio un buco dichiarato di un numero
 * inventato: è la stessa regola del decodificatore.
 *
 * Nessuna costante scritta a mano: contratto, token di stato e token
 * depositato si ricavano tutti dalla transazione di ingresso.
 */

/* Le chiavi di Paideia esistono in DUE generazioni, e si firmano in modo diverso.
 * Verificato sulla catena il 24/08/2026 cercando ogni token con «Powered by
 * Paideia» nella descrizione: 119 trovati, di cui
 *   - «<DAO> Membership»  descrizione «<DAO> - Powered by Paideia - https://app.paideia.im»
 *   - «<DAO> Stake Key»   descrizione «Powered by Paideia», SENZA il nome del DAO
 * La seconda è la più vecchia (Sigmanauts 2024, Walrus DAO, RosenGuards) e il
 * nome del DAO sta solo nel NOME del token. Riconoscere solo la prima voleva
 * dire non vedere le posizioni più vecchie dell'ecosistema. */
const FIRMA_NUOVA = /^(.+?)\s*-\s*Powered by Paideia\s*-\s*https:\/\/app\.paideia\.im/i
const FIRMA_VECCHIA = /^Powered by Paideia\.?$/i
const NOME_CHIAVE = /^(.+?)\s+Stake Key$/i

/** PURA: se questo token è la chiave di un DAO Paideia, restituisce il nome del DAO.
 *  La firma da sola non basta a fidarsi: chi la usa deve poi trovare, nella
 *  transazione di conio, un box di stato con la struttura giusta. */
export function paideiaDao(t: { name?: string | null; description?: string | null; emissionAmount?: number | string | null }): string | null {
  if (t.emissionAmount != null && BigInt(t.emissionAmount) !== 1n) return null
  const d = (t.description ?? '').trim()
  const m = FIRMA_NUOVA.exec(d)
  if (m) return m[1]!.trim()
  if (FIRMA_VECCHIA.test(d)) {
    const n = NOME_CHIAVE.exec((t.name ?? '').trim())
    if (n) return n[1]!.trim()          // «Sigmanauts Stake Key» → «Sigmanauts»
  }
  return null
}

export interface StakeOp {
  txId: string              // la transazione da cui è letta: serve a non contarla due volte
  stateTokenId: string      // l'NFT che identifica il box di stato del DAO
  stakedTokenId: string     // il token che si deposita
  stakedName: string | null
  stakedDecimals: number
  delta: bigint             // quanto è entrato (+) o uscito (−) in questa operazione
  totalAfter: bigint | null // totale nel box dopo l'operazione
  at: number                // quando
}

const asset1 = (b: BoxLike) => (b.assets ?? []).find(a => BigInt(a.amount) === 1n)

/** PURA: legge un'operazione di staking da una transazione.
 *  Il box di stato è riconosciuto strutturalmente: stesso indirizzo in input e
 *  output, due token, di cui uno da 1 unità presente in entrambi. */
export function readStakeOp(tx: Tx, stateTokenId?: string): StakeOp | null {
  for (const bIn of tx.inputs) {
    if ((bIn.assets ?? []).length !== 2) continue
    const nft = asset1(bIn)
    if (!nft) continue
    if (stateTokenId && nft.tokenId !== stateTokenId) continue
    const bOut = tx.outputs.find(o => o.address === bIn.address
      && (o.assets ?? []).some(a => a.tokenId === nft.tokenId && BigInt(a.amount) === 1n))
    if (!bOut) continue
    const staked = (bIn.assets ?? []).find(a => a.tokenId !== nft.tokenId)
    if (!staked) continue
    const before = BigInt(staked.amount)
    const after = BigInt((bOut.assets ?? []).find(a => a.tokenId === staked.tokenId)?.amount ?? 0)
    return {
      txId: tx.id,
      stateTokenId: nft.tokenId,
      stakedTokenId: staked.tokenId,
      stakedName: staked.name?.trim() || null,
      stakedDecimals: staked.decimals ?? 0,
      delta: after - before,
      totalAfter: after,
      at: tx.timestamp,
    }
  }
  return null
}

export interface StakeState { total: bigint; stakers: number | null }

/** PURA: dal box di stato attuale — quanto c'è in tutto e quanti partecipano.
 *  R5 = [.., totale in staking, numero di partecipanti, ..]; il totale si
 *  verifica contro i token davvero presenti nel box. */
export function readStakeState(box: BoxLike, stateTokenId: string): StakeState | null {
  const staked = (box.assets ?? []).find(a => a.tokenId !== stateTokenId)
  if (!staked) return null
  const r5 = (box.additionalRegisters as Record<string, { renderedValue?: string }> | undefined)?.R5?.renderedValue
  let stakers: number | null = null
  if (r5) {
    const nums = r5.replace(/[[\]]/g, '').split(',').map(s => Number(s.trim()))
    if (nums.length >= 3 && Number.isFinite(nums[2]!)) stakers = nums[2]!
  }
  return { total: BigInt(staked.amount), stakers }
}

/** Una posizione ricostruita, con dichiarato quello che non si sa. */
export interface StakePosition {
  dao: string
  keyId: string
  stakedTokenId: string
  stakedName: string | null
  stakedDecimals: number
  deposited: bigint          // somma NETTA delle operazioni di questo utente
  operations: number
  since: number              // data della prima operazione
  poolTotal: bigint
  poolStakers: number | null
  /** true quando le transazioni del contratto sono più di quelle lette:
   *  il depositato potrebbe essere incompleto, e va detto invece che taciuto. */
  partial: boolean
}

/** PURA: mette insieme le operazioni di UNA chiave in una posizione.
 *  Restituisce null quando il netto non è positivo: chi ha ritirato tutto
 *  tiene ancora la chiave nel wallet, ma non ha niente in staking — e una
 *  scheda che dice «Depositato: 0» è rumore, non informazione. */
export function buildPosition(dao: string, keyId: string, ops: StakeOp[], state: StakeState, partial = false): StakePosition | null {
  if (!ops.length) return null
  const netto = ops.reduce((s, o) => s + o.delta, 0n)
  if (netto <= 0n) return null
  const first = ops[0]!
  return {
    dao, keyId,
    stakedTokenId: first.stakedTokenId,
    stakedName: first.stakedName,
    stakedDecimals: first.stakedDecimals,
    deposited: netto,
    operations: ops.length,
    since: Math.min(...ops.map(o => o.at)),
    poolTotal: state.total,
    poolStakers: state.stakers,
    partial,
  }
}
