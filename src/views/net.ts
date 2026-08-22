import { api, mempoolFull, networkStats } from '../api/explorer'
import { esc } from './html'
import { groupThousands, relativeTime, isoUtc, shortId, formatErg } from '../lib/format'
import { meter } from '../charts'

const MAX_SUPPLY = 97_739_924n * 1_000_000_000n
const FEE_HEAD = '2iHkR7CWvD1R' // prefisso dell'indirizzo fee, per il calcolo della commissione in mempool

export function mountNetCharts(supplyNano: bigint): void {
  const host = document.querySelector('[data-supply]') as HTMLElement | null
  if (!host) return
  const pct = Number(supplyNano / 1_000_000n) / Number(MAX_SUPPLY / 1_000_000n)
  meter(host, {
    label: 'Circolanti', big: formatErg(supplyNano, 0),
    pct,
    left: (pct * 100).toFixed(2).replace('.', ',') + '% del massimo',
    right: 'massimo ' + formatErg(MAX_SUPPLY, 0),
    tipTitle: 'Supply circolante',
    tipLine: (pct * 100).toFixed(2).replace('.', ',') + '% degli ERG che esisteranno',
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
      <td class="mono">${groupThousands(String(b.height))}</td>
      <td class="when" title="${isoUtc(b.timestamp)}">${relativeTime(b.timestamp)}</td>
      <td class="num dim" style="white-space:nowrap">${deltaStr}</td>
      <td>${esc(miner)}</td>
      <td class="num">${b.transactionsCount}</td>
    </tr>`
  }).join('')

  const mrows = (memp?.items ?? []).map(t => {
    const fee = t.outputs.filter(o => o.address?.startsWith(FEE_HEAD)).reduce((s, o) => s + BigInt(o.value), 0n)
    const perByte = t.size ? Number(fee) / t.size : 0
    return `<tr>
      <td class="mono">${esc(shortId(t.id, 8))}</td>
      <td class="when">${relativeTime(t.creationTimestamp)}</td>
      <td class="num">${formatErg(fee, 4)}</td>
      <td class="num dim">${perByte ? Math.round(perByte) + ' nano/B' : '—'}</td>
      <td class="num">${(t.size / 1024).toFixed(2).replace('.', ',')} kB</td>
    </tr>`
  }).join('')

  const hashTH = stats ? (stats.hashRate / 1e12).toFixed(3).replace('.', ',') : null

  return `
  <div class="card">
    <div class="card-head"><h2>Stato della rete</h2>
      <p>I numeri che dicono se la catena sta funzionando, prima di qualunque classifica.</p></div>
    <div class="tiles">
      <div><div class="k">Altezza</div><div class="v">${groupThousands(String(info.height))}</div>
        <div class="s">ultimo blocco ${blocks.items[0] ? relativeTime(blocks.items[0].timestamp) : '—'}</div></div>
      <div><div class="k">Transazioni · media giornaliera</div><div class="v">${stats ? groupThousands(String(stats.transactionAverage)) : '—'}</div>
        <div class="s">fonte: nodo dell'explorer</div></div>
      <div><div class="k">Hash rate</div><div class="v">${hashTH ? hashTH + ' TH/s' : '—'}</div>
        <div class="s">potenza di calcolo della rete</div></div>
      <div><div class="k">In attesa · mempool</div><div class="v">${memp?.total ?? '—'}</div>
        <div class="s">transazioni non confermate</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Supply</h2><p>Quanto degli ERG che esisteranno è già stato emesso.</p></div>
    <div class="chart-wrap" data-supply></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Ultimi blocchi</h2></div>
    <table>
      <thead><tr><th>Altezza</th><th>Quando</th><th class="num">Δ prec.</th><th>Minato da</th><th class="num">Tx</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="card">
    <div class="card-head"><h2>In attesa · mempool</h2>
      <p>Con commissione e commissione per byte: il dato per cui si guarda una mempool.</p></div>
    <table>
      <thead><tr><th>Id</th><th>Da quando</th><th class="num">Commissione</th><th class="num">Fee/byte</th><th class="num">Dimensione</th></tr></thead>
      <tbody>${mrows || '<tr><td colspan="5" class="dim">mempool vuota — tutte le transazioni sono confermate</td></tr>'}</tbody>
    </table>
  </div>`
}
