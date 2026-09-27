import { api } from '../api/explorer'
import { decode } from '../decoder/index'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc, addrLink, labelOf } from './html'
import { utxoSchema } from '../charts'
import { icons } from '../icons'
import { L } from '../i18n'
import type { SchemaNode } from '../charts'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId , formatPct } from '../lib/format'
import { txMovement } from '../lib/movement'
import type { Movement } from '../lib/movement'
import type { BoxLike } from '../api/types'

const MAX_TOKENS_SHOWN = 8

function boxHtml(b: BoxLike, spentLabel: string): string {
  const assets = b.assets ?? []
  const shown = assets.slice(0, MAX_TOKENS_SHOWN)
  const hidden = assets.length - shown.length
  const tokens = shown.map(a =>
    `<a href="#/token/${esc(a.tokenId)}">${esc(a.name?.trim() || shortId(a.tokenId, 8))}</a> ${formatTokenAmount(BigInt(a.amount), a.decimals ?? 0)}`,
  ).join(' · ')
  return `<div class="box">
    <div class="head"><span class="mono">${esc(shortId(b.boxId, 8))}</span>
      ${addrLink(b.address)} <span class="tag ${spentLabel === L.unspent ? 'unspent' : ''}">${spentLabel}</span></div>
    <div class="kv">
      <span class="kk">${L.value_k}</span><span>${formatErg(BigInt(b.value))}</span>
      ${assets.length ? `<span class="kk">${L.tokens_k}</span><span>${tokens}${hidden > 0 ? ` <span class="dim">· +${hidden} ${L.other_tokens}</span>` : ''}</span>` : ''}
    </div>
  </div>`
}

function partyName(addr: string): string {
  return labelOf(addr) ?? shortId(addr, 10)
}

/** Il flusso mittente → destinatario, dai SALDI per indirizzo. Solo quando è chiaro.
 *  Prima si prendeva «il box in uscita più grosso verso un indirizzo nuovo»: su una
 *  transazione con contratti quello è spesso un resto da 0,02 ERG, e la pagina lo
 *  presentava come il destinatario. Se i saldi non indicano un pagante e un
 *  ricevente dominanti, qui non si disegna niente: tacere è previsto. */
function flowCard(m: Movement): string {
  if (!m.clear || !m.payer || !m.receiver) return ''
  const chip = (t: { tokenId: string; name: string | null; decimals: number; amount: bigint }) =>
    `<span class="tokchip">${esc(formatTokenAmount(t.amount, t.decimals))} <a href="#/token/${esc(t.tokenId)}">${esc(t.name || shortId(t.tokenId, 8))}</a></span>`
  const toks = m.receiverTokens.slice(0, 3).map(chip).join('')
    + (m.receiverTokens.length > 3 ? `<span class="tokchip">+${m.receiverTokens.length - 3} ${L.other_tokens}</span>` : '')
  const erg = m.ergMoved > 0n ? formatErg(m.ergMoved, 2) : null
  return `<div class="card"><div class="flow">
    <div class="party"><div class="role">${L.from}</div>
      <div class="pname">${esc(partyName(m.payer))}</div>
      ${erg ? `<div class="amt out">−${erg}</div>` : ''}</div>
    <div class="arrow">→</div>
    <div class="party"><div class="role">${L.to}</div>
      <div class="pname">${addrLink(m.receiver)}</div>
      ${erg ? `<div class="amt in">+${erg}</div>` : ''}
      <div>${toks}</div></div>
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
      title: `${L.other_boxes} ${rest.length} ${L.box_w}`,
      sub: formatErg(rest.reduce((s2, b) => s2 + BigInt(b.value), 0n), 2) + ` (${L.boxes_agg})`,
      tip: L.boxes_agg_tip,
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
    { title: shortId(tx.id, 8), sub: formatErg(tx.outputs.reduce((s2, o) => s2 + BigInt(o.value), 0n), 2), tip: L.out_total, accent: 'var(--s1)' },
    outs, { in: L.schema_in, tx: L.schema_tx, out: L.schema_out })
}

export async function txView(id: string): Promise<string> {
  const tx = await api.tx(id)
  const decoded = decode(tx)
  const hasContract = [...tx.inputs, ...tx.outputs].some(b => !b.address.startsWith('9') && b.address !== FEE_ADDRESS)

  const mov = txMovement(tx, FEE_ADDRESS)
  const conf = tx.numConfirmations ?? 0

  const headline = decoded
    ? `<div class="headline">${esc(decoded.headline)}<span class="conf">${decoded.confidence === 'certa' ? L.reading_sure : L.reading_prob}</span></div>`
    : hasContract
      ? `<div class="headline">${L.not_cataloged} <span class="conf">${L.not_cataloged_s}</span></div>`
      : ''

  document.title = `Tx ${shortId(id)} · Robespierre`
  return `
  <div class="card">
    <div class="statusline">
      <span class="pill ${conf > 0 ? 'ok' : 'wait'}">${conf > 0 ? '✓ ' + L.confirmed : L.in_mempool}</span>
      ${conf > 0 ? `<span class="muted">${groupThousands(String(conf))} ${L.confirmations}</span>` : ''}
      <span class="dim">·</span><span class="muted">${relativeTime(tx.timestamp)}</span>
      <span class="grow"></span><span class="dim mono">${isoUtc(tx.timestamp)}</span>
    </div>
    <div class="idrow"><h1>${L.tx}</h1>
      <span class="mono muted" title="${esc(id)}">${esc(shortId(id))}</span>
      <button class="copy" data-copy="${esc(id)}">${L.copy_id}</button>
      <a class="btn-link" href="https://api.ergoplatform.com/api/v1/transactions/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.raw_json}</a>
      <a class="btn-link" href="https://explorer.ergoplatform.com/en/transactions/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.official_explorer}</a></div>
    ${headline}
    <div class="tiles" style="margin-top:14px">
      <div class="tile-hero"><div class="k"><span class="help" title="${esc(L.moved_tip)}">${L.moved}</span></div>
        <div class="v">${formatErg(mov.ergMoved)}</div>
        <div class="s">${esc(L.of_which_out(formatErg(mov.totalOut)))}</div></div>
      <div><div class="k">${L.tokens_moved}</div><div class="v">${mov.tokens.length} ${mov.tokens.length === 1 ? L.kind_one : L.kind_many}</div>
        <div class="s">${mov.tokens.length ? esc(formatTokenAmount(mov.tokens[0]!.amount, mov.tokens[0]!.decimals) + ' ' + (mov.tokens[0]!.name || shortId(mov.tokens[0]!.tokenId, 6))) : '&nbsp;'}</div></div>
      <div><div class="k">${L.fee}</div><div class="v">${formatErg(mov.fee)}</div><div class="s">&nbsp;</div></div>
      <div><div class="k">${L.block}</div><div class="v">${tx.inclusionHeight ? groupThousands(String(tx.inclusionHeight)) : '—'}</div>
        <div class="s">${tx.size ? formatPct(tx.size / 1024) + ' kB' : ''}</div></div>
    </div>
  </div>
  ${flowCard(mov)}
  <div class="card">
    <div class="card-head"><h2>${L.schema_h}</h2>
      <p>${L.schema_p}</p></div>
    <div class="chart-wrap" data-schema></div>
  </div>
  <div class="card">
    <details class="adv-open"><summary>${L.box_detail} <span class="count">— ${tx.inputs.length} input, ${tx.outputs.length} output</span><span class="adv">${L.technical}</span></summary>
      <div class="details-body">
        <h2 class="t-sub" style="margin:var(--sp-2) 0 var(--sp-3)">${L.input}</h2>
        ${tx.inputs.map(b => boxHtml(b, L.spent)).join('')}
        <h2 class="t-sub" style="margin:var(--sp-5) 0 var(--sp-3)">${L.output}</h2>
        ${tx.outputs.map(b => boxHtml(b, b.spentTransactionId ? L.spent : L.unspent)).join('')}
      </div>
    </details>
  </div>`
}
