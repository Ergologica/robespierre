import { tokensList } from '../api/explorer'
import { esc } from './html'
import { formatTokenAmount, groupThousands, shortId } from '../lib/format'
import { icons } from '../icons'
import { L } from '../i18n'

const PAGE = 100

/** Tutti i token coniati sulla catena, paginati. La pagella è a un click. */
export async function tokensDirView(offset = 0): Promise<string> {
  document.title = L.dir_h + ' · Robespierre'
  const page = await tokensList(offset, PAGE)
  if (!page) throw new Error('lista token non raggiungibile')
  const tot = groupThousands(String(page.total))
  const pageN = Math.floor(offset / PAGE) + 1
  const pages = Math.max(1, Math.ceil(page.total / PAGE))

  const rows = page.items.map(t => `<tr>
    <td>${t.name?.trim()
      ? `<a href="#/token/${esc(t.id)}" title="${esc(L.opens_card)}">${esc(t.name.trim())}</a>`
      : `<a href="#/token/${esc(t.id)}" class="mono">${esc(shortId(t.id, 10))}</a> <span class="tag">${L.unnamed}</span>`}</td>
    <td class="num">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</td>
    <td class="num dim">${t.decimals ?? 0}</td>
    <td>${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}</td>
    <td class="num"><button class="copy" data-copy="${esc(t.id)}">${L.copy_id}</button></td>
  </tr>`).join('')

  return `
  <div class="card">
    <div class="card-head"><h2>${icons.token}${L.dir_h} — ${tot}</h2>
      <p>${L.dir_p(tot)}</p></div>
    <table>
      <thead><tr><th>${L.th_name}</th><th class="num">${L.th_emission}</th><th class="num">${L.decimals}</th><th>${L.th_type}</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pager">
      <span>${L.page_k} <strong>${groupThousands(String(pageN))}</strong> ${L.of} ${groupThousands(String(pages))} · ${PAGE} ${L.per_page}</span>
      <span style="display:flex;gap:10px">
        <button data-nav="#/tokens/${Math.max(0, offset - PAGE)}" ${offset === 0 ? 'disabled' : ''}>${L.more_recent}</button>
        <button data-nav="#/tokens/${offset + PAGE}" ${offset + PAGE >= page.total ? 'disabled' : ''}>${L.older}</button>
      </span>
    </div>
  </div>`
}
