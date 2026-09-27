import { tokensList } from '../api/explorer'
import { tokenPrices } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { esc } from './html'
import { fmtPrice } from './markets'
import { formatTokenAmount, groupThousands, shortId } from '../lib/format'
import { L } from '../i18n'

const PAGE = 100

/** Tutti i token coniati sulla catena, paginati, dal più recente. La pagella è a un
 *  click; il prezzo, quando c'è, è quello di tutto il sito (lib/prices.ts). */
export async function tokensDirView(offset = 0): Promise<string> {
  document.title = L.dir_h + ' · Robespierre'
  const [page, prices] = await Promise.all([
    tokensList(offset, PAGE), tokenPrices().catch(() => new Map<string, TokenPrice>()),
  ])
  if (!page) throw new Error('lista token non raggiungibile')
  const tot = groupThousands(String(page.total))
  const pageN = Math.floor(offset / PAGE) + 1
  const pages = Math.max(1, Math.ceil(page.total / PAGE))

  const rows = page.items.map(t => {
    const p = prices.get(t.id)
    return `<tr>
    <td>${t.name?.trim()
      ? `<a class="mk-sym" href="#/token/${esc(t.id)}" title="${esc(L.opens_card)}">${esc(t.name.trim())}</a>`
      : `<a href="#/token/${esc(t.id)}" class="dim">${L.unnamed}</a>`}
      <span class="mono dim t-micro">${esc(shortId(t.id, 8))}</span></td>
    <td class="num">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</td>
    <td class="num dim">${t.decimals ?? 0}</td>
    <td>${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}</td>
    <td class="num${p?.thin ? ' dim' : ''}">${p ? fmtPrice(p.ergPerToken) + ' ERG' : '<span class="dim">—</span>'}</td>
  </tr>`
  }).join('')
  const priced = page.items.filter(t => prices.has(t.id)).length

  return `<div class="page">
  <section class="phero">
    <div class="phero-l">
      <div class="live"><span>${L.dir_src}</span></div>
      <h1 class="ph1">${esc(L.dir_h1(tot))}</h1>
      <p class="lede">${L.dir_lede}</p>
    </div>
    <div class="ptiles">
      <div><span class="k">${L.dir_t_all}</span><span class="v2">${tot}</span><span class="s">${L.dir_t_all_s}</span></div>
      <div><span class="k">${L.dir_t_priced}</span><span class="v2"><a href="#/mercati">${groupThousands(String(prices.size))}</a></span><span class="s">${L.dir_t_priced_s}</span></div>
    </div>
  </section>
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.dir_page(groupThousands(String(pageN)), groupThousands(String(pages)))}</h2>
      <p class="sec-p">${esc(L.dir_page_p(PAGE, priced))}</p></div></div>
    <div class="flat"><table>
      <thead><tr><th>${L.th_name}</th><th class="num">${L.th_emission}</th><th class="num">${L.decimals}</th><th>${L.th_type}</th><th class="num">${L.th_price_erg}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="pager pager-flat">
      <span class="dim">${L.page_k} ${groupThousands(String(pageN))} ${L.of} ${groupThousands(String(pages))} · ${PAGE} ${L.per_page}</span>
      <span style="display:flex;gap:10px">
        <button data-nav="#/tokens/${Math.max(0, offset - PAGE)}" ${offset === 0 ? 'disabled' : ''}>${L.more_recent}</button>
        <button data-nav="#/tokens/${offset + PAGE}" ${offset + PAGE >= page.total ? 'disabled' : ''}>${L.older}</button>
      </span>
    </div>
  </section>
</div>`
}
