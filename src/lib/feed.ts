/**
 * «Adesso sulla catena» — le parti PURE del flusso della home: categorie,
 * pre-selezione della routine di rete, evidenza degli importi, la frase del titolo.
 * Tutto testato su dati veri in feed.test.ts; la rete sta in views/feed.ts.
 */
import { MINING, ORACLE } from '../decoder/protocols'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc } from '../views/html'
import { shortId } from './format'

export type Category = 'transfer' | 'defi' | 'bridge' | 'stable' | 'raw' | 'routine' | 'other'
/** Le categorie dei filtri, nell'ordine in cui compaiono. */
export const CATEGORIES: readonly Category[] = ['transfer', 'defi', 'bridge', 'stable', 'raw']

/** La categoria di una lettura. null = il decodificatore ha taciuto. */
export function categoryOf(kind: string | null): Category {
  if (kind == null) return 'raw'
  if (kind.startsWith('mining-') || kind.startsWith('oracle-')) return 'routine'
  if (kind === 'transfer' || kind === 'wallet-internal' || kind === 'fee-only') return 'transfer'
  if (kind.startsWith('spectrum-')) return 'defi'
  if (kind.startsWith('rosen-')) return 'bridge'
  if (kind === 'sigmausd') return 'stable'
  return 'other'                 // un riconoscitore nuovo compare in «Tutte» finché non ha un filtro
}

/** La chiave della sigla di riga (i18n). */
export type TagKey = 'tag_transfer' | 'tag_wallet' | 'tag_fee' | 'tag_spectrum' | 'tag_rosen'
  | 'tag_sigmausd' | 'tag_oracle' | 'tag_mining' | 'tag_raw'
export function tagKeyOf(kind: string | null): TagKey {
  if (kind == null) return 'tag_raw'
  if (kind.startsWith('mining-')) return 'tag_mining'
  if (kind.startsWith('oracle-')) return 'tag_oracle'
  if (kind === 'wallet-internal') return 'tag_wallet'
  if (kind === 'fee-only') return 'tag_fee'
  if (kind.startsWith('spectrum-')) return 'tag_spectrum'
  if (kind.startsWith('rosen-')) return 'tag_rosen'
  if (kind === 'sigmausd') return 'tag_sigmausd'
  return 'tag_transfer'
}

/**
 * PRE-SELEZIONE della routine di rete, sui dati LEGGERI del blocco.
 *
 * Perché serve: la risposta di /blocks/{id} non porta i token degli input, e senza
 * quelli il decodificatore non si può usare (legge l'NFT della banca, del pool,
 * dell'emissione proprio negli input). Scaricare ogni transazione per intero costa
 * una richiesta l'una, e mining e oracoli sono l'80% del traffico: la home ne
 * farebbe cinque volte di più per mostrare righe che poi nasconde.
 *
 * Qui si riconosce la routine da ciò che il blocco porta davvero — i token degli
 * OUTPUT e gli indirizzi degli input — e solo per forme inequivocabili: un gettone
 * dell'oracolo o l'NFT dell'emissione in un output, o input tutti del contratto
 * delle commissioni. Non è una lettura e non si mostra come tale: decide soltanto
 * cosa NON scaricare subito. Una transazione di routine che sfugge viene scaricata
 * e letta dal decodificatore vero; una che venisse presa per routine per sbaglio
 * resterebbe nascosta, mai raccontata male — e «mostrale» la scarica e la legge.
 */
const ROUTINE_TOKENS = new Set<string>([
  MINING.emissionNft, MINING.reemissionNft,
  ORACLE.ergUsdNft, ORACLE.ergUsdPt,
  ORACLE.usd.poolNft, ORACLE.usd.refreshNft, ORACLE.usd.oracleToken,
  ORACLE.gold.poolNft, ORACLE.gold.refreshNft, ORACLE.gold.oracleToken,
])
export interface LightTx {
  id: string
  inputs: { address: string }[]
  outputs: { address: string; assets?: { tokenId: string }[] }[]
}
export function looksRoutine(tx: LightTx): boolean {
  if (tx.inputs.length && tx.inputs.every(b => b.address === FEE_ADDRESS)) return true
  return tx.outputs.some(o => o.address === MINING.payToReemissionAddress
    || (o.assets ?? []).some(a => ROUTINE_TOKENS.has(a.tokenId)))
}

/**
 * La frase del titolo, DAI DATI. La proposta grafica scriveva «Due transazioni su
 * tre» a mano: la misura si ripete ogni domenica, e il numero cambia. Una frase
 * scritta a mano sarebbe diventata falsa la prima settimana in cui il numero si
 * muove — per un explorer che promette di non indovinare, il titolo della home.
 *
 * Si sceglie la frazione col denominatore più piccolo entro 2 punti dal vero; se il
 * vero sta sotto, si dice «quasi» (66,4% è quasi due su tre, non due su tre).
 */
export function fractionOf(p: number): { num: number; den: number; q: '' | 'quasi' | 'oltre' } {
  const x = Math.min(0.99, Math.max(0.01, p))
  let best: { num: number; den: number } | null = null
  for (let den = 2; den <= 10 && !best; den++) {
    const num = Math.round(x * den)
    if (num >= 1 && num < den && Math.abs(x - num / den) <= 0.02) best = { num, den }
  }
  if (!best) {                                   // nessuna entro 2 punti: la più vicina fra i decimi
    const num = Math.min(9, Math.max(1, Math.round(x * 10)))
    best = { num, den: 10 }
  }
  // frazione ridotta: 4/10 si dice 2/5
  const g = gcd(best.num, best.den)
  const num = best.num / g, den = best.den / g
  const diff = p - num / den
  return { num, den, q: diff < -0.002 ? 'quasi' : diff > 0.002 ? 'oltre' : '' }
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a }

/** Regex di una cifra scritta da format.ts, in italiano o in inglese: 1.234,56 · 1,234.56 · 0,0011 */
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?`
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Gli importi in grassetto dentro una frase GIÀ ESCAPATA: solo «cifra + unità»,
 * dove l'unità è ERG, $ o il nome di un token che compare davvero nella
 * transazione. Così «blocco 1.834.215» o «3 destinatari» restano testo normale.
 */
export function markAmounts(escaped: string, units: string[]): string {
  const us = [...new Set(['ERG', '$', ...units.map(u => u.trim()).filter(Boolean)])]
    .map(u => reEsc(esc(u))).sort((a, b) => b.length - a.length)
  const re = new RegExp(`(^|[^\\w.,])(${NUM})(\\s)(${us.join('|')})(?![\\w])`, 'g')
  return escaped.replace(re, (_m, pre: string, n: string, sp: string, u: string) => `${pre}<strong class="amt-b">${n}${sp}${u}</strong>`)
}

/** Gli indirizzi accorciati della frase diventano link alla loro pagina (solo quelli
 *  che compaiono davvero fra input e output: niente link indovinati). */
export function linkAddresses(escaped: string, addresses: string[]): string {
  let out = escaped
  for (const a of new Set(addresses)) {
    for (const head of [8, 6, 10]) {
      const s = esc(shortId(a, head))
      const i = out.indexOf(s)
      if (i < 0 || s.length >= a.length) continue
      out = out.slice(0, i) + `<a href="#/address/${esc(a)}" title="${esc(a)}">${s}</a>` + out.slice(i + s.length)
      break
    }
  }
  return out
}

/** Tempo trascorso, corto, per la colonna del flusso: «38 s», «4 min», «2 h». */
export function shortAgo(tsMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - tsMs) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`
}
