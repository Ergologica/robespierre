import { api, mempoolFull, networkStats } from '../api/explorer'
import { esc } from './html'
import { groupThousands, relativeTime, isoUtc, shortId, formatErg, formatPct } from '../lib/format'
import { meter } from '../charts'
import { L } from '../i18n'

const MAX_SUPPLY = 97_739_924n * 1_000_000_000n
const FEE_HEAD = '2iHkR7CWvD1R' // prefisso dell'indirizzo fee, per il calcolo della commissione in mempool

export function mountNetCharts(supplyNano: bigint): void {
  const host = document.querySelector('[data-supply]') as HTMLElement | null
  if (!host) return
  const pct = Number(supplyNano / 1_000_000n) / Number(MAX_SUPPLY / 1_000_000n)
  meter(host, {
    label: L.circulating, big: formatErg(supplyNano, 0),
    pct,
    left: formatPct(pct * 100) + '% ' + L.of_max,
    right: L.max + ' ' + formatErg(MAX_SUPPLY, 0),
    tipTitle: L.supply,
    tipLine: formatPct(pct * 100) + '% ' + L.of_max,
  })
}

export async function netView(): Promise<string> {
  const [info, blocks, stats, memp] = await Promise.all([
    api.info(), api.blocks(8), networkStats(), mempoolFull(8),
  ])
  const rows = blocks.items.map((b, i) => {
    const next = blocks.items[i + 1]
    const delta = next ? Math.round((b.timestamp - next.timestamp) / 1000) : null
    const deltaStr = delta == null ? '—' : `${Math.floor(delta / 60)}m ${String(delta % 60).padStart(2, '0')}s`
    const miner = b.miner?.name ?? shortId(b.miner?.address ?? '?', 8)
    return `<tr>
      <td class="mono"><a href="#/block/${b.height}">${groupThousands(String(b.height))}</a></td>
      <td class="when" title="${isoUtc(b.timestamp)}">${relativeTime(b.timestamp)}</td>
      <td class="num dim" style="white-space:nowrap">${deltaStr}</td>
      <td>${b.miner?.address ? `<a href="#/address/${esc(b.miner.address)}">${esc(miner)}</a>` : esc(miner)}</td>
      <td class="num">${b.transactionsCount}</td>
    </tr>`
  }).join('')

  const mrows = (memp?.items ?? []).map(t => {
    const fee = t.outputs.filter(o => o.address?.startsWith(FEE_HEAD)).reduce((s, o) => s + BigInt(o.value), 0n)
    const perByte = t.size ? Number(fee) / t.size : 0
    return `<tr>
      <td class="mono"><a href="#/tx/${esc(t.id)}" title="${L.mempool_tip}">${esc(shortId(t.id, 8))}</a></td>
      <td class="when">${relativeTime(t.creationTimestamp)}</td>
      <td class="num">${formatErg(fee, 4)}</td>
      <td class="num dim">${perByte ? Math.round(perByte) + ' nano/B' : '—'}</td>
      <td class="num">${formatPct(t.size / 1024)} kB</td>
    </tr>`
  }).join('')

  const hashTH = stats ? formatPct(stats.hashRate / 1e12, 3) : null

  return `
  <div class="card">
    <div class="card-head"><h2>${L.net_state}</h2>
      <p>${L.net_state_p}</p></div>
    <div class="tiles">
      <div><div class="k">${L.height}</div><div class="v">${groupThousands(String(info.height))}</div>
        <div class="s">${L.last_block} ${blocks.items[0] ? relativeTime(blocks.items[0].timestamp) : '—'}</div></div>
      <div><div class="k">${L.tx_daily}</div><div class="v">${stats ? groupThousands(String(stats.transactionAverage)) : '—'}</div>
        <div class="s">${L.tx_src}</div></div>
      <div><div class="k">${L.hashrate}</div><div class="v">${hashTH ? hashTH + ' TH/s' : '—'}</div>
        <div class="s">${L.hashrate_s}</div></div>
      <div><div class="k">${L.mempool_tile}</div><div class="v">${memp?.total ?? '—'}</div>
        <div class="s">${L.mempool_s}</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${L.supply}</h2><p>${L.supply_p}</p></div>
    <div class="chart-wrap" data-supply></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>${L.latest_blocks}</h2></div>
    <table>
      <thead><tr><th>${L.th_height}</th><th>${L.th_when}</th><th class="num">${L.th_dprev}</th><th>${L.th_miner}</th><th class="num">Tx</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="card">
    <div class="card-head"><h2>${L.mempool_h}</h2>
      <p>${L.mempool_p}</p></div>
    <table>
      <thead><tr><th>${L.th_id}</th><th>${L.th_since}</th><th class="num">${L.th_fee}</th><th class="num">${L.th_feeb}</th><th class="num">${L.th_size}</th></tr></thead>
      <tbody>${mrows || `<tr><td colspan="5" class="dim">${L.mempool_empty}</td></tr>`}</tbody>
    </table>
  </div>`
}
