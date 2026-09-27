import { mempoolFull } from '../api/explorer'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc } from './html'
import { relativeTime, shortId, formatErg, formatPct } from '../lib/format'
import { L } from '../i18n'

/** La mempool ha una pagina sua: prima stava in fondo alla home, e la home adesso
 *  racconta le transazioni confermate. Stesse colonne di prima. */
export async function mempoolView(): Promise<string> {
  document.title = L.mempool_h + ' · Robespierre'
  const memp = await mempoolFull(25)
  if (!memp) throw new Error('mempool: la fonte non risponde')
  const rows = memp.items.map(t => {
    const fee = t.outputs.filter(o => o.address === FEE_ADDRESS).reduce((s, o) => s + BigInt(o.value), 0n)
    const perByte = t.size ? Number(fee) / t.size : 0
    return `<tr>
      <td class="mono"><a href="#/tx/${esc(t.id)}" title="${L.mempool_tip}">${esc(shortId(t.id, 8))}</a></td>
      <td class="when" data-ago="${t.creationTimestamp}">${relativeTime(t.creationTimestamp)}</td>
      <td class="num">${formatErg(fee, 4)}</td>
      <td class="num dim">${perByte ? Math.round(perByte) + ' nano/B' : '—'}</td>
      <td class="num">${formatPct(t.size / 1024)} kB</td>
    </tr>`
  }).join('')
  return `<div class="card">
    <div class="card-head"><h2>${L.mempool_h}</h2>
      <p>${L.mempool_page_p} <span class="dim">${esc(L.mempool_count(memp.items.length, memp.total))}</span></p></div>
    <table>
      <thead><tr><th>${L.th_id}</th><th>${L.th_since}</th><th class="num">${L.th_fee}</th><th class="num">${L.th_feeb}</th><th class="num">${L.th_size}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="dim">${L.mempool_empty}</td></tr>`}</tbody>
    </table>
  </div>`
}
