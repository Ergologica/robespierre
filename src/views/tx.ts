import { api } from '../api/explorer'
import { decode } from '../decoder/index'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc, addrLink, labelOf } from './html'
import { utxoSchema } from '../charts'
import type { SchemaNode } from '../charts'
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

function partyName(addr: string): string {
  return labelOf(addr) ?? shortId(addr, 10)
}

/** Il flusso mittente → destinatario, aggregato. Solo quando la lettura è affidabile. */
function flowCard(tx: import('../api/types').Tx): string {
  const inputAddrs = new Set(tx.inputs.map(i => i.address))
  const recipients = tx.outputs.filter(o => o.address !== FEE_ADDRESS && !inputAddrs.has(o.address))
  if (!recipients.length) return ''
  const main = recipients.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b))
  const from = tx.inputs.reduce((a, b) => (BigInt(a.value) >= BigInt(b.value) ? a : b))
  const toTokens = (main.assets ?? []).slice(0, 3)
  const amount = BigInt(main.value)
  return `<div class="card"><div class="flow">
    <div class="party"><div class="role">Da</div>
      <div class="pname">${esc(partyName(from.address))}</div>
      <div class="amt out">−${formatErg(amount, 2)}</div></div>
    <div class="arrow">→</div>
    <div class="party"><div class="role">A</div>
      <div class="pname">${addrLink(main.address)}</div>
      <div class="amt in">+${formatErg(amount, 2)}</div>
      <div>${toTokens.map(a => `<span class="tokchip">${esc(formatTokenAmount(BigInt(a.amount), a.decimals ?? 0))} ${esc(a.name ?? shortId(a.tokenId, 8))}</span>`).join('')}${(main.assets ?? []).length > 3 ? `<span class="tokchip">+${(main.assets ?? []).length - 3} altri</span>` : ''}</div></div>
  </div></div>`
}

/** Disegna lo schema UTXO dentro [data-schema] dopo che l'HTML è in pagina. */
export function mountTxSchema(tx: import('../api/types').Tx): void {
  const host = document.querySelector('[data-schema]') as HTMLElement | null
  if (!host) return
  const box = (b: import('../api/types').BoxLike): SchemaNode => ({
    title: partyName(b.address),
    sub: formatErg(BigInt(b.value), 2) + ((b.assets?.length ?? 0) ? ` + ${b.assets!.length} token` : ''),
    tip: formatErg(BigInt(b.value)) + ((b.assets?.length ?? 0) ? ` · ${b.assets!.length} tipi di token` : ''),
  })
  const toNodes = (boxes: import('../api/types').BoxLike[], max: number): SchemaNode[] => {
    if (boxes.length <= max) return boxes.map(box)
    const shown = boxes.slice(0, max - 1).map(box)
    const rest = boxes.slice(max - 1)
    shown.push({
      title: `altri ${rest.length} box`,
      sub: formatErg(rest.reduce((s2, b) => s2 + BigInt(b.value), 0n), 2) + ' (aggregati)',
      tip: 'Aggregati per leggibilità: il dettaglio completo è nella sezione tecnica',
    })
    return shown
  }
  // nello schema contano i box più grandi, non i primi per indice
  const byValue = (a: import('../api/types').BoxLike, b: import('../api/types').BoxLike) =>
    BigInt(b.value) > BigInt(a.value) ? 1 : -1
  const insSorted = [...tx.inputs].sort(byValue)
  const outsSorted = [...tx.outputs].sort(byValue)
  const ins = toNodes(insSorted, 4)
  const outs = toNodes(outsSorted, 4)
  outsSorted.slice(0, 3).forEach((b, i) => {
    const n = outs[i]; if (!n) return
    if (b.address === FEE_ADDRESS) n.accent = 'var(--s3)'
  })
  const first = outs[0]; if (first && !first.accent) first.accent = 'var(--s2)'
  utxoSchema(host, ins,
    { title: shortId(tx.id, 8), sub: formatErg(tx.outputs.reduce((s2, o) => s2 + BigInt(o.value), 0n), 2), tip: 'Totale consumato e ricreato', accent: 'var(--s1)' },
    outs)
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
  ${flowCard(tx)}
  <div class="card">
    <div class="card-head"><h2>Come si muove il valore — schema UTXO</h2>
      <p>Una transazione Ergo consuma dei box e ne crea di nuovi: quello che non va al destinatario torna indietro come resto. È il motivo per cui il totale in uscita è più grande dell'importo inviato.</p></div>
    <div class="chart-wrap" data-schema></div>
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
