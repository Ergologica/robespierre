import { ergQuote } from '../api/explorer'
import { tokenPrices, THIN_POOL_ERG, pricesFetchedAt, sharedSymbolCount } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { esc } from './html'
import { formatPct, groupThousands, relativeTime } from '../lib/format'
import { L } from '../i18n'

/**
 * Mercati nello stile «Cronaca» (rinnovo del 27/09/2026): ERG è il titolo, non una
 * riga della tabella; il volume 24 h si legge come barra; il volume STORICO del pool
 * diventa una colonna, cioè il motivo per cui un prezzo regge o no.
 *
 * Cosa NON si fa, e perché:
 * - nessuna variazione 24 h per i token: la sorgente non la fornisce, e non si inventa;
 * - nessuna etichetta «pool profondo / modesto»: la proposta grafica le metteva sotto
 *   il volume storico, ma il volume storico dice quanto si è scambiato, non quanta
 *   liquidità c'è adesso (la profondità sono le riserve). Una parola sbagliata sotto
 *   un numero giusto. Resta solo «pool sottile», con la soglia dichiarata.
 */

/** La riga più piccola che il formato dei prezzi sa scrivere. Sotto, si dichiara
 *  "meno di", mai "0": sui mercati Ergo esistono davvero token a 1e-15 ERG. */
const MIN_SHOWN = 1e-9

/** Numeri di prezzo: cifre sensate a seconda della grandezza, mai notazione
 *  scientifica e mai uno zero che sarebbe una bugia. Le migliaia si separano:
 *  «95051,04 $» non si leggeva. */
export function fmtPrice(v: number): string {
  if (v === 0) return '0'
  if (v > 0 && v < MIN_SHOWN) return '< ' + formatPct(MIN_SHOWN, 9)
  const digits = v >= 100 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 6 : 9
  const s = formatPct(v, digits).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '')
  const m = /^(\d+)(.*)$/.exec(s)
  return m ? groupThousands(m[1]!) + m[2] : s
}

/** Righe ordinate: prima chi ha scambiato davvero nelle ultime 24 ore. */
export function sortMarketRows(prices: Map<string, TokenPrice>): TokenPrice[] {
  return [...prices.values()].sort((a, b) => b.vol24Erg - a.vol24Erg || b.volCumErg - a.volCumErg)
}

export type MkSort = 'sym' | 'price' | 'vol24' | 'volcum'
export interface MkState { view: '24' | 'all'; hideThin: boolean; q: string; sort: MkSort; desc: boolean; limit: number }

/** PURA: filtro e ordinamento della tabella. Testata. */
export function selectRows(rows: TokenPrice[], s: MkState): TokenPrice[] {
  const q = s.q.trim().toLowerCase()
  const out = rows.filter(r =>
    (s.view === 'all' || r.vol24Erg > 0)
    && (!s.hideThin || !r.thin)
    && (!q || r.symbol.toLowerCase().includes(q) || r.tokenId.startsWith(q)))
  const key = (r: TokenPrice): number | string =>
    s.sort === 'sym' ? r.symbol.toLowerCase() : s.sort === 'price' ? r.ergPerToken : s.sort === 'vol24' ? r.vol24Erg : r.volCumErg
  out.sort((a, b) => {
    const x = key(a), y = key(b)
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
    return (s.desc ? -c : c) || b.volCumErg - a.volCumErg
  })
  return out
}

const PAGE = 100
const st: { rows: TokenPrice[]; usd: number | null; s: MkState } = {
  rows: [], usd: null,
  s: { view: 'all', hideThin: false, q: '', sort: 'vol24', desc: true, limit: PAGE },
}

const ergFmt = (v: number) => v > 0 ? groupThousands(String(Math.round(v))) + ' ERG' : '—'

function rowHtml(r: TokenPrice, maxVol: number): string {
  const usd = st.usd != null ? r.ergPerToken * st.usd : null
  const tip = r.thin
    ? L.thin_tip(groupThousands(String(Math.round(r.volCumErg))), THIN_POOL_ERG)
    : L.pool_tip(groupThousands(String(Math.round(r.volCumErg))))
  const w = maxVol > 0 && r.vol24Erg > 0 ? Math.max(1.5, 100 * r.vol24Erg / maxVol) : 0
  return `<tr>
    <td class="mk-tok"><a class="mk-sym" href="#/token/${esc(r.tokenId)}" title="${esc(L.opens_card)}">${esc(r.symbol)}</a>
      ${r.sharedName ? `<span class="tag warn-tag" title="${esc(L.shared_name_tip(r.sharedName))}">⚠ ${L.shared_name}</span>
        <span class="mono dim t-micro">${esc(r.tokenId.slice(0, 8))}</span>` : ''}
      ${r.vol24Erg > 0 ? `<div class="t-cap mk-fresh">${L.mk_fresh}</div>` : ''}</td>
    <td class="num${r.thin ? ' dim' : ''}" title="${esc(tip)}">${fmtPrice(r.ergPerToken)}</td>
    <td class="num${r.thin ? ' dim' : ''}">${usd != null ? fmtPrice(usd) + ' $' : '—'}</td>
    <td class="mk-vol"><div class="mk-vc"><span class="mk-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%"></i></span><span class="num">${ergFmt(r.vol24Erg)}</span></div></td>
    <td class="num">${ergFmt(r.volCumErg)}${r.thin ? `<div><span class="tag" title="${esc(tip)}">${L.thin_pool}</span></div>` : ''}</td>
  </tr>`
}

/** Ridisegna solo il corpo della tabella e lo stato dei comandi: filtrare non rifà richieste. */
export function renderMarkets(): void {
  const body = document.querySelector('[data-mk-body]') as HTMLElement | null
  if (!body) return
  const s = st.s
  const sel = selectRows(st.rows, s)
  const maxVol = Math.max(0, ...sel.map(r => r.vol24Erg))
  body.innerHTML = sel.length
    ? sel.slice(0, s.limit).map(r => rowHtml(r, maxVol)).join('')
    : `<tr><td colspan="5" class="dim mk-none">${L.mk_none}</td></tr>`
  const more = document.querySelector('[data-mk-more]') as HTMLElement | null
  if (more) {
    const left = sel.length - s.limit
    more.hidden = left <= 0
    more.textContent = L.mk_more(groupThousands(String(Math.min(PAGE, left))))
  }
  const cnt = document.querySelector('[data-mk-count]') as HTMLElement | null
  if (cnt) cnt.textContent = L.mk_count(groupThousands(String(sel.length)), groupThousands(String(st.rows.length)))
  document.querySelectorAll<HTMLElement>('[data-mk-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mkView === s.view)))
  const thin = document.querySelector('[data-mk-thin]') as HTMLInputElement | null
  if (thin) thin.checked = s.hideThin
  document.querySelectorAll<HTMLElement>('th[data-mk-sort]').forEach(th => {
    const on = th.dataset.mkSort === s.sort
    th.setAttribute('aria-sort', on ? (s.desc ? 'descending' : 'ascending') : 'none')
    const ar = th.querySelector('.ar')
    if (ar) ar.textContent = on ? (s.desc ? '↓' : '↑') : ''
  })
}

/** Collega i comandi della pagina (dopo che l'HTML è in pagina). */
export function mountMarkets(): void {
  const root = document.querySelector('.page-mk') as HTMLElement | null
  if (!root) return
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement
    const v = t.closest('[data-mk-view]') as HTMLElement | null
    if (v) { st.s.view = v.dataset.mkView as '24' | 'all'; st.s.limit = PAGE; renderMarkets(); return }
    const th = t.closest('th[data-mk-sort]') as HTMLElement | null
    if (th) {
      const k = th.dataset.mkSort as MkSort
      st.s.desc = st.s.sort === k ? !st.s.desc : k !== 'sym'
      st.s.sort = k; renderMarkets(); return
    }
    if (t.closest('[data-mk-more]')) { st.s.limit += PAGE; renderMarkets() }
  })
  root.querySelector('[data-mk-thin]')?.addEventListener('change', e => {
    st.s.hideThin = (e.target as HTMLInputElement).checked; st.s.limit = PAGE; renderMarkets()
  })
  root.querySelector('[data-mk-q]')?.addEventListener('input', e => {
    st.s.q = (e.target as HTMLInputElement).value; st.s.limit = PAGE; renderMarkets()
  })
  renderMarkets()
}

export async function marketsView(q = ''): Promise<string> {
  document.title = L.nav_markets + ' · Robespierre'
  const [prices, quote] = await Promise.all([tokenPrices(), ergQuote()])
  if (!prices.size) throw new Error('Spectrum: nessun mercato leggibile')
  st.rows = sortMarketRows(prices)
  st.usd = quote?.usd ?? null
  // Si apre su TUTTI i mercati, ordinati per volume 24 h e poi storico. La proposta
  // grafica apriva su «Scambiati 24 h»: il 27/09/2026 la finestra di Spectrum ne
  // contava UNO, e la pagina si apriva quasi vuota. Il filtro resta, a un clic.
  st.s = { view: 'all', hideThin: false, q, sort: 'vol24', desc: true, limit: PAGE }

  const rows = st.rows
  const vol24 = rows.reduce((s, r) => s + r.vol24Erg, 0)
  const traded = rows.filter(r => r.vol24Erg > 0).length
  const thinN = rows.filter(r => r.thin).length
  const shared = sharedSymbolCount(rows)
  const at = pricesFetchedAt() ?? Date.now()
  const age = `<span data-ago="${at}">${relativeTime(at)}</span>`

  const chg = quote?.usdChange24h
  const chgHtml = chg != null
    ? `<span class="mk-chg ${chg >= 0 ? 'in' : 'out'}">${chg >= 0 ? '+' : '−'}${formatPct(Math.abs(chg), 1)}% ${L.th_change24}</span>` : ''
  // ERG si scrive con 4 decimali: sei («0,328168 $») sono rumore su un prezzo da exchange
  const title = quote ? `<h1 class="mk-h1">1 ERG = ${formatPct(quote.usd, quote.usd >= 100 ? 2 : 4)} $ ${chgHtml}</h1>` : `<h1 class="mk-h1">${L.mk_h}</h1>`
  const th = (k: MkSort, label: string, cls = '') =>
    `<th class="${cls}" data-mk-sort="${k}" aria-sort="none"><button type="button" title="${esc(L.mk_sort(label))}">${label}<span class="ar" aria-hidden="true"></span></button></th>`

  return `<div class="page-mk">
  <section class="mk-hero">
    <div class="mk-hero-l">
      <div class="live"><span class="dot" aria-hidden="true"></span><span>${quote ? L.mk_live(age) : L.mk_live_noerg(age)}</span></div>
      ${title}
      <p class="lede">${L.mk_lede}</p>
    </div>
    <div class="mk-tiles">
      <div><span class="k">${L.mk_t_vol24}</span><span class="v2">${ergFmt(vol24)}</span><span class="s">${L.mk_t_vol24_s}</span></div>
      <div><span class="k">${L.mk_t_traded}</span><span class="v2">${groupThousands(String(traded))} <small>${esc(L.mk_t_traded_of(groupThousands(String(rows.length))))}</small></span><span class="s">${L.mk_t_traded_s}</span></div>
      <div><span class="k">${L.mk_t_thin}</span><span class="v2">${groupThousands(String(thinN))}</span><span class="s">${esc(L.mk_t_thin_s(THIN_POOL_ERG))}</span></div>
      <div><span class="k">${L.mk_t_shared}</span><span class="v2 warn">${shared}</span><span class="s">${L.mk_t_shared_s}</span></div>
    </div>
  </section>
  <div class="mk-controls">
    <div class="seg" role="group" aria-label="${L.mk_view}">
      <button type="button" data-mk-view="all" aria-pressed="true">${L.mk_view_all}</button>
      <button type="button" data-mk-view="24" aria-pressed="false">${L.mk_view_24}</button>
    </div>
    <label class="switch"><input type="checkbox" data-mk-thin><span class="sw" aria-hidden="true"></span>${L.mk_hide_thin}</label>
    <span class="grow"></span>
    <span class="dim t-cap" data-mk-count></span>
    <label class="mk-filter"><span class="dim" aria-hidden="true">⌕</span>
      <input type="search" data-mk-q value="${esc(q)}" placeholder="${esc(L.mk_filter_ph)}" aria-label="${esc(L.mk_filter_ph)}" autocomplete="off" spellcheck="false"></label>
  </div>
  <div class="mk-table">
    <table>
      <thead><tr>${th('sym', L.th_token)}${th('price', L.th_price_erg, 'num')}<th class="num">${L.th_price_usd}</th>${th('vol24', L.th_vol24, 'num mk-vol-h')}${th('volcum', L.th_volcum, 'num')}</tr></thead>
      <tbody data-mk-body></tbody>
    </table>
  </div>
  <button type="button" class="btn mk-more" data-mk-more hidden></button>
  <div class="mk-foot">
    <div><h3>${L.mk_foot_src_h}</h3><p>${L.mk_foot_src_p}</p></div>
    <div><h3>${L.mk_foot_thin_h}</h3><p>${esc(L.mk_foot_thin_p(THIN_POOL_ERG))}</p></div>
    <div><h3 class="warn">${L.mk_foot_dup_h}</h3><p>${L.mk_foot_dup_p}</p></div>
  </div>
</div>`
}
