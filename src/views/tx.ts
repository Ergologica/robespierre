import { api } from '../api/explorer'
import { decode } from '../decoder/index'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc, addrLink } from './html'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import type { BoxLike } from '../api/types'

const MAX_TOKENS_SHOWN = 8

function boxHtml(b: BoxLike, spentLabel: string): string {
  const assets = b.assets ?? []
  const shown = assets.slice(0, MAX_TOKENS_SHOWN)
  const hidden = assets.length - shown.length
  const tokens = shown.map(a =>
    `${esc(a.name ?? shortId(a.tokenId, 8))} ${formatTokenAmount(BigInt(a.amount), a.decimals ?? 0)}`,
  ).join(' · ')
  return `<div class="box">
    <div class="head"><span class="mono">${esc(shortId(b.boxId, 8))}</span>
      ${addrLink(b.address)} <span class="tag ${spentLabel === 'non speso' ? 'unspent' : ''}">${spentLabel}</span></div>
    <div class="kv">
      <span class="kk">Valore</span><span>${formatErg(BigInt(b.value))}</span>
      ${assets.length ? `<span class="kk">Token</span><span>${tokens}${hidden > 0 ? ` <span class="dim">· +${hidden} altri token di questo box</span>` : ''}</span>` : ''}
    </div>
  </div>`
}

export async function txView(id: string): Promise<string> {
  const tx = await api.tx(id)
  const decoded = decode(tx)
  const hasContract = [...tx.inputs, ...tx.outputs].some(b => !b.address.startsWith('9') && b.address !== FEE_ADDRESS)

  const totalOut = tx.outputs.reduce((s, o) => s + BigInt(o.value), 0n)
  const fee = tx.outputs.filter(o => o.address === FEE_ADDRESS).reduce((s, o) => s + BigInt(o.value), 0n)
  // contano i token DIRETTI a destinatari: quelli nel box di resto non si sono "spostati"
  const inputAddrs = new Set(tx.inputs.map(i => i.address))
  const tokenIds = new Set(
    tx.outputs
      .filter(o => o.address !== FEE_ADDRESS && !inputAddrs.has(o.address))
      .flatMap(o => (o.assets ?? []).map(a => a.tokenId)),
  )
  const conf = tx.numConfirmations ?? 0

  const headline = decoded
    ? `<div class="headline">${esc(decoded.headline)}<span class="conf">${decoded.confidence === 'certa' ? 'lettura certa' : 'lettura probabile'}</span></div>`
    : hasContract
      ? `<div class="headline">Interazione con contratto non ancora catalogato <span class="conf">i riconoscitori di protocollo arrivano in Fase 2 — i dati completi sono qui sotto</span></div>`
      : ''

  document.title = `Tx ${shortId(id)} · Robespierre`
  return `
  <div class="card">
    <div class="statusline">
      <span class="pill ${conf > 0 ? 'ok' : 'wait'}">${conf > 0 ? '✓ Confermata' : 'In mempool'}</span>
      ${conf > 0 ? `<span class="muted">${groupThousands(String(conf))} conferme</span>` : ''}
      <span class="dim">·</span><span class="muted">${relativeTime(tx.timestamp)}</span>
      <span class="grow"></span><span class="dim mono">${isoUtc(tx.timestamp)}</span>
    </div>
    <div class="idrow"><h1>Transazione</h1>
      <span class="mono muted" title="${esc(id)}">${esc(shortId(id))}</span>
      <button class="copy" data-copy="${esc(id)}">copia id</button></div>
    ${headline}
    <div class="tiles" style="margin-top:14px">
      <div><div class="k">In uscita (totale box)</div><div class="v">${formatErg(totalOut)}</div>
        <div class="s">resto compreso — modello UTXO</div></div>
      <div><div class="k">Token spostati</div><div class="v">${tokenIds.size} ${tokenIds.size === 1 ? 'tipo' : 'tipi'}</div><div class="s">&nbsp;</div></div>
      <div><div class="k">Commissione</div><div class="v">${formatErg(fee)}</div><div class="s">&nbsp;</div></div>
      <div><div class="k">Blocco</div><div class="v">${tx.inclusionHeight ? groupThousands(String(tx.inclusionHeight)) : '—'}</div>
        <div class="s">${tx.size ? (tx.size / 1024).toFixed(2).replace('.', ',') + ' kB' : ''}</div></div>
    </div>
  </div>
  <div class="card">
    <details class="adv-open"><summary>Dettaglio dei box <span class="count">— ${tx.inputs.length} input, ${tx.outputs.length} output</span><span class="adv">tecnico</span></summary>
      <div class="details-body">
        <h2 style="font-size:14px;margin:6px 0 10px">Input</h2>
        ${tx.inputs.map(b => boxHtml(b, 'speso')).join('')}
        <h2 style="font-size:14px;margin:16px 0 10px">Output</h2>
        ${tx.outputs.map(b => boxHtml(b, b.spentTransactionId ? 'speso' : 'non speso')).join('')}
      </div>
    </details>
  </div>`
}
