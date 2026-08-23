import { api, ergPrice, spectrumTokenPerErg } from '../api/explorer'
import { esc, addrLink, labelOf } from './html'
import { icons } from '../icons'
import { donut, hbars } from '../charts'
import { L, getLang } from '../i18n'
import type { Slice, HBar } from '../charts'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { decode } from '../decoder/index'
import type { Tx } from '../api/types'

const loc = () => getLang() === 'it' ? 'it-IT' : 'en-US'

const PAGE = 20
const TOKENS_COLLAPSED = 12
const COMPOSITION_SLICES = 4  // ERG + i primi token per valore; il resto aggregato

export interface CompositionSlice { label: string; erg: number }
export interface WalletComposition { slices: CompositionSlice[]; pricedCount: number; unpricedCount: number; totalErg: number }

/** PURA: composizione del valore del wallet in ERG. I token senza prezzo restano FUORI
 *  dal grafico (un valore ignoto non si disegna) e vengono dichiarati a parte. */
export function walletComposition(
  nanoErgs: bigint,
  tokens: { tokenId: string; name?: string | null; amount: number | string; decimals?: number | null }[],
  tokenPerErg: Map<string, number>,
  maxSlices = COMPOSITION_SLICES,
): WalletComposition {
  const ergBalance = Number(nanoErgs / 1_000n) / 1e6
  const priced: CompositionSlice[] = []
  let unpricedCount = 0
  for (const t of tokens) {
    const rate = tokenPerErg.get(t.tokenId)
    if (!rate || rate <= 0) { unpricedCount++; continue }
    const units = Number(BigInt(t.amount)) / 10 ** (t.decimals ?? 0)
    const erg = units / rate
    if (erg > 0) priced.push({ label: t.name?.trim() || t.tokenId.slice(0, 8) + '…', erg })
  }
  priced.sort((a, b) => b.erg - a.erg)
  const head = priced.slice(0, maxSlices)
  const tail = priced.slice(maxSlices)
  const slices: CompositionSlice[] = [{ label: 'ERG', erg: ergBalance }, ...head]
  if (tail.length) slices.push({ label: `${L.others_d} ${tail.length} ${L.priced_tokens}`, erg: tail.reduce((s2, x) => s2 + x.erg, 0) })
  return { slices, pricedCount: priced.length, unpricedCount, totalErg: slices.reduce((s2, x) => s2 + x.erg, 0) }
}

let lastComposition: { comp: WalletComposition; usd: number | null } | null = null

/** Disegna la ciambella dentro [data-composition] dopo il render. */
export function mountWalletChart(): void {
  const host = document.querySelector('[data-composition]') as HTMLElement | null
  if (!host || !lastComposition) return
  const { comp, usd } = lastComposition
  // se un solo spicchio è ≥97%, una ciambella è un numero travestito da grafico:
  // meglio due barre che mostrano il rapporto per quello che è
  const domPct = Math.max(...comp.slices.map(sl => sl.erg)) / (comp.totalErg || 1) * 100
  if (domPct >= 97) {
    const tokensErg = comp.slices.filter(sl => sl.label !== 'ERG').reduce((s2, sl) => s2 + sl.erg, 0)
    const ergSlice = comp.slices.find(sl => sl.label === 'ERG')
    const bars: HBar[] = [
      { label: 'ERG', value: (ergSlice?.erg ?? 0) / (comp.totalErg || 1) * 100,
        tipLine: `≈ ${(ergSlice?.erg ?? 0).toLocaleString(loc(), { maximumFractionDigits: 2 })} ERG` },
      { label: `${L.priced_tokens} (${comp.pricedCount})`, value: tokensErg / (comp.totalErg || 1) * 100, rest: true,
        tipLine: `≈ ${tokensErg.toLocaleString(loc(), { maximumFractionDigits: 2 })} ERG in tutto` },
    ]
    hbars(host, bars, 100)
    return
  }
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--accent)', 'var(--text-3)', 'var(--s-rest)']
  const slices: Slice[] = comp.slices.map((sl, i) => ({
    label: sl.label,
    value: sl.erg,
    color: sl.label.startsWith(L.others_d + ' ') ? 'var(--s-rest)' : colors[i % colors.length]!,
    tipLine: `≈ ${sl.erg.toLocaleString(loc(), { maximumFractionDigits: 2 })} ERG`,
    approx: usd ? `≈ ${Math.round(sl.erg * usd).toLocaleString(loc())} $` : undefined,
  }))
  donut(host, slices,
    `≈ ${Math.round(comp.totalErg).toLocaleString(loc())} ERG`,
    L.est_value)
}

/** Ordinamento stabile del portafoglio: con nome prima (alfabetico), senza nome in fondo (per id). */
export function sortWalletTokens<T extends { tokenId: string; name?: string | null }>(tokens: T[]): T[] {
  return [...tokens].sort((a, b) => {
    const an = a.name?.trim() ?? '', bn = b.name?.trim() ?? ''
    if (!!an !== !!bn) return an ? -1 : 1
    return an ? an.localeCompare(bn, 'it', { sensitivity: 'base' }) : a.tokenId.localeCompare(b.tokenId)
  })
}

/** Flusso netto della transazione per QUESTO indirizzo (out - in), in nanoERG. */
function netFlow(tx: Tx, addr: string): bigint {
  const inSum = tx.inputs.filter(b => b.address === addr).reduce((s, b) => s + BigInt(b.value), 0n)
  const outSum = tx.outputs.filter(b => b.address === addr).reduce((s, b) => s + BigInt(b.value), 0n)
  return outSum - inSum
}

/** PURA: variazione dei token per QUESTO indirizzo (ricevuti − spesi), per token.
 *  È quello che rende leggibile un acquisto: l'ERG netto è ~0, i token no. */
export interface TokenDelta { tokenId: string; name: string | null; decimals: number; delta: bigint }
export function tokenDeltas(tx: Tx, addr: string): TokenDelta[] {
  const m = new Map<string, TokenDelta>()
  const add = (assets: { tokenId: string; amount: number | string; name?: string | null; decimals?: number | null }[] | undefined, sign: 1n | -1n) => {
    for (const a of assets ?? []) {
      const cur = m.get(a.tokenId) ?? { tokenId: a.tokenId, name: null, decimals: a.decimals ?? 0, delta: 0n }
      cur.delta += sign * BigInt(a.amount)
      if (a.name?.trim() && !cur.name) cur.name = a.name.trim()
      m.set(a.tokenId, cur)
    }
  }
  for (const b of tx.outputs) if (b.address === addr) add(b.assets, 1n)
  for (const b of tx.inputs) if (b.address === addr) add(b.assets, -1n)
  return [...m.values()].filter(d => d.delta !== 0n)
}

/** Etichetta corta di protocollo per la lista movimenti (il dettaglio sta nel title). */
const PROTO_LABEL: Record<string, string> = {
  'spectrum-n2t': 'Spectrum', sigmausd: 'SigmaUSD', 'rosen-in': 'Rosen Bridge', 'rosen-out': 'Rosen Bridge',
}

/** La controparte "protagonista": il maggiore box dell'altro lato, fee esclusa. */
function counterparty(tx: Tx, addr: string, incoming: boolean): string | null {
  const side = incoming ? tx.inputs : tx.outputs
  const others = side.filter(b => b.address !== addr && b.address !== FEE_ADDRESS)
  if (!others.length) return null
  return others.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b)).address
}

export async function addressView(addr: string, offset = 0): Promise<string> {
  const [balance, txs, price, perErg] = await Promise.all([
    api.addressBalance(addr), api.addressTxs(addr, offset, PAGE), ergPrice(), spectrumTokenPerErg(),
  ])
  const nano = BigInt(balance.nanoErgs)
  const usd = price ? ` <span class="fiat">≈ ${(Number(nano / 1_000_000n) / 1000 * price.usd).toLocaleString(loc(), { maximumFractionDigits: 2 })} $</span>` : ''
  const tokens = balance.tokens ?? []
  const label = labelOf(addr)

  // solo per ORDINARE i token per grandezza percepita: la precisione qui non conta
  const unitMag = (t: TokenDelta) => Math.abs(Number(t.delta)) / 10 ** t.decimals
  const tokName = (t: TokenDelta) => t.name ? esc(t.name) : shortId(t.tokenId, 6, 4)
  const tokAmt = (t: TokenDelta) => (t.delta > 0n ? '+' : '') + formatTokenAmount(t.delta, t.decimals)

  const rows = txs.items.map(tx => {
    const net = netFlow(tx, addr)
    const deltas = tokenDeltas(tx, addr).sort((a, b) => unitMag(b) - unitMag(a))
    // l'ERG comanda la riga solo se si vede a 2 decimali; sennò comanda il token più grande
    const ergVisible = net >= 5_000_000n || net <= -5_000_000n
    const dom = !ergVisible && deltas.length ? deltas[0]! : null
    const incoming = dom ? dom.delta > 0n : net > 0n
    const d = decode(tx)
    const proto = d ? PROTO_LABEL[d.kind] : undefined

    // movimento: per i protocolli riconosciuti il tag batte l'indirizzo del contratto
    const isSwap = d?.kind === 'spectrum-n2t'
    const arrow = isSwap ? '<span class="a swap">⇄</span>'
      : `<span class="a ${incoming ? 'in' : 'out'}">${incoming ? '↓' : '↑'}</span>`
    const cp = counterparty(tx, addr, incoming)
    const who = proto
      ? `<span class="tag proto" title="${esc(d!.headline)}">${proto}</span>`
      : `${incoming ? L.from_w : L.to_w} ${cp ? addrLink(cp) : `<span class="dim">${L.many_parties}</span>`}`

    // importo: la cosa più grande in evidenza, il resto in piccolo — mai un "+0 ERG" muto
    const main = dom
      ? `<span class="val ${incoming ? 'in' : 'out'}">${tokAmt(dom)} ${tokName(dom)}</span>`
      : `<span class="val ${incoming ? 'in' : 'out'}">${net > 0n ? '+' : ''}${formatErg(net, ergVisible ? 2 : 4)}</span>`
    const rest = deltas.filter(t => t !== dom).slice(0, 2)
    const more = deltas.length - (dom ? 1 : 0) - rest.length
    const sub = rest.length
      ? `<div class="tokd">${rest.map(t => `<span class="${t.delta > 0n ? 'in' : 'out'}">${tokAmt(t)} ${tokName(t)}</span>`).join(' · ')}${more > 0 ? ` · +${more} ${L.others_d}` : ''}</div>`
      : ''

    return `<tr data-dir="${incoming ? 'in' : 'out'}">
      <td class="when" title="${isoUtc(tx.timestamp)}"><a href="#/tx/${esc(tx.id)}" class="dim">${relativeTime(tx.timestamp)}</a></td>
      <td class="dir">${arrow} ${who}</td>
      <td class="num">${main}${sub}</td>
    </tr>`
  }).join('')

  const comp = walletComposition(nano, tokens, perErg)
  const showComposition = comp.pricedCount >= 1 && comp.slices.length >= 2
  lastComposition = showComposition ? { comp, usd: price?.usd ?? null } : null
  const compositionCard = showComposition ? `
  <div class="card"><div class="card-head"><h2>${L.composition}</h2>
      <p>${L.composition_p1}
      ${comp.unpricedCount ? `${comp.unpricedCount} ${L.composition_p2}` : ''}</p></div>
    <div class="chart-wrap" data-composition></div>
  </div>` : ''

  const page = Math.floor(offset / PAGE) + 1
  const pages = Math.max(1, Math.ceil(txs.total / PAGE))
  document.title = `${label ?? shortId(addr, 10)} · Robespierre`

  const sorted = sortWalletTokens(tokens)
  const tokenRow = (t: typeof tokens[number], hidden: boolean) =>
    `<tr${hidden ? ' class="tok-extra hidden"' : ''}><td><a href="#/token/${esc(t.tokenId)}" title="${esc(L.opens_card)}">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a>${t.name?.trim() ? '' : ` <span class="tag">${L.unnamed}</span>`}</td>
     <td class="num">${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0)}</td></tr>`
  const tokenRows = sorted.map((t, i) => tokenRow(t, i >= TOKENS_COLLAPSED)).join('')

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1 class="${label ? '' : 'mono'}" style="font-size:${label ? 22 : 17}px">${label ? esc(label) : esc(shortId(addr, 12, 6))}</h1>
      <button class="copy" data-copy="${esc(addr)}">${L.copy}</button>
      <a class="btn-link" href="https://explorer.ergoplatform.com/en/addresses/${esc(addr)}" target="_blank" rel="noopener">${icons.ext}${L.verify_official}</a>
      ${label ? `<span class="dim mono">${esc(shortId(addr, 10))}</span>` : `<span class="dim">${L.no_label}</span>`}
    </div>
    <div class="tiles">
      <div><div class="k">${L.balance}</div><div class="v">${formatErg(nano)}</div><div class="s">${usd || '&nbsp;'}</div></div>
      <div><div class="k">${L.tokens_h}</div><div class="v">${tokens.length} ${L.tokens_n}</div><div class="s"><a href="#tokens" data-scroll>${L.to_list}</a></div></div>
      <div><div class="k">${L.movements}</div><div class="v">${groupThousands(String(txs.total))}</div>
        <div class="s">${txs.items[0] ? L.last + ' ' + relativeTime(txs.items[0].timestamp) : ''}</div></div>
      <div><div class="k">${L.page_k}</div><div class="v">${page} ${L.of} ${groupThousands(String(pages))}</div><div class="s">${PAGE} ${L.per_page}</div></div>
    </div>
  </div>
  ${compositionCard}
  ${tokens.length ? `<div class="card" id="tokens"><div class="card-head" style="display:flex;align-items:baseline;gap:10px"><h2>${L.tokens_h} — ${tokens.length}</h2>
      <span class="dim" style="font-size:13px">${L.opens_card}</span></div>
    <table><tbody>${tokenRows}</tbody></table>
    ${tokens.length > TOKENS_COLLAPSED ? `<div class="card-pad" style="padding-top:10px">
      <button class="btn" data-toggle-tokens data-full="${L.show_all} ${tokens.length} ${L.tokens_w}" type="button">${icons.down}<span data-label>${L.show_all} ${tokens.length} ${L.tokens_w}</span></button></div>` : ''}</div>` : ''}
  <div data-rent></div>
  <div class="card">
    <div class="card-pad chips" style="padding-bottom:0">
      <button class="chip" aria-pressed="true" data-mov="all" type="button">${L.mov_all}</button>
      <button class="chip" aria-pressed="false" data-mov="in" type="button">${L.mov_in}</button>
      <button class="chip" aria-pressed="false" data-mov="out" type="button">${L.mov_out}</button>
      <span class="dim" style="font-size:12px">${L.mov_note}</span>
    </div>
    <table>
      <thead><tr><th style="width:130px">${L.th_when}</th><th>${L.th_mov}</th><th class="num" style="width:190px">${L.th_net}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="dim">${L.no_movements}</td></tr>`}</tbody>
    </table>
    <div class="pager">
      <span><strong>${groupThousands(String(txs.total))}</strong> ${L.movements.toLowerCase()}</span>
      <span style="display:flex;gap:10px">
        <button data-nav="#/address/${esc(addr)}/${Math.max(0, offset - PAGE)}" ${offset === 0 ? 'disabled' : ''}>${L.more_recent}</button>
        <button data-nav="#/address/${esc(addr)}/${offset + PAGE}" ${offset + PAGE >= txs.total ? 'disabled' : ''}>${L.older}</button>
      </span>
    </div>
  </div>`
}

/* ---------------- affitto di deposito (storage rent) ---------------- */

/** Parametri di rete: 1.250.000 nanoERG per byte, ogni 1.051.200 blocchi (~4 anni). */
export const RENT = {
  periodBlocks: 1_051_200,       // 4 anni di blocchi da 2 minuti
  soonBlocks: 919_800,           // 3 anni e mezzo: preavviso
  typicalBoxNano: 131_250_000n,  // ~105 byte × 1.250.000 nanoERG/byte
  maxPages: 3,                   // fino a 300 box controllati, dichiarato
} as const

/** PURA: conta i box già in riscossione e quelli che ci arriveranno presto. */
export function classifyRent(creationHeights: number[], tipHeight: number): { paying: number; soon: number } {
  let paying = 0, soon = 0
  for (const h of creationHeights) {
    const age = tipHeight - h
    if (age >= RENT.periodBlocks) paying++
    else if (age >= RENT.soonBlocks) soon++
  }
  return { paying, soon }
}

/** Dopo il render: legge fino a 300 box non spesi e mostra la card solo se c'è qualcosa da dire. */
export async function mountRentCheck(addr: string): Promise<void> {
  const slot = document.querySelector('[data-rent]') as HTMLElement | null
  if (!slot) return
  try {
    const tip = (await api.info()).height
    const heights: number[] = []
    let total = 0
    for (let p = 0; p < RENT.maxPages; p++) {
      const r = await fetch(`https://api.ergoplatform.com/api/v1/boxes/unspent/byAddress/${encodeURIComponent(addr)}?limit=100&offset=${p * 100}`)
      if (!r.ok) return
      const j = await r.json() as { items?: { creationHeight?: number }[]; total?: number }
      total = j.total ?? 0
      for (const b of j.items ?? []) if (typeof b.creationHeight === 'number') heights.push(b.creationHeight)
      if ((j.items?.length ?? 0) < 100) break
    }
    const { paying, soon } = classifyRent(heights, tip)
    if (!paying && !soon) return
    const line = paying
      ? L.rent_warn(paying, formatErg(RENT.typicalBoxNano, 2))
      : L.rent_soon(soon)
    const partial = total > heights.length ? ` <span class="dim">(${L.rent_note} ${heights.length} ${L.rent_note2})</span>` : ''
    slot.outerHTML = `<div class="card"><div class="card-head"><h2>${L.rent_h}</h2><p>${esc(L.rent_p)}</p></div>
      <div class="card-pad" style="padding-top:0"><div class="check"><span class="sig ${paying ? 'warn' : 'info'}">${paying ? '⚠' : '·'}</span>
      <span>${esc(line)}${partial}</span></div></div></div>`
  } catch { /* niente da dire: la card semplicemente non appare */ }
}
