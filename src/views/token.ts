import { api } from '../api/explorer'
import { esc, labelOf } from './html'
import { formatTokenAmount, groupThousands, shortId } from '../lib/format'
import { hbars } from '../charts'
import { icons } from '../icons'
import type { HBar } from '../charts'

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

export async function tokenView(id: string): Promise<string> {
  const t = await api.token(id)
  const name = t.name?.trim() || null
  document.title = `${name ?? shortId(id)} (token) · Robespierre`

  // omonimi: ricerca per nome sull'API — l'unico controllo anti-imitazione possibile senza indice
  let homonyms: number | null = null
  if (name) {
    try {
      const s = await fetch('https://api.ergoplatform.com/api/v1/tokens/search?query=' + encodeURIComponent(name))
      if (s.ok) homonyms = countHomonyms((await s.json()).items ?? [], name, id)
    } catch { /* il controllo resta "non verificabile" */ }
  }

  const checks = [
    homonyms == null
      ? { sig: 'info', text: 'Omonimi: non verificabile in questo momento' }
      : homonyms === 0
        ? { sig: 'ok', text: 'Nessun altro token usa questo nome' }
        : { sig: 'warn', text: `${homonyms} altri token usano questo nome — l'unico identificatore affidabile è l'id` },
    { sig: 'info', text: `Emissione dichiarata al conio: ${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : 'sconosciuta'} · ${t.decimals ?? 0} decimali` },
    t.description
      ? { sig: 'info', text: 'La descrizione è scritta da chi ha coniato il token: non è verificata da nessuno' }
      : { sig: 'info', text: 'Nessuna descrizione dichiarata al conio' },
  ]

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1>${name ? esc(name) : '<span class="dim">token senza nome</span>'}</h1>
      ${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}
      <span class="grow"></span>
      <span class="mono dim">${esc(shortId(id, 8))}</span>
      <button class="copy" data-copy="${esc(id)}">copia id</button>
      <a class="btn-link" href="https://explorer.ergoplatform.com/en/token/${esc(id)}" target="_blank" rel="noopener">${icons.ext}explorer ufficiale</a>
    </div>
    <div class="tiles">
      <div><div class="k">Emissione</div>
        <div class="v">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</div>
        <div class="s">${t.decimals ?? 0} decimali</div></div>
      <div style="grid-column:span 3"><div class="k">Descrizione dichiarata al conio (non verificata)</div>
        <div class="s" style="font-size:14px;margin-top:6px">${t.description ? esc(t.description) : '<span class="dim">nessuna</span>'}</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Pagella</h2>
      <p>Fatti verificabili, non giudizi. Le soglie sono nel codice, discutibili via pull request.</p></div>
    <div class="card-pad" style="padding-top:4px">
      ${checks.map(c => `<div class="check"><span class="sig ${c.sig}">${c.sig === 'ok' ? '✓' : c.sig === 'warn' ? '⚠' : '·'}</span><span>${esc(c.text)}</span></div>`).join('')}
      <div class="check"><span class="sig info">·</span>
        <span>Concentrazione dei detentori: <button class="copy" data-holders="${esc(id)}">calcola adesso</button>
        <span class="dim">— legge i box non spesi dalla catena; per i token molto diffusi arriverà dal job notturno</span></span></div>
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
    ? { address: `altri ${groupThousands(String(sorted.length - topN))} detentori`, amount: restAmt, pct: pct(restAmt) }
    : null
  return { top, rest, holders: sorted.length, total }
}

/** Cache di sessione: rifare 68 richieste per rivisitare una pagina è maleducazione. */
interface HoldersResult { bars: HBar[]; note: string }
const holdersCache = new Map<string, HoldersResult>()

function renderHolders(r: HoldersResult): void {
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  if (!chartHost || !note) return
  hbars(chartHost, r.bars)
  chartHost.classList.remove('hidden')
  note.textContent = r.note
  note.classList.remove('hidden')
}

/** Se il risultato è in cache, mostralo subito al caricamento della pagina. */
export function mountHoldersIfCached(tokenId: string): boolean {
  const hit = holdersCache.get(tokenId)
  if (!hit) return false
  renderHolders(hit)
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (btn) btn.textContent = 'ricalcola'
  return true
}

export async function computeHolders(tokenId: string): Promise<void> {
  try { await computeHoldersInner(tokenId) } catch {
    const note = document.querySelector('[data-holders-note]') as HTMLElement | null
    const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
    if (note) { note.textContent = 'Calcolo non riuscito: la fonte non risponde. Riprova tra poco — i dati restano sulla catena.'; note.classList.remove('hidden') }
    if (btn) btn.textContent = 'riprova'
  }
}

async function computeHoldersInner(tokenId: string): Promise<void> {
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (!chartHost || !note) return
  if (btn) btn.textContent = 'calcolo…'

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
    batch.forEach(pg => boxes.push(...(pg.items ?? [])))
    if (btn) btn.textContent = `calcolo… ${Math.min(100, Math.round(100 * boxes.length / Math.min(total, SOGLIE.maxBoxesForHolders)))}%`
  }

  const agg = aggregateHolders(boxes, tokenId)
  const { top, rest, holders, total: totAmt } = topHolders(agg, SOGLIE.topShown)
  if (totAmt === 0n) { note.textContent = 'Nessun box non speso trovato.'; note.classList.remove('hidden'); return }

  const nameOf = (addr: string) => {
    const l = labelOf(addr)
    if (l) return l
    return shortId(addr, 8) + (addr.startsWith('9') ? '' : ' · contratto')
  }
  const bars: HBar[] = top.map(h => ({
    label: nameOf(h.address), value: h.pct,
    tipLine: `${formatTokenAmount(h.amount, decimals)} — ${h.pct.toFixed(2).replace('.', ',')}% del circolante letto`,
  }))
  if (rest && rest.pct > 0.01) bars.push({ label: rest.address, value: rest.pct, rest: true,
    tipLine: `${formatTokenAmount(rest.amount, decimals)} — ${rest.pct.toFixed(2).replace('.', ',')}%` })
  const top10pct = top.reduce((s2, h) => s2 + h.pct, 0)
  const concNote = top10pct > SOGLIE.topHolderWarnPct
    ? ` ⚠ I primi ${top.length} detengono il ${top10pct.toFixed(1).replace('.', ',')}% (soglia di attenzione: ${SOGLIE.topHolderWarnPct}%).`
    : ` I primi ${top.length} detengono il ${top10pct.toFixed(1).replace('.', ',')}%.`
  const noteText = (capped
    ? `Calcolo parziale: letti ${groupThousands(String(boxes.length))} box su ${groupThousands(String(total))} — le quote sono indicative.`
    : `Letti tutti i ${groupThousands(String(total))} box non spesi: ${groupThousands(String(holders))} indirizzi distinti.`)
    + concNote
  const result: HoldersResult = { bars, note: noteText }
  holdersCache.set(tokenId, result)
  renderHolders(result)
  if (btn) btn.textContent = 'ricalcola'
}
