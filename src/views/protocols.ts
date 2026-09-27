import { api, ergPrice, protocolsLog } from '../api/explorer'
import type { ProtocolPoint } from '../api/explorer'
import { SIGMAUSD, ROSEN, ORACLE } from '../decoder/protocols'
import { decode } from '../decoder/index'
import { esc } from './html'
import { formatErg, formatTokenAmount, formatPct, groupThousands, relativeTime, shortId } from '../lib/format'
import { L } from '../i18n'
import { sparkline } from '../charts'
import type { Tx } from '../api/types'

/**
 * La pagina-segnalibro: "i miei soldi sono al sicuro?".
 * Tutto dai box in catena, oracolo compreso. Il tasso col prezzo di mercato
 * resta accanto a quello ufficiale, ciascuno etichettato per quello che è.
 */

export interface AgeUsdStats {
  reserveErg: bigint
  circUsdUnits: bigint
  circRsvUnits: bigint
  reserveRatioPct: number | null
}

/** Statistiche col prezzo di MERCATO (indicativo). */
export function computeAgeUsd(o: {
  bankErg: bigint; bankUsdUnits: bigint; emissionUsd: bigint
  bankRsvUnits: bigint; emissionRsv: bigint; priceUsd: number | null
}): AgeUsdStats {
  const circUsdUnits = o.emissionUsd - o.bankUsdUnits
  const circRsvUnits = o.emissionRsv - o.bankRsvUnits
  let reserveRatioPct: number | null = null
  if (o.priceUsd && circUsdUnits > 0n) {
    const reserveUsd = Number(o.bankErg / 1_000_000n) / 1000 * o.priceUsd
    reserveRatioPct = (reserveUsd / (Number(circUsdUnits) / 100)) * 100
  }
  return { reserveErg: o.bankErg, circUsdUnits, circRsvUnits, reserveRatioPct }
}

/** Tasso UFFICIALE dall'oracolo: R4 = nanoERG per 1 USD → passività in nanoERG = circ¢ × R4/100. */
export function computeOracleRatio(o: { bankErg: bigint; circUsdUnits: bigint; oracleNanoPerUsd: bigint }): number | null {
  if (o.circUsdUnits <= 0n || o.oracleNanoPerUsd <= 0n) return null
  const liabilitiesNano = (o.circUsdUnits * o.oracleNanoPerUsd) / 100n
  if (liabilitiesNano === 0n) return null
  return Number((o.bankErg * 10_000n) / liabilitiesNano) / 100
}

interface UnspentBox { value: number | string; assets?: { tokenId: string; amount: number | string }[]; additionalRegisters?: Record<string, { renderedValue?: string }> }

async function fetchBoxByNft(nft: string, address?: string): Promise<UnspentBox | null> {
  try {
    const url = address
      ? `https://api.ergoplatform.com/api/v1/boxes/unspent/byAddress/${encodeURIComponent(address)}?limit=10`
      : `https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${nft}?limit=5`
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    return (j.items as UnspentBox[] ?? []).find(b => b.assets?.some(a => a.tokenId === nft)) ?? null
  } catch { return null }
}

/** L'ultima operazione utente della banca, decodificata dal motore di Fase 2. */
async function lastBankOp(): Promise<{ tx: Tx; headline: string } | null> {
  try {
    const r = await fetch(`https://api.ergoplatform.com/api/v1/addresses/${encodeURIComponent(SIGMAUSD.bankAddress)}/transactions?limit=5`)
    if (!r.ok) return null
    const j = await r.json()
    for (const tx of (j.items as Tx[] ?? [])) {
      const d = decode(tx)
      if (d?.kind === 'sigmausd') return { tx, headline: d.headline }
    }
    return null
  } catch { return null }
}

export async function protocolsView(): Promise<string> {
  document.title = L.nav_protocols + ' · Robespierre'
  const [bank, oracle, rosen, price, usdTok, rsvTok, lastOp, log] = await Promise.all([
    fetchBoxByNft(SIGMAUSD.bankNft, SIGMAUSD.bankAddress),
    fetchBoxByNft(ORACLE.ergUsdNft),
    api.addressBalance(ROSEN.hotWallet), ergPrice(),
    api.token(SIGMAUSD.sigUsd), api.token(SIGMAUSD.sigRsv),
    lastBankOp(), protocolsLog(),
  ])
  sparkPoints = (log ?? []).filter(p => p.ratioOracle != null || p.ratioMarket != null)
  const usdOf = (nano: bigint) => price ? '≈ ' + groupThousands(String(Math.round(Number(nano / 1_000_000n) / 1000 * price.usd))) + ' $' : '&nbsp;'

  // SigmaUSD: la testata è lo STATO del protocollo detto in una frase, dal tasso letto ora
  let hero: string
  let sigmaSecs = ''
  if (bank && usdTok?.emissionAmount != null && rsvTok?.emissionAmount != null) {
    const stats = computeAgeUsd({
      bankErg: BigInt(bank.value),
      bankUsdUnits: BigInt(bank.assets!.find(a => a.tokenId === SIGMAUSD.sigUsd)?.amount ?? 0),
      emissionUsd: BigInt(usdTok.emissionAmount),
      bankRsvUnits: BigInt(bank.assets!.find(a => a.tokenId === SIGMAUSD.sigRsv)?.amount ?? 0),
      emissionRsv: BigInt(rsvTok.emissionAmount),
      priceUsd: price?.usd ?? null,
    })
    const oracleNano = oracle?.additionalRegisters?.R4?.renderedValue
    const oracleRatio = oracleNano
      ? computeOracleRatio({ bankErg: stats.reserveErg, circUsdUnits: stats.circUsdUnits, oracleNanoPerUsd: BigInt(oracleNano) })
      : null
    const oracleErgUsd = oracleNano ? 1e9 / Number(oracleNano) : null
    const ratioShown = oracleRatio ?? stats.reserveRatioPct
    const state: 'below' | 'ok' | 'above' | null = ratioShown == null ? null
      : ratioShown < 400 ? 'below' : ratioShown > 800 ? 'above' : 'ok'
    const stateText = state === 'below' ? L.ratio_below : state === 'above' ? L.ratio_above : state === 'ok' ? L.ratio_ok : ''
    const sig = state === 'below' ? 'warn' : state === 'ok' ? 'ok' : 'info'
    const r = ratioShown != null ? ratioShown.toFixed(0) + '%' : '—'
    // la banda del protocollo disegnata: 400 e 800 come tacche, il tasso come barra
    const dom = Math.max(1000, Math.ceil((ratioShown ?? 0) / 100) * 100 + 100)
    const band = ratioShown != null ? `<div class="band" role="img" aria-label="${esc(L.ratio_meter)}: ${r}">
        <i style="width:${Math.min(100, 100 * ratioShown / dom).toFixed(1)}%"></i>
        <b style="left:${(100 * 400 / dom).toFixed(1)}%" title="${esc(L.ratio_min)}"></b><b style="left:${(100 * 800 / dom).toFixed(1)}%" title="${esc(L.ratio_max)}"></b></div>
      <div class="band-lab"><span>0%</span><span>${L.ratio_band_lab}</span><span>${dom}%</span></div>` : ''
    hero = `<section class="phero">
    <div class="phero-l">
      <div class="live"><span class="dot" aria-hidden="true"></span><span>${L.proto_live}${oracleErgUsd ? ` · ${L.oracle_rate} ${formatPct(oracleErgUsd, 3)} $` : ''}</span></div>
      <h1 class="ph1">${esc(L.proto_h1(r, state))}</h1>
      <p class="lede">${L.proto_sig_p}</p>
    </div>
    <div class="phero-r">
      <div class="pbig"><div class="pbig-top"><span class="pbig-n">${r}</span>
        <span class="pbig-s">${oracleRatio != null ? L.ratio_oracle : L.ratio_market}<br>${oracleRatio != null ? L.ratio_oracle_s : L.ratio_market_s}</span></div>
        ${band}</div>
      <div class="ptiles">
        <div><span class="k">${L.reserve}</span><span class="v2">${formatErg(stats.reserveErg, 0)}</span><span class="s">${usdOf(stats.reserveErg)}</span></div>
        <div><span class="k">${L.circ_sig}</span><span class="v2">${formatTokenAmount(stats.circUsdUnits, 2)}</span><span class="s">${L.circ_sig_s}</span></div>
        <div><span class="k">${L.ratio_market}</span><span class="v2">${stats.reserveRatioPct != null ? stats.reserveRatioPct.toFixed(0) + '%' : '—'}</span><span class="s">${L.ratio_market_s}</span></div>
        <div><span class="k">${L.circ_rsv}</span><span class="v2">${formatTokenAmount(stats.circRsvUnits, 0)}</span><span class="s">${L.circ_sig_s}</span></div>
      </div>
    </div>
  </section>`
    sigmaSecs = `
  ${state ? `<section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.proto_ops_h}</h2><p class="sec-p">${L.proto_ops_p}</p></div></div>
    <div class="check"><span class="sig ${sig}">${sig === 'ok' ? '✓' : sig === 'warn' ? '⚠' : '·'}</span><span>${esc(stateText)}</span></div>
    ${lastOp ? `<div class="check"><span class="sig info">·</span><span>${L.last_op} <a href="#/tx/${esc(lastOp.tx.id)}">${esc(lastOp.headline)}</a>
      <span class="dim">· <span data-ago="${lastOp.tx.timestamp}">${relativeTime(lastOp.tx.timestamp)}</span></span></span></div>` : ''}
  </section>` : ''}
  ${sparkPoints.length >= 2 ? `<section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.spark_h}</h2><p class="sec-p">${esc(L.spark_note(sparkPoints[0]!.at.slice(0, 10), sparkPoints.length))}</p></div></div>
    <div class="chart-wrap" data-spark></div>
    <div class="note">${esc(L.sig_note(formatTokenAmount(stats.circRsvUnits, 0)))}</div>
  </section>` : `<section class="sec"><div class="note">${esc(L.sig_note(formatTokenAmount(stats.circRsvUnits, 0)))}</div></section>`}`
  } else {
    hero = `<section class="phero"><div class="phero-l">
      <h1 class="ph1">${L.nav_protocols}</h1><p class="lede dim">${L.bank_down}</p></div></section>`
  }

  const rosenErg = BigInt(rosen.nanoErgs)
  const rosenTokens = (rosen.tokens ?? [])
    .slice()
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))
    .slice(0, 8)
  const rosenRows = rosenTokens.map(t =>
    `<tr><td><a class="mk-sym" href="#/token/${esc(t.tokenId)}">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a></td>
     <td class="num">${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0, 2)}</td></tr>`).join('')

  return `<div class="page">
  ${hero}
  ${sigmaSecs}
  <section class="sec">
    <div class="sec-head"><div><h2 class="h2">${L.rosen_h}</h2><p class="sec-p">${L.rosen_p}</p></div>
      <div class="sec-r"><a class="ext" href="#/address/${esc(ROSEN.hotWallet)}">${L.open_page} ›</a></div></div>
    <div class="ptiles ptiles-3 proto-rosen">
      <div><span class="k">${L.rosen_erg}</span><span class="v2">${formatErg(rosenErg, 0)}</span><span class="s">${usdOf(rosenErg)}</span></div>
      <div><span class="k">${L.held_tokens}</span><span class="v2">${rosen.tokens?.length ?? 0} ${L.kind_many}</span><span class="s">${L.in_transit}</span></div>
      <div><span class="k">${L.address_k}</span><span class="v2 mono t-note">${esc(shortId(ROSEN.hotWallet, 12, 6))}</span>
        <span class="s"><button class="copy" type="button" data-copy="${esc(ROSEN.hotWallet)}">${L.copy}</button></span></div>
    </div>
    ${rosenRows ? `<h3 class="t-sub proto-h3">${L.biggest}</h3>
    <div class="flat"><table><thead><tr><th>${L.th_name}</th><th class="num">${L.th_qty}</th></tr></thead><tbody>${rosenRows}</tbody></table></div>` : ''}
  </section>
  <div class="pnote">${L.proto_warn}</div>
</div>`
}

let sparkPoints: ProtocolPoint[] = []

export function mountProtocolCharts(): void {
  const sHost = document.querySelector('[data-spark]') as HTMLElement | null
  if (sHost && sparkPoints.length >= 2) {
    sparkline(sHost, sparkPoints.map(p => ({ t: Date.parse(p.at), v: (p.ratioOracle ?? p.ratioMarket)! })),
      { label: L.spark_h, unit: '%', band: [400, 800], noLabel: true })
  }
}
