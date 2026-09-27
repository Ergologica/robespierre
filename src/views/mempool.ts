import { mempoolFull } from '../api/explorer'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc } from './html'
import { relativeTime, shortId, formatErg, formatPct, groupThousands } from '../lib/format'
import { L } from '../i18n'

/** La mempool ha una pagina sua: prima stava in fondo alla home, e la home adesso
 *  racconta le transazioni confermate. Stesse colonne di prima, testata «Cronaca». */
export async function mempoolView(): Promise<string> {
  document.title = L.mempool_h + ' · Robespierre'
  // L'endpoint v0 a volte dichiara N transazioni e ne restituisce zero (misurato il
  // 27/09/2026: total 12, items [] con limit 10, poi 10 righe un minuto dopo). Si
  // riprova con limiti più piccoli; e se resta vuoto NON si scrive «mempool vuota».
  let memp = await mempoolFull(25)
  for (const lim of [9, 5]) {
    if (!memp || memp.items.length || !memp.total) break
    memp = await mempoolFull(lim)
  }
  if (!memp) throw new Error('mempool: la fonte non risponde')
  const fees: bigint[] = []
  const rows = memp.items.map(t => {
    const fee = t.outputs.filter(o => o.address === FEE_ADDRESS).reduce((s, o) => s + BigInt(o.value), 0n)
    fees.push(fee)
    const perByte = t.size ? Number(fee) / t.size : 0
    return `<tr>
      <td class="mono"><a href="#/tx/${esc(t.id)}" title="${L.mempool_tip}">${esc(shortId(t.id, 8))}</a></td>
      <td class="when" data-ago="${t.creationTimestamp}">${relativeTime(t.creationTimestamp)}</td>
      <td class="num">${formatErg(fee, 4)}</td>
      <td class="num dim">${perByte ? Math.round(perByte) + ' nano/B' : '—'}</td>
      <td class="num">${formatPct(t.size / 1024)} kB</td>
    </tr>`
  }).join('')
  // la mediana delle commissioni MOSTRATE: dichiarata come tale, non «della mempool»
  const sorted = [...fees].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null
  return `<div class="page">
  <section class="phero">
    <div class="phero-l">
      <div class="live"><span class="dot" aria-hidden="true"></span><span>${L.mp_live}</span></div>
      <h1 class="ph1">${esc(L.mp_h1(memp.total))}</h1>
      <p class="lede">${L.mempool_page_p}</p>
    </div>
    <div class="ptiles">
      <div><span class="k">${L.mempool_tile}</span><span class="v2">${groupThousands(String(memp.total))}</span><span class="s">${L.mempool_s}</span></div>
      <div><span class="k">${L.mp_median}</span><span class="v2">${median != null ? formatErg(median, 4) : '—'}</span>
        <span class="s">${memp.items.length ? esc(L.mp_median_s(memp.items.length)) : '&nbsp;'}</span></div>
    </div>
  </section>
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.mempool_h} ${memp.items.length ? `<span class="n">${esc(L.mempool_count(memp.items.length, memp.total))}</span>` : ''}</h2></div></div>
    <div class="flat"><table>
      <thead><tr><th>${L.th_id}</th><th>${L.th_since}</th><th class="num">${L.th_fee}</th><th class="num">${L.th_feeb}</th><th class="num">${L.th_size}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="dim">${memp.total ? esc(L.mp_missing(memp.total)) : L.mempool_empty}</td></tr>`}</tbody>
    </table></div>
  </section>
</div>`
}
