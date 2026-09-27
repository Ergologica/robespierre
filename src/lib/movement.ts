import type { Tx, Asset } from '../api/types'

/**
 * CHI HA DATO COSA A CHI — calcolato per differenza, non per posizione nel box.
 *
 * Nasce da un difetto vero, trovato nella pagina che è il simbolo del progetto.
 * I riquadri sopra la transazione contavano «i token finiti in un box il cui
 * indirizzo non compare fra gli ingressi». Su una transazione con contratti
 * quell'insieme è quasi sempre vuoto: la banca di SigmaUSD, il pool di
 * Spectrum e il wallet di chi firma compaiono tutti e tre sia in entrata che in
 * uscita, perché un box speso viene ricreato. Risultato: su un mint di 800.000
 * SigRSV la pagina scriveva «Token spostati: 0 tipi» sotto una frase che
 * diceva esattamente il contrario, e come numero grande mostrava 1.695.133 ERG,
 * cioè quanto c'è DENTRO la banca, non quanto si è mosso.
 *
 * Qui si fa l'unica cosa che regge su una catena UTXO: per ogni indirizzo si
 * somma quello che esce e si sottrae quello che entra. Il resto che torna al
 * mittente si annulla da solo, perché parte e arriva allo stesso indirizzo.
 * Quello che avanza è il movimento vero.
 */

/** Un token che ha davvero cambiato mano, con quanto ne è passato. */
export interface Moved { tokenId: string; name: string | null; decimals: number; amount: bigint }

export interface Movement {
  /** Quanto ERG ha cambiato mano: la somma dei saldi positivi, commissione esclusa. */
  ergMoved: bigint
  /** La somma dei box in uscita: enorme sulle transazioni con contratti, e dichiarata come tale. */
  totalOut: bigint
  fee: bigint
  /** I token che hanno cambiato mano, dal più "grande" movimento in giù. */
  tokens: Moved[]
  payer: string | null
  receiver: string | null
  /** I token arrivati al ricevente principale. */
  receiverTokens: Moved[]
  /** Un pagante e un ricevente spiegano quasi tutto il movimento: il flusso si può disegnare.
   *  Quando è falso la pagina TACE invece di eleggere a destinatario un box di resto da 0,02 ERG. */
  clear: boolean
}

/** Sopra questa quota un solo indirizzo "è" il pagante (o il ricevente). */
export const DOMINANT = 0.9
/** Sotto questo ERG il movimento in ERG è polvere: conta quello che hanno fatto i token. */
export const DUST_NANO = 10_000_000n   // 0,01 ERG

function bump<K>(m: Map<K, bigint>, k: K, v: bigint): void { m.set(k, (m.get(k) ?? 0n) + v) }

/** PURA: il movimento netto di una transazione. */
export function txMovement(tx: Tx, feeAddress: string): Movement {
  const erg = new Map<string, bigint>()
  const tok = new Map<string, bigint>()            // "tokenId|address"
  const meta = new Map<string, Asset>()            // tokenId → nome e decimali, come li dà la catena

  const scan = (boxes: Tx['inputs'], segno: 1n | -1n) => {
    for (const b of boxes) {
      if (b.address === feeAddress) continue       // la commissione ha il suo riquadro
      bump(erg, b.address, segno * BigInt(b.value))
      for (const a of b.assets ?? []) {
        bump(tok, a.tokenId + '|' + b.address, segno * BigInt(a.amount))
        if (!meta.has(a.tokenId)) meta.set(a.tokenId, a)
      }
    }
  }
  scan(tx.outputs, 1n)
  scan(tx.inputs, -1n)

  const fee = tx.outputs.filter(o => o.address === feeAddress).reduce((s, o) => s + BigInt(o.value), 0n)
  const totalOut = tx.outputs.reduce((s, o) => s + BigInt(o.value), 0n)

  const saldi = [...erg].filter(([, v]) => v !== 0n)
  const entrate = saldi.filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1))
  const uscite = saldi.filter(([, v]) => v < 0n).sort((a, b) => (a[1] > b[1] ? 1 : -1))
  const ergMoved = entrate.reduce((s, [, v]) => s + v, 0n)
  const usciteTot = uscite.reduce((s, [, v]) => s + v, 0n)

  // quanto è passato di mano per ogni token: la somma dei saldi positivi
  const perToken = new Map<string, bigint>()
  const perTokenAddr = new Map<string, bigint>()   // per trovare a chi sono arrivati
  for (const [k, v] of tok) {
    if (v <= 0n) continue
    const [id, addr] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
    bump(perToken, id, v)
    bump(perTokenAddr, addr, 1n)                   // quanti token diversi arrivano a questo indirizzo
  }
  const tokens: Moved[] = [...perToken].map(([tokenId, amount]) => {
    const a = meta.get(tokenId)
    return { tokenId, name: a?.name?.trim() || null, decimals: a?.decimals ?? 0, amount }
  }).sort((x, y) => (y.amount > x.amount ? 1 : -1))

  // Chi paga e chi riceve. Con l'ERG che si muove decidono i saldi in ERG;
  // quando l'ERG è polvere (un trasferimento di soli token) decidono i token.
  let payer: string | null = null, receiver: string | null = null, clear = false
  if (ergMoved > DUST_NANO && entrate.length && uscite.length) {
    payer = uscite[0]![0]; receiver = entrate[0]![0]
    clear = Number(uscite[0]![1]) / Number(usciteTot) >= DOMINANT
      && Number(entrate[0]![1]) / Number(ergMoved) >= DOMINANT
  } else if (tokens.length) {
    const arrivi = [...perTokenAddr].sort((a, b) => Number(b[1]) - Number(a[1]))
    const partenze = new Map<string, bigint>()
    for (const [k, v] of tok) if (v < 0n) bump(partenze, k.slice(k.indexOf('|') + 1), -v)
    const uscenti = [...partenze].sort((a, b) => (b[1] > a[1] ? 1 : -1))
    if (arrivi.length === 1 && uscenti.length === 1) {
      receiver = arrivi[0]![0]; payer = uscenti[0]![0]; clear = true
    }
  }

  const receiverTokens = receiver
    ? tokens.filter(t => (tok.get(t.tokenId + '|' + receiver) ?? 0n) > 0n)
    : []

  return { ergMoved, totalOut, fee, tokens, payer, receiver, receiverTokens, clear }
}
