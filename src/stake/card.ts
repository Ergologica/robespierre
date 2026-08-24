import { esc } from '../views/html'
import { icons } from '../icons'
import { L } from '../i18n'
import { formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId, formatPct } from '../lib/format'
import { tokenPrices, THIN_POOL_ERG } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { api, ergPrice } from '../api/explorer'
import { isCurrent } from '../lib/nav'
import { findStakes, MAX_NFT_CHECKED } from './index'
import type { StakePosition } from './paideia'

/** Controvalore del DEPOSITATO — mai del saldo di oggi, che non si sa. */
function depositValue(p: StakePosition, price: TokenPrice | undefined, usd: number | null): string {
  if (!price) return ''
  const units = Number(p.deposited) / 10 ** p.stakedDecimals
  const valErg = units * price.ergPerToken
  const v = usd != null
    ? (valErg * usd > 0 && valErg * usd < 1 ? '<1 $' : groupThousands(String(Math.round(valErg * usd))) + ' $')
    : formatPct(valErg, 2) + ' ERG'
  const tip = price.thin ? esc(L.thin_tip(groupThousands(String(Math.round(price.volCumErg))), THIN_POOL_ERG)) : ''
  return `<div class="s${price.thin ? ' dim' : ''}" title="${tip}">${esc(L.stake_dep_value(v))}${price.thin ? ' <span class="tag">' + L.thin_pool + '</span>' : ''}</div>`
}

/** PURA: la scheda «In staking». Vuota quando non c'è nulla da dire. */
export function stakeCardHtml(positions: StakePosition[], prices: Map<string, TokenPrice>, usd: number | null): string {
  if (!positions.length) return ''
  const blocks = positions.map(p => {
    const nome = p.stakedName || shortId(p.stakedTokenId, 8)
    const dep = formatTokenAmount(p.deposited, p.stakedDecimals)
    const pool = formatTokenAmount(p.poolTotal, p.stakedDecimals)
    return `<div class="stake-pos">
      <div class="idrow">
        <h3 class="t-sub">${esc(p.dao)}</h3>
        <a class="btn-link" href="https://app.paideia.im" target="_blank" rel="noopener">${icons.ext}${L.stake_open}</a>
        <a class="dim mono" href="#/token/${esc(p.keyId)}" title="${esc(L.opens_card)}">${esc(shortId(p.keyId, 10))}</a>
      </div>
      <div class="tiles tiles-s">
        <div class="tile-hero">
          <div class="k"><span class="help" title="${esc(L.stake_dep_tip)}">${L.stake_dep}</span></div>
          <div class="v">${esc(dep)} ${esc(nome)}</div>
          ${depositValue(p, prices.get(p.stakedTokenId), usd) || `<div class="s dim">${L.stake_no_price}</div>`}
        </div>
        <div>
          <div class="k">${L.stake_pool}</div>
          <div class="v">${esc(pool)} ${esc(nome)}</div>
          <div class="s">${p.poolStakers != null ? esc(L.stake_stakers(p.poolStakers)) : '&nbsp;'}</div>
        </div>
        <div>
          <div class="k">${L.stake_first}</div>
          <div class="v"><span title="${esc(isoUtc(p.since))}">${esc(relativeTime(p.since))}</span></div>
          <div class="s">${esc(L.stake_ops(p.operations))}</div>
        </div>
      </div>
    </div>`
  }).join('')

  const partial = positions.some(p => p.partial)
  return `<div class="card" id="staking">
    <div class="card-head"><h2>${L.stake_h}</h2><p>${esc(L.stake_p)}</p></div>
    ${blocks}
    <div class="card-pad">
      <div class="check"><span class="sig info">·</span><span>${esc(L.stake_unknown)}</span></div>
      ${partial ? `<div class="check"><span class="sig warn">⚠</span><span>${esc(L.stake_partial)}</span></div>` : ''}
      <p class="t-cap dim" style="margin:var(--sp-2) 0 0">${esc(L.stake_excluded)} · ${esc(L.stake_checked(MAX_NFT_CHECKED))}</p>
    </div>
  </div>`
}

/** Dopo il render: cerca le chiavi di staking e mostra la scheda solo se ne trova. */
export async function mountStakes(addr: string, gen?: number): Promise<void> {
  const slot = document.querySelector('[data-stake]') as HTMLElement | null
  if (!slot) return
  const mine = () => gen == null || isCurrent(gen)
  try {
    const bal = await api.addressBalance(addr)   // già in cache: la vista l'ha appena letto
    const positions = await findStakes(bal.tokens ?? [], gen)
    if (!mine() || !positions.length) return
    const [prices, erg] = await Promise.all([tokenPrices(), ergPrice()])
    if (!mine()) return
    const html = stakeCardHtml(positions, prices, erg?.usd ?? null)
    if (html) slot.outerHTML = html
  } catch { /* una chiave illeggibile non deve rompere la pagina */ }
}
