import { api } from '../api/explorer'
import { esc, labelOf } from './html'
import { formatTokenAmount, formatPct, groupThousands, shortId } from '../lib/format'
import { hbars } from '../charts'
import { icons } from '../icons'
import { L } from '../i18n'
import type { HBar } from '../charts'
import type { RegValue } from '../api/types'
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

export async function tokenView(id: string): Promise<string> {
  const t = await api.token(id)
  const name = t.name?.trim() || null
  document.title = `${name ?? shortId(id)} (token) · Robespierre`

  // omonimi: ricerca per nome sull'API — l'unico controllo anti-imitazione possibile senza indice
  let homonyms: number | null = null
  let homonymsCapped = false
  if (name) {
    try {
      const s = await api.tokenSearch(name)          // fino a 100 risultati
      homonyms = countHomonyms(s.items ?? [], name, id)
      homonymsCapped = (s.total ?? 0) > (s.items?.length ?? 0)  // oltre 100: conteggio per difetto
    } catch { /* il controllo resta "non verificabile" */ }
  }

  // immagine EIP-4: i metadati (registri del box di conio) si leggono subito,
  // il contenuto di terzi si carica SOLO su richiesta esplicita
  let imgUrl: string | null = null
  if (t.boxId) {
    try { imgUrl = eip4ImageUrl((await api.box(t.boxId)).additionalRegisters as Record<string, RegValue> | undefined) }
    catch { /* nessun box leggibile: semplicemente niente immagine */ }
  }

  const checks = [
    homonyms == null
      ? { sig: 'info', text: L.homonyms_na }
      : homonyms === 0
        ? { sig: 'ok', text: L.homonyms_zero }
        : { sig: 'warn', text: homonymsCapped ? L.homonyms_min(homonyms) : L.homonyms_n(homonyms) },
    { sig: 'info', text: L.emission_line(t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—', t.decimals ?? 0) },
    t.description
      ? { sig: 'info', text: L.desc_unverified }
      : { sig: 'info', text: L.desc_none },
  ]

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1 class="t-title">${name ? esc(name) : `<span class="dim">${L.unnamed}</span>`}</h1>
      <span class="mono dim id-beside">${esc(shortId(id, 10, 6))}</span>
      <button class="copy" data-copy="${esc(id)}">${L.copy_id}</button>
      ${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}
      <span class="grow"></span>
      <a class="btn-link" href="https://explorer.ergoplatform.com/en/token/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.official_explorer}</a>
    </div>
    <div class="tiles">
      <div><div class="k">${L.emission}</div>
        <div class="v">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</div>
        <div class="s">${t.decimals ?? 0} ${L.decimals}</div></div>
      <div style="grid-column:span 3"><div class="k">${L.token_desc}</div>
        <div class="t-body" style="margin-top:var(--sp-2)">${t.description ? esc(t.description) : `<span class="dim">${L.none_f}</span>`}</div></div>
    </div>
  </div>
  ${imgUrl ? `
  <div class="card">
    <div class="card-head"><h2>${L.img_h}</h2><p>${L.img_note}</p></div>
    <div class="card-pad" data-img-slot>
      <button class="copy" data-img="${esc(imgUrl)}">${L.img_show}</button>
      <span class="dim mono t-cap" style="margin-left:var(--sp-2)">${esc(shortId(imgUrl, 34, 12))}</span>
    </div>
  </div>` : ''}
  <div class="card">
    <div class="card-head"><h2>${L.card_h}</h2>
      <p>${L.card_p}</p></div>
    <div class="card-pad" style="padding-top:4px">
      ${checks.map(c => `<div class="check check-${c.sig}"><span class="sig ${c.sig}">${c.sig === 'ok' ? '✓' : c.sig === 'warn' ? '⚠' : 'i'}</span><span>${esc(c.text)}</span></div>`).join('')}
      <div class="check check-info"><span class="sig info">i</span>
        <span>${L.holders_line} <button class="btn btn-sm" data-holders="${esc(id)}">${L.compute_now}</button>
        <span class="dim">— ${L.holders_note}</span></span></div>
    </div>
    <div class="chart-wrap hidden" data-holders-chart></div>
    <div class="note hidden" data-holders-note></div>
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
  const pre = await precomputedHolders(tokenId)
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
