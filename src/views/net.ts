import { api, mempoolCount } from '../api/explorer'
import { esc } from './html'
import { groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'

export async function netView(): Promise<string> {
  const [info, blocks, unconfirmed] = await Promise.all([
    api.info(), api.blocks(8), mempoolCount(),
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

  return `
  <div class="card">
    <div class="card-head"><h2>Stato della rete</h2>
      <p>I numeri che dicono se la catena sta funzionando, prima di qualunque classifica.</p></div>
    <div class="tiles">
      <div><div class="k">Altezza</div><div class="v">${groupThousands(String(info.height))}</div>
        <div class="s">ultimo blocco ${blocks.items[0] ? relativeTime(blocks.items[0].timestamp) : '—'}</div></div>
      <div><div class="k">In attesa · mempool</div><div class="v">${unconfirmed ?? '—'}</div>
        <div class="s">transazioni non confermate</div></div>
      <div><div class="k">Blocchi indicizzati</div><div class="v">${groupThousands(String(blocks.total))}</div>
        <div class="s">dall'origine della catena</div></div>
      <div><div class="k">Fonte</div><div class="v">api.ergoplatform.com</div>
        <div class="s">con scorrimento su mirror</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Ultimi blocchi</h2></div>
    <table>
      <thead><tr><th>Altezza</th><th>Quando</th><th class="num">Δ prec.</th><th>Minato da</th><th class="num">Tx</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}
