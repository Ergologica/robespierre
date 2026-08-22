import { api, ergPrice } from '../api/explorer'
import { esc, addrLink, labelOf } from './html'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import type { Tx } from '../api/types'

const PAGE = 20

/** Flusso netto della transazione per QUESTO indirizzo (out - in), in nanoERG. */
function netFlow(tx: Tx, addr: string): bigint {
  const inSum = tx.inputs.filter(b => b.address === addr).reduce((s, b) => s + BigInt(b.value), 0n)
  const outSum = tx.outputs.filter(b => b.address === addr).reduce((s, b) => s + BigInt(b.value), 0n)
  return outSum - inSum
}

/** La controparte "protagonista": il maggiore box dell'altro lato, fee esclusa. */
function counterparty(tx: Tx, addr: string, incoming: boolean): string | null {
  const side = incoming ? tx.inputs : tx.outputs
  const others = side.filter(b => b.address !== addr && b.address !== FEE_ADDRESS)
  if (!others.length) return null
  return others.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b)).address
}

export async function addressView(addr: string, offset = 0): Promise<string> {
  const [balance, txs, price] = await Promise.all([
    api.addressBalance(addr), api.addressTxs(addr, offset, PAGE), ergPrice(),
  ])
  const nano = BigInt(balance.nanoErgs)
  const usd = price ? ` <span class="fiat">≈ ${(Number(nano / 1_000_000n) / 1000 * price.usd).toLocaleString('it-IT', { maximumFractionDigits: 2 })} $</span>` : ''
  const tokens = balance.tokens ?? []
  const label = labelOf(addr)

  const rows = txs.items.map(tx => {
    const net = netFlow(tx, addr)
    const incoming = net > 0n
    const cp = counterparty(tx, addr, incoming)
    return `<tr>
      <td class="when" title="${isoUtc(tx.timestamp)}"><a href="#/tx/${esc(tx.id)}" class="dim">${relativeTime(tx.timestamp)}</a></td>
      <td class="dir"><span class="a ${incoming ? 'in' : 'out'}">${incoming ? '↓' : '↑'}</span>
        ${incoming ? 'da' : 'a'} ${cp ? addrLink(cp) : '<span class="dim">più controparti</span>'}</td>
      <td class="num"><span class="val ${incoming ? 'in' : 'out'}">${net > 0n ? '+' : ''}${formatErg(net, 2)}</span></td>
    </tr>`
  }).join('')

  const page = Math.floor(offset / PAGE) + 1
  const pages = Math.max(1, Math.ceil(txs.total / PAGE))
  document.title = `${label ?? shortId(addr, 10)} · Robespierre`

  const tokenRows = tokens.slice(0, 12).map(t =>
    `<tr><td><a href="#/token/${esc(t.tokenId)}" title="apri la pagella del token">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a></td>
     <td class="num">${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0)}</td></tr>`).join('')

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1 class="${label ? '' : 'mono'}" style="font-size:${label ? 22 : 17}px">${label ? esc(label) : esc(shortId(addr, 12, 6))}</h1>
      <button class="copy" data-copy="${esc(addr)}">copia</button>
      ${label ? `<span class="dim mono">${esc(shortId(addr, 10))}</span>` : '<span class="dim">nessuna etichetta nell\'address book</span>'}
    </div>
    <div class="tiles">
      <div><div class="k">Saldo</div><div class="v">${formatErg(nano)}</div><div class="s">${usd || '&nbsp;'}</div></div>
      <div><div class="k">Token</div><div class="v">${tokens.length} diversi</div><div class="s">&nbsp;</div></div>
      <div><div class="k">Movimenti</div><div class="v">${groupThousands(String(txs.total))}</div>
        <div class="s">${txs.items[0] ? 'ultimo ' + relativeTime(txs.items[0].timestamp) : ''}</div></div>
      <div><div class="k">Pagina</div><div class="v">${page} di ${groupThousands(String(pages))}</div><div class="s">${PAGE} per pagina</div></div>
    </div>
  </div>
  ${tokens.length ? `<div class="card"><div class="card-head"><h2>Token</h2></div>
    <table><tbody>${tokenRows}</tbody></table>
    ${tokens.length > 12 ? `<div class="card-pad dim" style="padding-top:8px">+ altri ${tokens.length - 12}</div>` : ''}</div>` : ''}
  <div class="card">
    <table>
      <thead><tr><th style="width:130px">Quando</th><th>Movimento</th><th class="num" style="width:190px">Importo netto</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="dim">nessun movimento</td></tr>'}</tbody>
    </table>
    <div class="pager">
      <span><strong>${groupThousands(String(txs.total))}</strong> movimenti</span>
      <span style="display:flex;gap:10px">
        <button data-nav="#/address/${esc(addr)}/${Math.max(0, offset - PAGE)}" ${offset === 0 ? 'disabled' : ''}>‹ più recenti</button>
        <button data-nav="#/address/${esc(addr)}/${offset + PAGE}" ${offset + PAGE >= txs.total ? 'disabled' : ''}>più vecchi ›</button>
      </span>
    </div>
  </div>`
}
