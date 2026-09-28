import { api } from '../api/explorer'
import { decodeWith } from '../decoder/index'
import { explain, sourceUrl, FIXTURES } from '../decoder/explain'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { esc, addrLink, labelOf, labelInfo } from './html'
import { utxoSchema } from '../charts'
import { icons } from '../icons'
import { L } from '../i18n'
import type { SchemaNode } from '../charts'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId, formatPct } from '../lib/format'
import { txMovement, ledgerSide, DUST_NANO } from '../lib/movement'
import { markAmounts, linkAddresses } from '../lib/feed'
import { cameFromFallback } from '../api/explorer'
import type { Movement, LedgerRow, SignedToken } from '../lib/movement'
import type { BoxLike, Tx } from '../api/types'

/**
 * La transazione in tre livelli (rinnovo «Cronaca», 27/09/2026).
 *
 * Prima la pagina apriva con la parola «Transazione» e un hash; la frase stava in un
 * riquadro sotto. Adesso la frase È il titolo, subito sotto si dichiara chi l'ha letta
 * e su quante transazioni reali è stato verificato, e i dati stanno in tre livelli:
 *   Racconto — chi ha dato cosa a chi, per differenza (lib/movement.ts)
 *   Schema   — il modello UTXO disegnato
 *   Box      — il dettaglio tecnico, com'è
 * Il livello si sceglie coi tab, e il tab scelto finisce nell'URL.
 */

export type TxTab = 'story' | 'schema' | 'box'
export const TX_TABS: readonly TxTab[] = ['story', 'schema', 'box']

const MAX_TOKENS_SHOWN = 8
/** Righe del libro mastro per lato: oltre, si aggregano e si dice quante sono. */
const MAX_ROWS_SIDE = 3

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

/** Importo con il segno tipografico vero (−, non -) e decimali secondo la grandezza:
 *  due sopra i 10 ERG, come nella frase; sotto, quanti ne servono a non scrivere «0». */
function signedErg(v: bigint): string {
  const abs = v < 0n ? -v : v
  const d = abs >= 10_000_000_000n ? 2 : abs >= DUST_NANO ? 4 : 6
  return (v < 0n ? '−' : '+') + formatErg(abs, d)
}
function signedTok(t: SignedToken): string {
  const abs = t.amount < 0n ? -t.amount : t.amount
  // quattro decimali bastano quasi sempre; quando arrotondano a zero («+0 GIF» su 8 unità
  // di un token a 9 decimali) si scrive l'importo intero: uno zero sarebbe una bugia
  let n = formatTokenAmount(abs, t.decimals, 4)
  if (/^0([.,]0*)?$/.test(n)) n = formatTokenAmount(abs, t.decimals)
  return (t.amount < 0n ? '−' : '+') + n + ' ' + (t.name || shortId(t.tokenId, 6))
}

/** Chi è, detto con la fonte: etichetta pubblica, oppure wallet o contratto senza nome. */
function whoNote(addr: string): string {
  const info = labelInfo(addr)
  if (info) return L.led_labeled(L.led_cat(info.category ?? ''))
  return addr.startsWith('9') && addr.length === 51 ? L.led_wallet : L.led_contract
}

function amountCell(r: LedgerRow): string {
  const side = ledgerSide(r)
  const abs = r.erg < 0n ? -r.erg : r.erg
  const ergMain = abs > DUST_NANO || !r.tokens.length
  const main = ergMain ? signedErg(r.erg) : signedTok(r.tokens[0]!)
  const rest = ergMain ? r.tokens : r.tokens.slice(1)
  const sub = rest.slice(0, 2).map(t => `<span class="${t.amount < 0n ? 'out' : 'in'}">${esc(signedTok(t))}</span>`)
  if (rest.length > 2) sub.push(`<span>+${rest.length - 2} ${L.other_tokens_short}</span>`)
  if (!ergMain && r.erg !== 0n) sub.push(`<span>${esc(signedErg(r.erg))}</span>`)
  return `<div class="lamt"><span class="lv ${side}">${esc(main)}</span>${sub.length ? `<span class="ltok">${sub.join(' · ')}</span>` : ''}</div>`
}

function row(r: LedgerRow): string {
  const side = ledgerSide(r)
  return `<div class="lrow">
    <span class="lrole">${side === 'out' ? L.led_from : L.led_to}</span>
    <div class="lwho"><a class="lname${labelOf(r.address) ? '' : ' mono'}" href="#/address/${esc(r.address)}" title="${esc(r.address)}">${esc(partyName(r.address))}</a>
      <span class="lnote">${esc(whoNote(r.address))}</span></div>
    ${amountCell(r)}
  </div>`
}

function aggregate(rows: LedgerRow[], side: 'out' | 'in'): string {
  const erg = rows.reduce((s, r) => s + r.erg, 0n)
  return `<div class="lrow">
    <span class="lrole">${side === 'out' ? L.led_from : L.led_to}</span>
    <div class="lwho"><span class="lname">${esc(L.led_others(rows.length))}</span><span class="lnote">${esc(L.led_others_note)}</span></div>
    <div class="lamt"><span class="lv ${side}">${esc(erg === 0n ? '—' : signedErg(erg))}</span></div>
  </div>`
}

/** Il racconto: il libro mastro della transazione, poi il resto dichiarato. */
function ledgerHtml(m: Movement): string {
  // chi ha pagato SOLO la commissione non è un movimento: finisce nella riga della rete
  const onlyFee = m.fee > 0n ? m.ledger.find(r => r.erg === -m.fee && !r.tokens.length) : undefined
  const rows = m.ledger.filter(r => r !== onlyFee)
  const outs = rows.filter(r => ledgerSide(r) === 'out')
  const ins = rows.filter(r => ledgerSide(r) === 'in')
  const feePayer = onlyFee?.address ?? (outs.length === 1 ? outs[0]!.address : null)

  const side = (list: LedgerRow[], s: 'out' | 'in') =>
    list.length <= MAX_ROWS_SIDE + 1
      ? list.map(row).join('')
      : list.slice(0, MAX_ROWS_SIDE).map(row).join('') + aggregate(list.slice(MAX_ROWS_SIDE), s)

  const feeRow = m.fee > 0n ? `<div class="lrow">
      <span class="lrole">${L.led_net}</span>
      <div class="lwho"><span class="lname">${L.led_fee}</span><span class="lnote">${esc(L.led_fee_note(feePayer ? partyName(feePayer) : null))}</span></div>
      <div class="lamt"><span class="lv neutral">${esc(formatErg(m.fee))}</span></div>
    </div>` : ''

  const empty = !rows.length ? `<div class="lrow lrow-empty"><span></span><span class="lnote">${L.led_none}</span><span></span></div>` : ''
  const r = m.returned
  const change = r && r.erg > DUST_NANO
    ? `<div class="lchange">${L.led_change(`<strong>${esc(formatErg(r.erg, 2))}${r.tokenKinds ? esc(L.led_and_tokens(r.tokenKinds)) : ''}</strong>`,
        `<a href="#/address/${esc(r.address)}">${esc(partyName(r.address))}</a>`)}</div>`
    : ''
  return `<div class="ledger">${side(outs, 'out')}${side(ins, 'in')}${empty}${feeRow}${change}</div>`
}

function tilesHtml(tx: Tx, m: Movement): string {
  const t0 = m.tokens[0]
  const stay = !m.tokens.length && m.returned?.tokenKinds
    ? esc(L.tile_tokens_stay(m.returned.tokenKinds, partyName(m.returned.address))) : '&nbsp;'
  return `<div class="tiles tiles-flat">
      <div class="tile-hero"><div class="k"><span class="help" title="${esc(L.moved_tip)}">${L.moved}</span></div>
        <div class="v">${formatErg(m.ergMoved)}</div>
        <div class="s">${esc(L.of_which_out(formatErg(m.totalOut)))}</div></div>
      <div><div class="k">${L.tokens_moved}</div>
        <div class="v">${m.tokens.length ? `${m.tokens.length} ${m.tokens.length === 1 ? L.kind_one : L.kind_many}` : L.tile_none}</div>
        <div class="s">${t0 ? esc(formatTokenAmount(t0.amount, t0.decimals) + ' ' + (t0.name || shortId(t0.tokenId, 6))) : stay}</div></div>
      <div><div class="k">${L.fee}</div><div class="v">${formatErg(m.fee)}</div><div class="s">${L.tile_fee_s}</div></div>
      <div><div class="k">${L.tile_size}</div><div class="v">${tx.size ? formatPct(tx.size / 1024) + ' kB' : '—'}</div>
        <div class="s">${esc(L.tile_size_s(tx.inputs.length, tx.outputs.length))}</div></div>
    </div>`
}

/** Disegna lo schema UTXO dentro [data-schema]. Si chiama quando il tab è VISIBILE:
 *  il grafico si misura sulla larghezza reale del contenitore, e un tab nascosto è largo 0. */
export function mountTxSchema(tx: Tx): void {
  const host = document.querySelector('[data-schema]') as HTMLElement | null
  if (!host || host.dataset.drawn) return
  host.dataset.drawn = '1'
  const box = (b: BoxLike): SchemaNode => ({
    title: partyName(b.address),
    sub: formatErg(BigInt(b.value), 2) + ((b.assets?.length ?? 0) ? ` + ${b.assets!.length} token` : ''),
    tip: formatErg(BigInt(b.value)) + ((b.assets?.length ?? 0) ? ` · ${b.assets!.length} tipi di token` : ''),
  })
  const toNodes = (boxes: BoxLike[], max: number): SchemaNode[] => {
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
  const byValue = (a: BoxLike, b: BoxLike) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1)
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

/** Mostra un tab e nasconde gli altri; lo schema si disegna la prima volta che si vede. */
export function selectTxTab(tab: TxTab, tx: Tx | null): void {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => {
    const on = b.dataset.tab === tab
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
  })
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab })
  if (tab === 'schema' && tx) mountTxSchema(tx)
}

export async function txView(id: string, tab: TxTab = 'story'): Promise<string> {
  const tx = await api.tx(id)
  const read = decodeWith(tx)
  const decoded = read?.decoded ?? null
  const hasContract = [...tx.inputs, ...tx.outputs].some(b => !b.address.startsWith('9') && b.address !== FEE_ADDRESS)
  const mov = txMovement(tx, FEE_ADDRESS)
  const conf = tx.numConfirmations ?? 0
  const addrs = [...tx.inputs, ...tx.outputs].map(b => b.address)
  const units = [...tx.inputs, ...tx.outputs].flatMap(b => (b.assets ?? []).map(a => a.name?.trim() ?? '')).filter(Boolean)

  // il titolo è la frase; senza lettura, lo si dice con le parole del flusso della home
  const title = decoded
    ? `<h1 class="tx-h1">${linkAddresses(markAmounts(esc(decoded.headline), units), addrs)}</h1>`
    : `<h1 class="tx-h1 tx-h1-raw">${esc(hasContract ? L.feed_raw(tx.inputs.length, tx.outputs.length) : L.feed_raw_wallet(tx.inputs.length, tx.outputs.length))}</h1>`

  const fx = read ? FIXTURES[read.recognizer] ?? 0 : 0
  const why = read
    ? `<div class="why ${decoded!.confidence === 'certa' ? 'why-sure' : 'why-prob'}">
        <span class="why-ic" aria-hidden="true">${icons.shield}</span>
        <div class="why-t"><strong>${decoded!.confidence === 'certa' ? L.why_sure : L.why_prob}</strong>
          <span class="muted"> · ${L.why_rec} <code class="mono">${esc(read.recognizer)}</code></span>
          <p>${esc(explain(read.recognizer, decoded!.kind))}${fx ? ' ' + esc(L.why_fixtures(fx)) : ''}</p></div>
        <a class="why-how" href="${esc(sourceUrl(read.recognizer))}" target="_blank" rel="noopener">${L.why_how} ›</a>
      </div>`
    : `<div class="why why-none">
        <span class="why-ic" aria-hidden="true"></span>
        <div class="why-t"><strong>${L.why_none}</strong>
          <p>${esc(hasContract ? L.why_none_p : L.why_none_wallet)}</p></div>
      </div>`

  const tabBtn = (t: TxTab, label: string, hint: string) =>
    `<button type="button" role="tab" id="tab-${t}" aria-controls="panel-${t}" data-tab="${t}"
      aria-selected="${t === tab}" tabindex="${t === tab ? 0 : -1}">${label}${hint ? `<span class="tab-hint">${hint}</span>` : ''}</button>`

  document.title = (decoded ? decoded.headline.slice(0, 60) : `Tx ${shortId(id)}`) + ' · Robespierre'
  // dalla fonte di riserva: si dice, e si dice cosa manca
  const reserve = cameFromFallback(tx) ? `<div class="notice">${L.src_fallback}</div>` : ''
  return `<div class="page-tx">
  <nav class="crumb" aria-label="breadcrumb">
    <a href="#/">${L.nav_net}</a><span aria-hidden="true">/</span><span>${L.tx}</span>
    <span class="mono" title="${esc(id)}">${esc(shortId(id))}</span>
    <button class="copy" type="button" data-copy="${esc(id)}">${L.copy_id}</button>
    <span class="grow"></span>
    <a class="ext" href="https://api.ergoplatform.com/api/v1/transactions/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.raw_json}</a>
    <a class="ext" href="https://explorer.ergoplatform.com/en/transactions/${esc(id)}" target="_blank" rel="noopener">${icons.ext}${L.official_explorer}</a>
  </nav>
  ${reserve}
  <div class="tx-status">
    <span class="pill ${conf > 0 ? 'ok' : 'wait'}">${conf > 0 ? '✓ ' + L.confirmed : L.in_mempool}</span>
    ${conf > 0 ? `<span>${groupThousands(String(conf))} ${L.confirmations}</span><span class="dim">·</span>` : ''}
    <span data-ago="${tx.timestamp}">${relativeTime(tx.timestamp)}</span>
    ${tx.inclusionHeight ? `<span class="dim">·</span><span>${L.live_block} <a href="#/block/${tx.inclusionHeight}">${groupThousands(String(tx.inclusionHeight))}</a></span>` : ''}
    <span class="grow"></span><span class="dim mono">${isoUtc(tx.timestamp)}</span>
  </div>
  ${title}
  ${why}
  <div class="tabs" role="tablist" aria-label="${L.tx}">
    ${tabBtn('story', L.tab_story, L.tab_story_hint)}${tabBtn('schema', L.tab_schema, '')}${tabBtn('box', L.tab_box, L.tab_box_hint)}
  </div>
  <section class="panel" role="tabpanel" id="panel-story" aria-labelledby="tab-story" data-panel="story"${tab === 'story' ? '' : ' hidden'}>
    ${ledgerHtml(mov)}
    ${tilesHtml(tx, mov)}
  </section>
  <section class="panel" role="tabpanel" id="panel-schema" aria-labelledby="tab-schema" data-panel="schema"${tab === 'schema' ? '' : ' hidden'}>
    <p class="panel-p">${L.schema_p}</p>
    <div class="chart-wrap chart-flat" data-schema></div>
  </section>
  <section class="panel" role="tabpanel" id="panel-box" aria-labelledby="tab-box" data-panel="box"${tab === 'box' ? '' : ' hidden'}>
    <h2 class="t-sub panel-h">${L.input} <span class="dim t-note">${tx.inputs.length}</span></h2>
    ${tx.inputs.map(b => boxHtml(b, L.spent)).join('')}
    <h2 class="t-sub panel-h">${L.output} <span class="dim t-note">${tx.outputs.length}</span></h2>
    ${tx.outputs.map(b => boxHtml(b, tx.spentUnknown ? L.spent_unknown : b.spentTransactionId ? L.spent : L.unspent)).join('')}
  </section>
</div>`
}
