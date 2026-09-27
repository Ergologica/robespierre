import { api, ergPrice, tokenSearchAnyCase } from '../api/explorer'
import type { PrecomputedHolders } from '../api/explorer'
import { tokenPrices, THIN_POOL_ERG } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { fmtPrice } from './markets'
import { esc, labelOf } from './html'
import { formatTokenAmount, formatPct, groupThousands, shortId } from '../lib/format'
import { hbars } from '../charts'
import { icons } from '../icons'
import { L } from '../i18n'
import type { HBar } from '../charts'
import type { RegValue, BoxLike } from '../api/types'
import { isCurrent } from '../lib/nav'

/** Soglie della pagella: dichiarate qui, discutibili via PR come tutto il resto. */
export const SOGLIE = {
  topHolderWarnPct: 60,     // ⚠ se i primi 10 detengono più di questa quota
  maxBoxesForHolders: 8000, // tetto di box letti dal browser; oltre, il calcolo è dichiarato parziale
  holdersConcurrency: 8,    // richieste parallele verso l'API
  topShown: 10,
} as const

/** Controllo omonimi: quanti altri token portano lo stesso nome. Funzione pura sui dati dell'API. */
export function countHomonyms(items: { id: string; name?: string | null }[], name: string, selfId: string): number {
  const n = name.trim().toLowerCase()
  return items.filter(t => (t.name ?? '').trim().toLowerCase() === n && t.id !== selfId).length
}

/* ---------------- EIP-4: immagine dichiarata al conio ---------------- */

/** PURA: esadecimale → testo UTF-8; null se la stringa non è hex valido. */
export function hexToUtf8(hex: string): string | null {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0 || hex.length === 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

function regHex(reg: RegValue | undefined): string | null {
  if (reg == null) return null
  if (typeof reg === 'string') return reg
  return reg.renderedValue ?? null
}

/** PURA: dai registri del box di conio (EIP-4) all'URL dell'immagine, o null.
 *  R7 = tipo (0101 = immagine), R9 = URL. ipfs:// → gateway pubblico; solo https viene incorporato. */
export function eip4ImageUrl(regs: Record<string, RegValue> | undefined): string | null {
  if (!regs) return null
  const r7 = regs['R7']
  const r7hex = regHex(r7) ?? ''
  const r7ser = (typeof r7 === 'object' && r7?.serializedValue) || ''
  if (r7hex !== '0101' && r7ser !== '0e020101') return null
  const r9 = regHex(regs['R9'])
  if (!r9) return null
  let url = hexToUtf8(r9)?.trim() ?? null
  if (!url) return null
  if (url.startsWith('ipfs://')) url = 'https://ipfs.io/ipfs/' + url.slice('ipfs://'.length).replace(/^ipfs\//, '')
  return url.startsWith('https://') ? url : null
}

/** Il file notturno dei detentori si legge una volta per visita: serve alla testata
 *  (quanti detentori) e al grafico (chi), e sono due momenti diversi della pagina. */
const preMemo = new Map<string, Promise<PrecomputedHolders | null>>()
function preFor(tokenId: string): Promise<PrecomputedHolders | null> {
  let p = preMemo.get(tokenId)
  if (!p) { p = precomputedHolders(tokenId).catch(() => null); preMemo.set(tokenId, p) }
  return p
}

export async function tokenView(id: string): Promise<string> {
  preMemo.delete(id)                                  // ogni visita rilegge il file notturno
  const [t, prices, quote, pre] = await Promise.all([
    api.token(id), tokenPrices().catch(() => new Map<string, TokenPrice>()), ergPrice(), preFor(id),
  ])
  const name = t.name?.trim() || null
  document.title = `${name ?? shortId(id)} (token) · Robespierre`

  // omonimi: ricerca per nome in TUTTE le maiuscole (l'API le distingue: vedi
  // tokenSearchAnyCase) — l'unico controllo anti-imitazione possibile senza indice
  let homonyms: number | null = null
  let homonymsCapped = false
  if (name) {
    try {
      const s = await tokenSearchAnyCase(name)
      homonyms = countHomonyms(s.items, name, id)
      homonymsCapped = s.truncated
    } catch { /* il controllo resta "non verificabile" */ }
  }

  // box di conio: l'altezza (quando è nato) e l'immagine EIP-4. I metadati si leggono
  // subito, il contenuto di terzi si carica SOLO su richiesta esplicita
  let imgUrl: string | null = null
  let mintedAt: number | null = null
  if (t.boxId) {
    try {
      const box = await api.box(t.boxId) as BoxLike & { creationHeight?: number; settlementHeight?: number }
      imgUrl = eip4ImageUrl(box.additionalRegisters as Record<string, RegValue> | undefined)
      mintedAt = box.settlementHeight ?? box.creationHeight ?? null
    } catch { /* nessun box leggibile: niente immagine, niente altezza */ }
  }

  const homonymCheck = homonyms == null
    ? { sig: 'info', text: L.homonyms_na }
    : homonyms === 0
      ? { sig: 'ok', text: L.homonyms_zero }
      : { sig: 'warn', text: homonymsCapped ? L.homonyms_min(homonyms) : L.homonyms_n(homonyms) }
  const checks = [
    homonymCheck,
    { sig: 'info', text: L.emission_line(t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—', t.decimals ?? 0) },
    t.description
      ? { sig: 'info', text: L.desc_unverified }
      : { sig: 'info', text: L.desc_none },
  ]

  // il prezzo è quello di tutto il sito (lib/prices.ts), con le sue avvertenze
  const p = prices.get(id)
  const usd = p && quote ? p.ergPerToken * quote.usd : null
  const priceBlock = p
    ? `<div class="pbig"><div class="pbig-top">
        <span class="pbig-n${p.thin ? ' dim' : ''}">${fmtPrice(p.ergPerToken)} ERG</span>
        <span class="pbig-s">${L.tok_price}${usd != null ? `<br>≈ ${fmtPrice(usd)} $` : ''}</span></div>
        ${p.thin ? `<div class="s"><span class="tag">${L.thin_pool}</span> <span class="dim">${esc(L.thin_tip(groupThousands(String(Math.round(p.volCumErg))), THIN_POOL_ERG))}</span></div>` : ''}</div>`
    : `<p class="ph1-sub dim">${L.tok_no_price}</p>`
  const preTop = pre?.top?.reduce((s2, h) => s2 + h.pct, 0) ?? null

  return `<div class="page">
  <nav class="crumb" aria-label="breadcrumb">
    <a href="#/tokens">${L.nav_tokens}</a><span aria-hidden="true">/</span>
    <span class="mono" title="${esc(id)}">${esc(shortId(id, 10, 6))}</span>
    <button class="copy" type="button" data-copy="${esc(id)}">${L.copy_id}</button>
    ${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}
    <span class="grow"></span>
    <a class="ext" href="https://explorer.ergoplatform.com/en/token/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.official_explorer}</a>
  </nav>
  <section class="phero">
    <div class="phero-l">
      <div class="live"><span class="state-big ${homonymCheck.sig}">${homonymCheck.sig === 'ok' ? '✓' : homonymCheck.sig === 'warn' ? '⚠' : '·'} ${esc(homonymCheck.text)}</span></div>
      <h1 class="ph1${name ? '' : ' dim'}">${name ? esc(name) : L.unnamed}</h1>
      ${t.description ? `<p class="lede tok-desc">«${esc(t.description.length > 400 ? t.description.slice(0, 400) + '…' : t.description)}»</p>
        <p class="t-cap dim" style="margin:0">${L.token_desc}</p>` : `<p class="lede dim">${L.desc_none}</p>`}
    </div>
    <div class="phero-r">
      ${priceBlock}
      <div class="ptiles">
        <div><span class="k">${L.emission}</span><span class="v2">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</span>
          <span class="s">${t.decimals ?? 0} ${L.decimals}</span></div>
        <div><span class="k">${L.tok_minted}</span><span class="v2">${mintedAt ? `<a href="#/block/${mintedAt}">${groupThousands(String(mintedAt))}</a>` : '—'}</span>
          <span class="s">${L.tok_minted_s}</span></div>
        <div><span class="k">${L.tok_pool}</span><span class="v2">${p ? groupThousands(String(Math.round(p.volCumErg))) + ' ERG' : '—'}</span>
          <span class="s">${p ? (p.vol24Erg > 0 ? esc(L.tok_pool_24(groupThousands(String(Math.round(p.vol24Erg))))) : L.tok_pool_s) : L.pal_no_pool}</span></div>
        <div><span class="k">${L.holders_k}</span><span class="v2">${pre ? groupThousands(String(pre.holders)) : '—'}</span>
          <span class="s">${pre && preTop != null ? esc(L.tok_top10(formatPct(preTop, 1), pre.at.slice(0, 10).split('-').reverse().join('/'))) : L.tok_holders_later}</span></div>
      </div>
    </div>
  </section>
  ${imgUrl ? `
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.img_h}</h2><p class="sec-p">${L.img_note}</p></div></div>
    <div class="img-slot" data-img-slot>
      <button class="btn" data-img="${esc(imgUrl)}" type="button">${L.img_show}</button>
      <span class="dim mono t-cap">${esc(shortId(imgUrl, 34, 12))}</span>
    </div>
  </section>` : ''}
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.card_h}</h2><p class="sec-p">${L.card_p}</p></div></div>
    ${checks.map(c => `<div class="check check-${c.sig}"><span class="sig ${c.sig}">${c.sig === 'ok' ? '✓' : c.sig === 'warn' ? '⚠' : 'i'}</span><span>${esc(c.text)}</span></div>`).join('')}
    <div class="check check-info"><span class="sig info">i</span>
      <span>${L.holders_line} <button class="btn btn-sm" data-holders="${esc(id)}">${L.compute_now}</button>
      <span class="dim">— ${L.holders_note}</span></span></div>
    <div class="chart-wrap hidden" data-holders-chart></div>
    <div class="note hidden" data-holders-note></div>
  </section>
</div>`
}

/* ---------------- concentrazione dei detentori ---------------- */

export interface HolderBox { address: string; assets?: { tokenId: string; amount: number | string }[] }

/** Parte PURA: aggrega i box per indirizzo. Testata su casi sintetici. */
export function aggregateHolders(boxes: HolderBox[], tokenId: string): Map<string, bigint> {
  const m = new Map<string, bigint>()
  for (const b of boxes) {
    const amt = BigInt(b.assets?.find(a => a.tokenId === tokenId)?.amount ?? 0)
    if (amt > 0n) m.set(b.address, (m.get(b.address) ?? 0n) + amt)
  }
  return m
}

export interface HolderShare { address: string; amount: bigint; pct: number }

/** Parte PURA: primi N per quantità + resto, con quote sul totale letto. */
export function topHolders(m: Map<string, bigint>, topN: number): { top: HolderShare[]; rest: HolderShare | null; holders: number; total: bigint } {
  const total = [...m.values()].reduce((a, b) => a + b, 0n)
  const sorted = [...m.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
  const pct = (v: bigint) => total > 0n ? Number((v * 10000n) / total) / 100 : 0
  const top = sorted.slice(0, topN).map(([address, amount]) => ({ address, amount, pct: pct(amount) }))
  const restAmt = sorted.slice(topN).reduce((a, [, v]) => a + v, 0n)
  const rest = sorted.length > topN
    ? { address: `${L.others_d} ${groupThousands(String(sorted.length - topN))} ${L.holders_w}`, amount: restAmt, pct: pct(restAmt) }
    : null
  return { top, rest, holders: sorted.length, total }
}

/** Cache di sessione: rifare 68 richieste per rivisitare una pagina è maleducazione.
 *  Si conservano i DATI, non la frase: così la nota si ricompone nella lingua corrente
 *  anche se il calcolo è stato fatto prima del cambio IT/EN. */
interface HoldersResult {
  bars: HBar[]
  note: { capped: boolean; read: string; total: string; holders: string; topN: number; topPct: string }
}
const holdersCache = new Map<string, HoldersResult>()

function noteText(n: HoldersResult['note']): string {
  const head = n.capped ? L.holders_partial(n.read, n.total) : L.holders_full(n.total, n.holders)
  const conc = Number(n.topPct.replace(',', '.')) > SOGLIE.topHolderWarnPct
    ? L.holders_top_warn(n.topN, n.topPct, SOGLIE.topHolderWarnPct)
    : L.holders_top(n.topN, n.topPct)
  return head + conc
}

function renderHolders(r: HoldersResult): void {
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  if (!chartHost || !note) return
  chartHost.classList.remove('hidden')   // prima di disegnare: da nascosto il contenitore misura 0
  hbars(chartHost, r.bars)
  note.textContent = noteText(r.note)
  note.classList.remove('hidden')
}

/** Se il risultato è in cache, mostralo subito al caricamento della pagina. */
export function mountHoldersIfCached(tokenId: string): boolean {
  const hit = holdersCache.get(tokenId)
  if (!hit) return false
  renderHolders(hit)
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (btn) btn.textContent = L.recompute
  return true
}

export async function computeHolders(tokenId: string, gen?: number): Promise<void> {
  try { await computeHoldersInner(tokenId, gen) } catch {
    if (gen != null && !isCurrent(gen)) return
    const note = document.querySelector('[data-holders-note]') as HTMLElement | null
    const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
    if (note) { note.textContent = L.holders_fail; note.classList.remove('hidden') }
    if (btn) btn.textContent = L.retry
  }
}

async function computeHoldersInner(tokenId: string, gen?: number): Promise<void> {
  const mine = () => gen == null || isCurrent(gen)
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (!chartHost || !note) return
  if (btn) btn.textContent = L.computing

  const [tok, first] = await Promise.all([
    api.token(tokenId),
    fetch(`https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${tokenId}?limit=100`).then(r => r.json()),
  ])
  const decimals = tok?.decimals ?? 0
  const total: number = first.total ?? 0
  const capped = total > SOGLIE.maxBoxesForHolders
  const pages = Math.min(Math.ceil(total / 100), Math.ceil(SOGLIE.maxBoxesForHolders / 100))
  const boxes: HolderBox[] = [...(first.items ?? [])]

  for (let p = 1; p < pages; p += SOGLIE.holdersConcurrency) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(SOGLIE.holdersConcurrency, pages - p) }, (_, i) =>
        fetch(`https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${tokenId}?limit=100&offset=${(p + i) * 100}`)
          .then(r => r.json()).catch(() => ({ items: [] }))),
    )
    if (!mine()) return
    batch.forEach(pg => boxes.push(...(pg.items ?? [])))
    if (btn) btn.textContent = `${L.computing} ${Math.min(100, Math.round(100 * boxes.length / Math.min(total, SOGLIE.maxBoxesForHolders)))}%`
  }

  if (!mine()) return
  const agg = aggregateHolders(boxes, tokenId)
  const { top, rest, holders, total: totAmt } = topHolders(agg, SOGLIE.topShown)
  if (totAmt === 0n) { note.textContent = L.holders_none; note.classList.remove('hidden'); return }

  const nameOf = (addr: string) => {
    const l = labelOf(addr)
    if (l) return l
    return shortId(addr, 8) + (addr.startsWith('9') ? '' : ' · ' + L.contract)
  }
  const bars: HBar[] = top.map(h => ({
    label: nameOf(h.address), value: h.pct,
    tipLine: `${formatTokenAmount(h.amount, decimals)} — ${formatPct(h.pct)}% ${L.of_read}`,
  }))
  if (rest && rest.pct > 0.01) bars.push({ label: rest.address, value: rest.pct, rest: true,
    tipLine: `${formatTokenAmount(rest.amount, decimals)} — ${formatPct(rest.pct)}%` })
  const top10pct = top.reduce((s2, h) => s2 + h.pct, 0)
  const result: HoldersResult = {
    bars,
    note: {
      capped, read: groupThousands(String(boxes.length)), total: groupThousands(String(total)),
      holders: groupThousands(String(holders)), topN: top.length, topPct: formatPct(top10pct, 1),
    },
  }
  holdersCache.set(tokenId, result)
  renderHolders(result)
  if (btn) btn.textContent = L.recompute
}

/* ---------------- concentrazione precalcolata (job notturno) ---------------- */

import { precomputedHolders } from '../api/explorer'

/** Se il job notturno ha già calcolato questo token, mostra subito il risultato
 *  con la sua data. Il bottone resta: "ricalcola dal vivo" è sempre possibile. */
export async function mountPrecomputedHolders(tokenId: string, gen?: number): Promise<boolean> {
  const pre = await preFor(tokenId)
  if (!pre?.top?.length) return false
  // la pagina può essere cambiata durante la lettura: i dati di un token
  // non devono MAI comparire sotto la pagella di un altro
  if (gen != null && !isCurrent(gen)) return false
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (!chartHost || !note) return false
  let decimals = 0
  try { decimals = (await api.token(tokenId)).decimals ?? 0 } catch { /* resta 0 */ }
  if (gen != null && !isCurrent(gen)) return false
  const nameOf = (addr: string) => {
    const l = labelOf(addr)
    return l ?? shortId(addr, 8) + (addr.startsWith('9') ? '' : ' · ' + L.contract)
  }
  const bars: HBar[] = pre.top.map(h => ({
    label: nameOf(h.address), value: h.pct,
    tipLine: `${formatTokenAmount(BigInt(h.amount), decimals)} — ${formatPct(h.pct)}% ${L.of_read}`,
  }))
  if (pre.restPct > 0.01) bars.push({
    label: `${L.others_d} ${groupThousands(String(pre.restCount))} ${L.holders_w}`,
    value: pre.restPct, rest: true, tipLine: `${formatPct(pre.restPct)}%`,
  })
  const topPct = pre.top.reduce((s2, h) => s2 + h.pct, 0)
  const conc = topPct > SOGLIE.topHolderWarnPct
    ? L.holders_top_warn(pre.top.length, formatPct(topPct, 1), SOGLIE.topHolderWarnPct)
    : L.holders_top(pre.top.length, formatPct(topPct, 1))
  chartHost.classList.remove('hidden')
  hbars(chartHost, bars)
  note.textContent = L.holders_pre(pre.at.slice(0, 10), groupThousands(String(pre.total))) + conc
  note.classList.remove('hidden')
  if (btn) btn.textContent = L.recompute_live
  return true
}
