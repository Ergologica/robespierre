import { api, networkStats, coverageSummary, mempoolCount } from '../api/explorer'
import type { CoverageSummary } from '../api/explorer'
import type { BlockHeader } from '../api/types'
import { esc } from './html'
import { groupThousands, relativeTime, shortId, formatErg, formatPct } from '../lib/format'
import { fractionOf } from '../lib/feed'
import { L } from '../i18n'

/**
 * La home «Cronaca» (rinnovo del 27/09/2026). Apre con la promessa MISURATA — quanto
 * il decodificatore sa raccontare, dal file che la Action ricalcola ogni domenica —
 * e subito sotto la mostra al lavoro: le transazioni degli ultimi blocchi, dette in
 * una riga (views/feed.ts). Lo stato della rete passa a destra, in una colonna.
 */

const MAX_SUPPLY = 97_739_924n * 1_000_000_000n
/** «Regolare» = l'ultimo blocco ha meno di così. Dichiarato nel tooltip. */
const SLOW_MS = 10 * 60_000
export const HOW_URL = 'https://github.com/Ergologica/robespierre#come-si-misura-la-copertura'

/** La quota di traffico che è routine di rete, per la nota sotto il flusso («l'82%»). */
export function infraShare(c: CoverageSummary | null): string | null {
  if (!c) return null
  const p = Math.round(100 * c.summary.infra / c.summary.total)
  return L.art_pct(p, p + '%')
}

function hero(c: CoverageSummary | null, height: number, lastTs: number | null): string {
  const live = `<div class="live"><span class="dot" aria-hidden="true"></span>
    <span>${L.live} · ${L.live_block} <b data-live-h>${groupThousands(String(height))}</b>${lastTs ? ` · <span data-ago="${lastTs}">${relativeTime(lastTs)}</span>` : ''}</span></div>`
  const cta = `<div class="cta">
      <a class="btn-primary" href="#feed" data-scroll>${L.home_cta_feed} <span aria-hidden="true">↓</span></a>
      <a class="btn-quiet" href="${HOW_URL}" target="_blank" rel="noopener">${L.home_cta_how}</a></div>`
  if (!c) {
    return `<section class="hero"><div class="hero-l">${live}
      <h1 class="hero-h1">${L.home_h1_fallback}</h1><p class="lede">${L.home_lede_fallback}</p>${cta}</div></section>`
  }
  const s = c.summary
  const rest = s.restRecognized / s.rest, all = s.recognized / s.total
  const f = fractionOf(rest)
  const pct = (x: number) => formatPct(100 * x, 1) + '%'
  const n = (x: number) => groupThousands(String(x))
  const age = relativeTime(Date.parse(c.measuredAt))
  return `<section class="hero">
    <div class="hero-l">${live}
      <h1 class="hero-h1">${L.cov_headline(f.num, f.den, f.q)}</h1>
      <p class="lede">${esc(L.home_lede(n(c.blocks.count), L.art_pct(Math.round(100 * rest), pct(rest))))}</p>
      ${cta}
    </div>
    <div class="hero-r">
      <div class="cov">
        <div class="cov-top"><span class="cov-big">${pct(rest)}</span>
          <span class="cov-lab">${L.home_rest_k}<br>${esc(L.home_rest_s(n(s.restRecognized), n(s.rest)))}</span></div>
        <div class="bar bar-main" role="img" aria-label="${pct(rest)}"><i style="width:${(100 * rest).toFixed(1)}%"></i></div>
      </div>
      <div class="cov">
        <div class="cov-top"><span class="cov-mid">${pct(all)}</span>
          <span class="cov-lab dim">${esc(L.home_all_s(n(s.recognized), n(s.total)))}</span></div>
        <div class="bar bar-thin" role="img" aria-label="${pct(all)}"><i style="width:${(100 * all).toFixed(1)}%"></i></div>
      </div>
      <div class="cov-note">${esc(L.home_cov_note(n(c.blocks.from), n(c.blocks.to), c.measuredAt.slice(0, 10).split('-').reverse().join('/'), age))}</div>
    </div>
  </section>`
}

/** La scheda di stato della rete: si ridisegna a ogni blocco nuovo (main.ts). */
export function stateCard(height: number, blocks: BlockHeader[], stats: { hashRate: number; transactionAverage: number } | null, memp: number | null): string {
  const last = blocks[0]
  const slow = last ? Date.now() - last.timestamp > SLOW_MS : false
  const status = last
    ? `<span class="state ${slow ? 'state-slow' : 'state-ok'}" title="${esc(L.side_ok_tip)}">● ${slow ? esc(L.side_slow(Math.floor((Date.now() - last.timestamp) / 60_000))) : L.side_ok}</span>`
    : ''
  const series = blocks.slice(0, 16).reverse()             // da sinistra il più vecchio
  const max = Math.max(1, ...series.map(b => b.transactionsCount))
  const bars = series.map(b => `<i style="height:${Math.max(4, Math.round(44 * b.transactionsCount / max))}px" title="${esc(L.side_bar_tip(groupThousands(String(b.height)), b.transactionsCount))}"></i>`).join('')
  // blocco medio: media degli intervalli fra blocchi consecutivi
  const ts = blocks.slice(0, 16).map(b => b.timestamp)
  const avgS = ts.length > 1 ? Math.round((ts[0]! - ts[ts.length - 1]!) / (ts.length - 1) / 1000) : null
  const avg = avgS == null ? '—' : `${Math.floor(avgS / 60)}m ${String(avgS % 60).padStart(2, '0')}s`
  return `<div class="side-card" data-state>
      <div class="side-top"><span class="k">${L.side_state}</span>${status}</div>
      <div class="side-h"><span class="side-big">${groupThousands(String(height))}</span>
        <span class="s">${last ? L.side_height_s(`<span data-ago="${last.timestamp}">${relativeTime(last.timestamp)}</span>`) : ''}</span></div>
      <div class="spark" role="img" aria-label="${L.side_bars_mid}">${bars}</div>
      <div class="spark-lab"><span>${L.side_bars_left(series.length)}</span><span>${L.side_bars_mid}</span><span>${L.side_bars_right}</span></div>
      <div class="side-tiles">
        <div><span class="k">${L.hashrate}</span><span class="v2">${stats ? formatPct(stats.hashRate / 1e12, 2) + ' TH/s' : '—'}</span></div>
        <div><span class="k" title="${esc(L.side_avg_tip(Math.max(0, ts.length - 1)))}">${L.side_avg}</span><span class="v2">${avg}</span></div>
        <div><span class="k">${L.side_txday}</span><span class="v2">${stats ? groupThousands(String(stats.transactionAverage)) : '—'}</span></div>
        <div><span class="k">${L.side_mempool}</span><span class="v2">${memp ?? '—'} <a class="t-cap" href="#/mempool">${L.side_open} ›</a></span></div>
      </div>
    </div>`
}

/** La supply nella colonna: in HTML, non in SVG. Nel grafico largo 300 px il massimo
 *  usciva «97.739.924 …»: un numero tagliato (regola 10). Qui il testo va a capo. */
export function supplyCard(supplyNano: bigint | null): string {
  if (supplyNano == null) return ''
  const pct = Number(supplyNano / 1_000_000n) / Number(MAX_SUPPLY / 1_000_000n)
  return `<div class="side-card" title="${esc(L.supply_p)}">
      <div class="side-top"><span class="k">${L.supply}</span></div>
      <div class="side-h"><span class="side-mid">${formatErg(supplyNano, 0)}</span><span class="s">${L.circulating}</span></div>
      <div class="bar bar-main" role="img" aria-label="${formatPct(pct * 100)}% ${L.of_max}"><i style="width:${(pct * 100).toFixed(2)}%"></i></div>
      <div class="spark-lab"><span>${formatPct(pct * 100)}% ${L.of_max}</span><span>${L.max} ${formatErg(MAX_SUPPLY, 0)}</span></div>
    </div>`
}

export function blocksList(blocks: BlockHeader[]): string {
  return blocks.slice(0, 5).map(b => {
    const miner = b.miner?.name ?? shortId(b.miner?.address ?? '?', 8)
    return `<div class="brow"><a class="mono" href="#/block/${b.height}">${groupThousands(String(b.height))}</a>
      <span class="dim"><span data-ago="${b.timestamp}">${relativeTime(b.timestamp)}</span> · ${esc(miner)}</span>
      <span class="num">${b.transactionsCount} tx</span></div>`
  }).join('')
}

export interface HomeData { html: string; headers: BlockHeader[]; supply: number | null; cov: CoverageSummary | null }

export async function netView(): Promise<string> { return (await homeData()).html }

export async function homeData(): Promise<HomeData> {
  const [info, blocks, stats, memp, cov] = await Promise.all([
    api.info(), api.blocks(16), networkStats(), mempoolCount(), coverageSummary(),
  ])
  const headers = blocks.items
  const html = `<div class="page-home">
  ${hero(cov, info.height, headers[0]?.timestamp ?? null)}
  <div class="home-grid">
    <section class="feed" id="feed" aria-labelledby="feed-h">
      <div class="feed-head">
        <div><h2 id="feed-h" class="h2">${L.feed_h}</h2><p class="feed-p">${L.feed_p}</p></div>
        <span class="feed-live"><span data-feed-window></span><br>${L.feed_live}</span>
      </div>
      <div class="chips feed-chips" data-feed-chips></div>
      <div class="feed-list" data-feed aria-live="polite"><div class="fempty loading">${L.feed_loading}</div></div>
      <div class="feed-foot" data-feed-foot></div>
    </section>
    <aside class="side">
      ${stateCard(info.height, headers, stats, memp)}
      ${supplyCard(stats ? BigInt(Math.round(stats.supply)) : null)}
      <div class="side-list"><div class="k">${L.side_blocks}</div><div data-blocks>${blocksList(headers)}</div></div>
    </aside>
  </div>
</div>`
  return { html, headers, supply: stats?.supply ?? null, cov }
}
