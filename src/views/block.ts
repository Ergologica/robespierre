import { api } from '../api/explorer'
import { esc } from './html'
import { formatErg, formatPct, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import { tagKeyOf } from '../lib/feed'
import { pool } from '../lib/pool'
import { txRow } from './feed'
import { L } from '../i18n'
import type { FullBlock, Tx } from '../api/types'

/**
 * Pagina del blocco nello stile «Cronaca»: le sue transazioni si leggono come il flusso
 * della home, ognuna detta in una riga. Il blocco completo (/blocks/{id}) non porta i
 * token degli input, quindi ogni transazione si scarica per intero, 4 alla volta, fino
 * a un tetto dichiarato; oltre, la riga resta un id da aprire.
 */
const MAX_FULL = 40

export async function blockView(q: string): Promise<string> {
  let full: FullBlock | null
  if (/^\d+$/.test(q)) full = await api.blockAt(Number(q))
  else full = await api.blockById(q)
  if (!full?.block?.header) {
    return `<div class="errorbox"><h2>${L.block_notfound}</h2><p class="muted mono">${esc(q)}</p></div>`
  }
  const h = full.block.header
  const light = full.block.blockTransactions ?? []
  // il blocco completo non porta nome e indirizzo del minatore: li porta l'header di lista
  if (!h.miner?.address) {
    try {
      const hd = await api.headerAt(h.height)
      if (hd?.id === h.id && hd.miner) h.miner = hd.miner
    } catch { /* il minatore resta «?»: meglio un buco dichiarato che un dato inventato */ }
  }
  document.title = `${L.block_h} ${groupThousands(String(h.height))} · Robespierre`

  const head = light.slice(0, MAX_FULL)
  const txs = await pool(head, 4, t => api.tx(t.id).catch(() => null as Tx | null))
  const counts = new Map<string, number>()
  const rows = light.map((t, i) => {
    const tx = i < txs.length ? txs[i] : null
    if (tx) {
      const r = txRow(tx, h.height, '#' + (i + 1))
      const tag = L[tagKeyOf(r.kind)]
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
      return r.html
    }
    const out = t.outputs.reduce((s, o) => s + BigInt(o.value), 0n)
    return `<a class="frow frow-raw" href="#/tx/${esc(t.id)}">
      <span class="ftime">#${i + 1}</span>
      <span class="fmain"><span class="fline"><span class="ftext">${esc(L.blk_not_read(formatErg(out, 2)))}</span></span>
        <span class="fmeta"><span class="mono">${esc(shortId(t.id))}</span></span></span>
      <span class="fchev" aria-hidden="true">›</span></a>`
  }).join('')
  const tags = [...counts].sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="ftag">${esc(t)}</span> <span class="dim">${n}</span>`).join('<span class="dim"> · </span>')

  const miner = h.miner?.name ?? shortId(h.miner?.address ?? '?', 8)
  const minerHtml = h.miner?.address ? `<a href="#/address/${esc(h.miner.address)}">${esc(miner)}</a>` : esc(miner)
  return `<div class="page">
  <nav class="crumb" aria-label="breadcrumb">
    <a href="#/">${L.nav_net}</a><span aria-hidden="true">/</span><span>${L.block_h}</span>
    <span class="mono" title="${esc(h.id)}">${esc(shortId(h.id, 10))}</span>
    <button class="copy" type="button" data-copy="${esc(h.id)}">${L.copy_id}</button>
    <span class="grow"></span>
    <a class="ext" href="#/block/${h.height - 1}">‹ ${groupThousands(String(h.height - 1))}</a>
    <a class="ext" href="#/block/${h.height + 1}">${groupThousands(String(h.height + 1))} ›</a>
  </nav>
  <section class="phero">
    <div class="phero-l">
      <div class="live"><span data-ago="${h.timestamp}">${relativeTime(h.timestamp)}</span><span class="dim">·</span><span class="mono dim">${isoUtc(h.timestamp)}</span></div>
      <h1 class="ph1">${L.block_h} ${groupThousands(String(h.height))}</h1>
      <p class="lede">${L.blk_lede(light.length, minerHtml)}</p>
      ${tags ? `<div class="fmeta blk-tags">${tags}</div>` : ''}
    </div>
    <div class="ptiles">
      <div><span class="k">${L.th_tx_n}</span><span class="v2">${light.length}</span><span class="s">${txs.filter(Boolean).length === light.length ? L.blk_all_read : esc(L.blk_some_read(txs.filter(Boolean).length))}</span></div>
      <div><span class="k">${L.miner}</span><span class="v2">${minerHtml}</span><span class="s">${h.miner?.name ? esc(shortId(h.miner.address ?? '', 8)) : '&nbsp;'}</span></div>
      <div><span class="k">${L.size}</span><span class="v2">${formatPct(h.size / 1024)} kB</span><span class="s">&nbsp;</span></div>
      <div><span class="k">${L.th_when}</span><span class="v2" data-ago="${h.timestamp}">${relativeTime(h.timestamp)}</span><span class="s">${isoUtc(h.timestamp).slice(0, 10)}</span></div>
    </div>
  </section>
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.block_txs} <span class="n">${light.length}</span></h2><p class="sec-p">${L.blk_txs_p}</p></div></div>
    <div class="feed-list blk-list">${rows}</div>
    ${light.length > MAX_FULL ? `<p class="sec-p">${esc(L.blk_cap(MAX_FULL, light.length))}</p>` : ''}
  </section>
</div>`
}
