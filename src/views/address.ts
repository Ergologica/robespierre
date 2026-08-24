import { api, ergPrice, ergHistoryUsd } from '../api/explorer'
import { tokenPrices } from '../lib/prices'
import { esc, addrLink, labelOf } from './html'
import { icons } from '../icons'
import { donut } from '../charts'
import { L, getLang } from '../i18n'
import type { Slice } from '../charts'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId, formatPct } from '../lib/format'
import { fmtPrice } from './markets'
import { THIN_POOL_ERG } from '../lib/prices'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { decode } from '../decoder/index'
import { isCurrent } from '../lib/nav'
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
  // se un solo spicchio è ≥97% NON si disegna niente: due barre di cui una al
  // 99,94% sono una statistica travestita da grafico, e il numero è già la storia
  const domPct = Math.max(...comp.slices.map(sl => sl.erg)) / (comp.totalErg || 1) * 100
  if (domPct >= 97) {
    const ergPct = (comp.slices.find(sl => sl.label === 'ERG')?.erg ?? 0) / (comp.totalErg || 1) * 100
    const tokensErg = comp.slices.filter(sl => sl.label !== 'ERG').reduce((s2, sl) => s2 + sl.erg, 0)
    host.innerHTML = `<p class="stat-line">${esc(L.dominant_line(formatPct(ergPct), formatPct(100 - ergPct)))}
      <span class="dim">— ${esc(L.dominant_sub(comp.pricedCount, tokensErg.toLocaleString(loc(), { maximumFractionDigits: 2 })))}${usd != null ? ' · ' + esc(L.total_value.toLowerCase()) + ' ≈ ' + Math.round(comp.totalErg * usd).toLocaleString(loc()) + ' $' : ''}</span></p>`
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
  const [balance, txs, price, prices] = await Promise.all([
    api.addressBalance(addr), api.addressTxs(addr, offset, PAGE), ergPrice(), tokenPrices(),
  ])
  // un solo prezzo in tutto il sito: la mappa è la stessa dei Mercati
  const perErg = new Map([...prices].map(([id, p]) => [id, 1 / p.ergPerToken]))
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
  // il numero per cui si apre una pagina wallet: quanto vale in tutto.
  // Somma ERG + token CON PREZZO; i senza-prezzo sono dichiarati, non stimati a zero.
  const totalUsd = price ? comp.totalErg * price.usd : null
  const totalStr = totalUsd != null
    ? Math.round(totalUsd).toLocaleString(loc()) + ' $'
    : formatPct(comp.totalErg, 2) + ' ERG'
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
  // prezzo e valore dai pool Spectrum: indicativi, "—" quando il prezzo non c'è
  const priceCells = (t: typeof tokens[number]) => {
    const p = prices.get(t.tokenId)
    if (!p) return '<td class="num dim">—</td><td class="num dim">—</td>'
    const priceErg = p.ergPerToken
    const units = Number(BigInt(t.amount)) / 10 ** (t.decimals ?? 0)
    const valErg = units * priceErg
    const pStr = price ? fmtPrice(priceErg * price.usd) + ' $' : fmtPrice(priceErg) + ' ERG'
    const usdVal = price ? valErg * price.usd : null
    const v = usdVal != null
      ? (usdVal > 0 && usdVal < 1 ? '<1 $' : groupThousands(String(Math.round(usdVal))) + ' $')
      : formatPct(valErg, 2) + ' ERG'
    const cls = p.thin ? 'num dim' : 'num'
    const tip = p.thin ? esc(L.thin_tip(groupThousands(String(Math.round(p.volCumErg))), THIN_POOL_ERG)) : ''
    return `<td class="${cls}" title="${tip}">${pStr}${p.thin ? ' <span class="tag">' + L.thin_pool + '</span>' : ''}</td><td class="${cls}">${v}</td>`
  }
  const tokenRow = (t: typeof tokens[number], hidden: boolean) =>
    `<tr${hidden ? ' class="tok-extra hidden"' : ''}><td><a href="#/token/${esc(t.tokenId)}" title="${esc(L.opens_card)}">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a>${t.name?.trim() ? '' : ` <span class="tag">${L.unnamed}</span>`}</td>
     <td class="num">${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0)}</td>${priceCells(t)}</tr>`
  const tokenRows = sorted.map((t, i) => tokenRow(t, i >= TOKENS_COLLAPSED)).join('')
  const unpricedN = tokens.filter(t => !prices.has(t.tokenId)).length
  const thinN = tokens.filter(t => prices.get(t.tokenId)?.thin).length

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1 class="t-title ${label ? '' : 'mono'}">${label ? esc(label) : esc(shortId(addr, 12, 6))}</h1>
      <button class="copy" data-copy="${esc(addr)}">${L.copy}</button>
      <a class="btn-link" href="https://explorer.ergoplatform.com/en/addresses/${esc(addr)}" target="_blank" rel="noopener">${icons.ext}${L.verify_official}</a>
      ${label ? `<span class="dim mono">${esc(shortId(addr, 10))}</span>` : `<span class="dim">${L.no_label}</span>`}
    </div>
    <div class="tiles tiles-w">
      <div class="tile-hero"><div class="k">${L.balance}</div><div class="v">${formatErg(nano)}</div><div class="s">${usd || '&nbsp;'}</div></div>
      ${comp.pricedCount > 0 ? `<div class="tile-total"><div class="k"><span class="help" title="${esc(L.total_tip)}">${L.total_value}</span></div>
        <div class="v">≈ ${totalStr}</div>
        <div class="s">${esc(L.total_sub(comp.pricedCount, comp.unpricedCount))}</div></div>` : ''}
      <div><div class="k">${L.tokens_h}</div><div class="v">${tokens.length} ${L.tokens_n}</div><div class="s"><a href="#tokens" data-scroll>${L.to_list}</a></div></div>
      <div><div class="k">${L.movements}</div><div class="v">${groupThousands(String(txs.total))}</div>
        <div class="s">${txs.items[0] ? L.last + ' ' + relativeTime(txs.items[0].timestamp) : ''}</div></div>
    </div>
  </div>
  ${compositionCard}
  ${tokens.length ? `<div class="card" id="tokens"><div class="card-head" style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><h2>${L.tokens_h} — ${tokens.length}</h2>
      <span class="dim t-note">${L.opens_card}${unpricedN ? ' · ' + L.wallet_priced_note(unpricedN) : ''}${thinN ? ' · ' + esc(L.wallet_thin_note(thinN)) : ''}</span></div>
    <table><thead><tr><th>${L.th_name}</th><th class="num">${L.th_qty}</th><th class="num">${L.price_w}</th><th class="num">${L.value_w}</th></tr></thead><tbody>${tokenRows}</tbody></table>
    ${tokens.length > TOKENS_COLLAPSED ? `<div class="card-pad" style="padding-top:10px">
      <button class="btn" data-toggle-tokens data-full="${L.show_all} ${tokens.length} ${L.tokens_w}" type="button">${icons.down}<span data-label>${L.show_all} ${tokens.length} ${L.tokens_w}</span></button></div>` : ''}</div>` : ''}
  <div data-stake></div>
  <div data-rent></div>
  <div class="card">
    <div class="card-pad chips" style="padding-bottom:0">
      <button class="chip" aria-pressed="true" data-mov="all" type="button">${L.mov_all}</button>
      <button class="chip" aria-pressed="false" data-mov="in" type="button">${L.mov_in}</button>
      <button class="chip" aria-pressed="false" data-mov="out" type="button">${L.mov_out}</button>
      <span class="dim t-cap">${L.mov_note}</span>
      <span class="grow"></span>
      <button class="btn" data-export="${esc(addr)}" type="button">${icons.down}<span data-export-label>${L.export_csv}</span></button>
    </div>
    <table>
      <thead><tr><th style="width:130px">${L.th_when}</th><th>${L.th_mov}</th><th class="num" style="width:190px">${L.th_net}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="dim">${L.no_movements}</td></tr>`}</tbody>
    </table>
    <div class="pager">
      <span><strong>${groupThousands(String(txs.total))}</strong> ${L.movements.toLowerCase()}
        <span class="dim">· ${L.page_k} ${page} ${L.of} ${groupThousands(String(pages))}</span></span>
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
export async function mountRentCheck(addr: string, gen?: number): Promise<void> {
  const slot = document.querySelector('[data-rent]') as HTMLElement | null
  if (!slot) return
  const mine = () => gen == null || isCurrent(gen)   // la pagina è ancora questa?
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
      if (!mine()) return
    }
    if (!mine()) return                              // l'utente è andato altrove: si tace
    const { paying, soon } = classifyRent(heights, tip)
    if (!paying && !soon) return
    const line = paying
      ? L.rent_warn(paying, formatErg(RENT.typicalBoxNano, 2))
      : L.rent_soon(soon)
    const partial = total > heights.length ? ` <span class="dim">(${L.rent_partial(groupThousands(String(heights.length)), groupThousands(String(total)))})</span>` : ''
    slot.outerHTML = `<div class="card"><div class="card-head"><h2>${L.rent_h}</h2><p>${esc(L.rent_p)}</p></div>
      <div class="card-pad" style="padding-top:0"><div class="check"><span class="sig ${paying ? 'warn' : 'info'}">${paying ? '⚠' : '·'}</span>
      <span>${esc(line)}${partial}</span></div></div></div>`
  } catch { /* niente da dire: la card semplicemente non appare */ }
}

/* ---------------- export CSV con controvalori (F4) ---------------- */

export const CSV_CAP = 3000  // tetto dichiarato di movimenti esportati

export interface CsvRow {
  dateUtc: string      // "2026-08-23 10:12:44"
  day: string          // "2026-08-23" per il prezzo
  txId: string
  dirIn: boolean
  who: string          // protocollo riconosciuto o indirizzo controparte
  ergNet: bigint       // nanoERG
  tokens: string       // "+62 DORT | -1 COMET"
}

function csvField(v: string, sep: string): string {
  return v.includes(sep) || v.includes('"') || v.includes('\n') ? '"' + v.replace(/"/g, '""') + '"' : v
}

/** Campi di TESTO che vengono dalla catena (nomi token, indirizzi): un nome coniato
 *  come "=CMD(...)" non deve diventare una formula in Excel. Spazio davanti e via. */
function csvText(v: string, sep: string): string {
  return csvField(/^[=+\-@\t\r]/.test(v) ? ' ' + v : v, sep)
}

/** PURA: righe → testo CSV. it: separatore ';' e decimali con virgola (Excel IT);
 *  en: ',' e punto. Prezzo alla data se la serie lo copre; sennò cella VUOTA. */
export function buildAddressCsv(
  rows: CsvRow[],
  priceByDay: Map<string, number>,
  lang: 'it' | 'en',
  totalMovs: number,
): string {
  const sep = lang === 'it' ? ';' : ','
  const dec = (n: number, digits: number) => {
    const s2 = n.toFixed(digits)
    return lang === 'it' ? s2.replace('.', ',') : s2
  }
  const ergOf = (nano: bigint) => Number(nano) / 1e9
  const out: string[] = []
  out.push(csvField(L.csv_disclaimer, sep))
  out.push([L.csv_date, L.csv_tx, L.csv_dir, L.csv_who, L.csv_erg, L.csv_tokens, L.csv_price, L.csv_value]
    .map(h => csvField(h, sep)).join(sep))
  for (const r of rows) {
    const p = priceByDay.get(r.day)
    const erg = ergOf(r.ergNet)
    out.push([
      csvField(r.dateUtc, sep), csvField(r.txId, sep), csvField(r.dirIn ? L.csv_in : L.csv_out, sep),
      csvText(r.who, sep),                 // dalla catena
      csvField(dec(erg, 9), sep),
      csvText(r.tokens, sep),              // nomi token: dalla catena
      csvField(p != null ? dec(p, 4) : '', sep),
      csvField(p != null ? dec(erg * p, 2) : '', sep),
    ].join(sep))
  }
  if (totalMovs > rows.length) out.push(csvField(L.csv_partial(groupThousands(String(rows.length)), groupThousands(String(totalMovs))), sep))
  return out.join('\r\n')
}

/** Scarica il CSV dell'indirizzo: tutte le pagine fino al tetto, con progresso sul bottone. */
export async function exportAddressCsv(addr: string): Promise<void> {
  const label = document.querySelector('[data-export-label]') as HTMLElement | null
  const set = (t: string) => { if (label) label.textContent = t }
  try {
    set(L.export_ing)
    const [hist, first] = await Promise.all([ergHistoryUsd(), api.addressTxs(addr, 0, 100)])
    const total = first.total
    const cap = Math.min(total, CSV_CAP)
    const txsAll: Tx[] = [...first.items]
    for (let off = 100; off < cap; off += 100) {
      const pg = await api.addressTxs(addr, off, 100)
      txsAll.push(...pg.items)
      set(`${L.export_ing} ${Math.min(100, Math.round(100 * txsAll.length / cap))}%`)
    }
    const rows: CsvRow[] = txsAll.slice(0, cap).map(tx => {
      const net = netFlow(tx, addr)
      const deltas = tokenDeltas(tx, addr)
      const dom = (net < 5_000_000n && net > -5_000_000n) && deltas.length ? deltas[0]! : null
      const dirIn = dom ? dom.delta > 0n : net > 0n
      const d = decode(tx)
      const proto = d ? PROTO_LABEL[d.kind] : undefined
      const cp = counterparty(tx, addr, dirIn)
      const iso = new Date(tx.timestamp).toISOString()
      return {
        dateUtc: iso.replace('T', ' ').slice(0, 19), day: iso.slice(0, 10),
        txId: tx.id, dirIn,
        who: proto ?? cp ?? '',
        ergNet: net,
        tokens: deltas.map(t => `${t.delta > 0n ? '+' : ''}${formatTokenAmount(t.delta, t.decimals)} ${t.name ?? t.tokenId.slice(0, 8)}`).join(' | '),
      }
    })
    const csv = buildAddressCsv(rows, hist, getLang(), total)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `robespierre-${addr.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    set(L.export_done)
    setTimeout(() => set(L.export_csv), 2500)
  } catch {
    set(L.retry)
  }
}
