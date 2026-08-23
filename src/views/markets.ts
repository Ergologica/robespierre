import { ergQuote } from '../api/explorer'
import { tokenPrices, THIN_POOL_ERG } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { esc } from './html'
import { formatPct, groupThousands } from '../lib/format'
import { icons } from '../icons'
import { L } from '../i18n'

/** La riga più piccola che il formato dei prezzi sa scrivere. Sotto, si dichiara
 *  "meno di", mai "0": sui mercati Ergo esistono davvero token a 1e-15 ERG. */
const MIN_SHOWN = 1e-9

/** Numeri di prezzo: cifre sensate a seconda della grandezza, mai notazione
 *  scientifica e mai uno zero che sarebbe una bugia. */
export function fmtPrice(v: number): string {
  if (v === 0) return '0'
  if (v > 0 && v < MIN_SHOWN) return '< ' + formatPct(MIN_SHOWN, 9)
  const digits = v >= 100 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 6 : 9
  return formatPct(v, digits).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '')
}

/** Righe ordinate: prima chi ha scambiato davvero nelle ultime 24 ore. */
export function sortMarketRows(prices: Map<string, TokenPrice>): TokenPrice[] {
  return [...prices.values()].sort((a, b) => b.vol24Erg - a.vol24Erg || b.volCumErg - a.volCumErg)
}

export async function marketsView(): Promise<string> {
  document.title = L.nav_markets + ' · Robespierre'
  const [prices, q] = await Promise.all([tokenPrices(), ergQuote()])
  if (!prices.size) throw new Error('Spectrum: nessun mercato leggibile')
  const rows = sortMarketRows(prices)

  const chg = q?.usdChange24h
  const chgHtml = chg != null
    ? ` <span class="${chg >= 0 ? 'in' : 'out'} val t-cap">${chg >= 0 ? '+' : ''}${formatPct(chg, 1)}% ${L.th_change24}</span>`
    : ''
  const ergRow = `<tr>
    <td><strong>ERG</strong> <span class="dim t-cap">${L.mk_erg_note}</span></td>
    <td class="num">1</td>
    <td class="num">${q ? fmtPrice(q.usd) + ' $' : '—'}${chgHtml}</td>
    <td class="num dim">—</td>
  </tr>`

  const trs = rows.map(r => {
    const usd = q?.usd != null ? r.ergPerToken * q.usd : null
    // il prezzo di un pool sottile si mostra attenuato: è un numero vero
    // che non regge il peso che la parola "prezzo" suggerisce
    const cls = r.thin ? 'num dim' : 'num'
    const tip = r.thin
      ? L.thin_tip(groupThousands(String(Math.round(r.volCumErg))), THIN_POOL_ERG)
      : L.pool_tip(groupThousands(String(Math.round(r.volCumErg))))
    return `<tr>
      <td><a href="#/token/${esc(r.tokenId)}" title="${esc(L.opens_card)}">${esc(r.symbol)}</a>
        ${r.sharedName ? `<span class="tag warn-tag" title="${esc(L.shared_name_tip(r.sharedName))}">⚠ ${L.shared_name}</span>
          <span class="mono dim t-micro">${esc(r.tokenId.slice(0, 8))}</span>` : ''}
        ${r.thin ? `<span class="tag" title="${esc(tip)}">${L.thin_pool}</span>` : ''}</td>
      <td class="${cls}" title="${esc(tip)}">${fmtPrice(r.ergPerToken)}</td>
      <td class="${cls}">${usd != null ? fmtPrice(usd) + ' $' : '—'}</td>
      <td class="num">${r.vol24Erg > 0 ? groupThousands(String(Math.round(r.vol24Erg))) + ' ERG' : '<span class="dim">—</span>'}</td>
    </tr>`
  }).join('')

  const thinN = rows.filter(r => r.thin).length
  const dupN = rows.filter(r => r.sharedName > 0).length

  return `
  <div class="card">
    <div class="card-head"><h2>${icons.token}${L.mk_h}</h2><p>${L.mk_p}</p></div>
    <table>
      <thead><tr><th>${L.th_token}</th><th class="num">${L.th_price_erg}</th><th class="num">${L.th_price_usd}</th><th class="num">${L.th_vol24}</th></tr></thead>
      <tbody>${ergRow}${trs}</tbody>
    </table>
    <div class="note">${L.mk_note}
      ${thinN ? `<br>${esc(L.mk_thin_note(thinN, rows.length, THIN_POOL_ERG))}` : ''}
      ${dupN ? `<br>⚠ ${esc(L.mk_dup_note(dupN))}` : ''}</div>
  </div>`
}
