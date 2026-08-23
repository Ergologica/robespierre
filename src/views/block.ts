import { api } from '../api/explorer'
import { esc } from './html'
import { formatErg, formatPct, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import { icons } from '../icons'
import { L } from '../i18n'
import type { FullBlock } from '../api/types'

const FEE_HEAD = '2iHkR7CWvD1R' // prefisso dell'indirizzo del contratto fee

/** Pagina del blocco: per altezza (cifre) o per id (64 hex). */
export async function blockView(q: string): Promise<string> {
  let full: FullBlock | null
  if (/^\d+$/.test(q)) full = await api.blockAt(Number(q))
  else full = await api.blockById(q)
  if (!full?.block?.header) {
    return `<div class="errbox"><h2>${L.block_notfound}</h2><p class="dim">${esc(q)}</p></div>`
  }
  const h = full.block.header
  const txs = full.block.blockTransactions ?? []
  // il blocco completo non porta nome/indirizzo del minatore: li porta l'header di lista
  if (!h.miner?.address) {
    try {
      const page = await api.blocksRange(h.height)
      const listed = page.items?.find(x => x.id === h.id)
      if (listed?.miner) h.miner = listed.miner
    } catch { /* il minatore resta "?" — meglio un buco dichiarato che un dato inventato */ }
  }
  document.title = `${L.block_h} ${groupThousands(String(h.height))} · Robespierre`

  const miner = h.miner?.name ?? shortId(h.miner?.address ?? '?', 8)
  const rows = txs.map(t => {
    const out = t.outputs.reduce((s, o) => s + BigInt(o.value), 0n)
    const fee = t.outputs.filter(o => o.address?.startsWith(FEE_HEAD)).reduce((s, o) => s + BigInt(o.value), 0n)
    return `<tr>
      <td class="mono"><a href="#/tx/${esc(t.id)}">${esc(shortId(t.id, 10))}</a></td>
      <td class="num">${formatErg(out, 2)}</td>
      <td class="num dim">${fee > 0n ? formatErg(fee, 4) : '—'}</td>
      <td class="num dim">${t.size ? formatPct(t.size / 1024) + ' kB' : '—'}</td>
    </tr>`
  }).join('')

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1>${icons.net}${L.block_h} ${groupThousands(String(h.height))}</h1>
      <span class="grow"></span>
      <a class="btn-link" href="#/block/${h.height - 1}">‹ ${groupThousands(String(h.height - 1))}</a>
      <a class="btn-link" href="#/block/${h.height + 1}">${groupThousands(String(h.height + 1))} ›</a>
    </div>
    <div class="idrow">
      <span class="mono dim" style="word-break:break-all">${esc(h.id)}</span>
      <button class="copy" data-copy="${esc(h.id)}">${L.copy_id}</button>
    </div>
    <div class="tiles">
      <div><div class="k">${L.th_when}</div><div class="v" style="font-size:20px">${relativeTime(h.timestamp)}</div>
        <div class="s">${isoUtc(h.timestamp)}</div></div>
      <div><div class="k">${L.th_tx_n}</div><div class="v">${txs.length}</div><div class="s">&nbsp;</div></div>
      <div><div class="k">${L.miner}</div>
        <div class="v" style="font-size:20px">${h.miner?.address ? `<a href="#/address/${esc(h.miner.address)}">${esc(miner)}</a>` : esc(miner)}</div>
        <div class="s">&nbsp;</div></div>
      <div><div class="k">${L.size}</div><div class="v">${formatPct(h.size / 1024)} kB</div><div class="s">&nbsp;</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${L.block_txs}</h2></div>
    <table>
      <thead><tr><th>${L.th_id}</th><th class="num">${L.out_total}</th><th class="num">${L.th_fee}</th><th class="num">${L.th_size}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}
