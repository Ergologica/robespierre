import { api, ergPrice, protocolsLog } from '../api/explorer'
import type { ProtocolPoint } from '../api/explorer'
import { SIGMAUSD, ROSEN, ORACLE } from '../decoder/protocols'
import { decode } from '../decoder/index'
import { esc } from './html'
import { formatErg, formatTokenAmount, formatPct, groupThousands, relativeTime, shortId } from '../lib/format'
import { L } from '../i18n'
import { meter, sparkline } from '../charts'
import { icons } from '../icons'
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

  let sigmaSection: string
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
    const state = ratioShown == null ? null
      : ratioShown < 400 ? { sig: 'warn', text: L.ratio_below }
      : ratioShown > 800 ? { sig: 'info', text: L.ratio_above }
      : { sig: 'ok', text: L.ratio_ok }
    ;(globalThis as Record<string, unknown>).__protoRatio = ratioShown
    sigmaSection = `
    <div class="tiles">
      <div><div class="k">${L.reserve}</div><div class="v">${formatErg(stats.reserveErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(stats.reserveErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">${L.circ_sig}</div><div class="v">${formatTokenAmount(stats.circUsdUnits, 2)}</div>
        <div class="s">${L.circ_sig_s}</div></div>
      <div><div class="k">${L.ratio_market}</div>
        <div class="v">${stats.reserveRatioPct != null ? stats.reserveRatioPct.toFixed(0) + '%' : '—'}</div>
        <div class="s">${L.ratio_market_s}</div></div>
    </div>
    <div class="chart-wrap" data-ratio></div>
    ${oracleErgUsd ? `<div class="card-pad t-note dim" style="padding-top:0">${L.ratio_oracle_s} · ${L.oracle_rate} ${formatPct(oracleErgUsd, 3)} $</div>` : ''}
    ${sparkPoints.length >= 2 ? `<div class="chart-wrap" data-spark></div>
    <div class="note">${esc(L.spark_note(sparkPoints[0]!.at.slice(0, 10), sparkPoints.length))}</div>` : ''}
    ${state ? `<div class="card-pad" style="padding-top:0"><div class="check"><span class="sig ${state.sig}">${state.sig === 'ok' ? '✓' : state.sig === 'warn' ? '⚠' : '·'}</span><span>${esc(state.text)}</span></div></div>` : ''}
    ${lastOp ? `<div class="card-pad" style="padding-top:0"><div class="check"><span class="sig info">·</span>
      <span>${L.last_op} <a href="#/tx/${esc(lastOp.tx.id)}">${esc(lastOp.headline)}</a>
      <span class="dim">· ${relativeTime(lastOp.tx.timestamp)}</span></span></div></div>` : ''}
    <div class="note">${esc(L.sig_note(formatTokenAmount(stats.circRsvUnits, 0)))}</div>`
  } else {
    sigmaSection = `<div class="card-pad dim">${L.bank_down}</div>`
  }

  const rosenErg = BigInt(rosen.nanoErgs)
  const rosenTokens = (rosen.tokens ?? [])
    .slice()
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))
    .slice(0, 8)
  const rosenList = rosenTokens.map(t =>
    `<div class="arow"><span><a href="#/token/${esc(t.tokenId)}">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a></span>
     <span>${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0, 2)}</span></div>`).join('')

  return `
  <div class="card">
    <div class="card-head"><h2>${icons.bank}SigmaUSD</h2>
      <p>${L.proto_sig_p}</p></div>
    ${sigmaSection}
  </div>
  <div class="card">
    <div class="card-head"><h2>${icons.bridge}${L.rosen_h}</h2>
      <p>${L.rosen_p}</p></div>
    <div class="tiles">
      <div><div class="k">${L.rosen_erg}</div><div class="v">${formatErg(rosenErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(rosenErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">${L.held_tokens}</div><div class="v">${rosen.tokens?.length ?? 0} ${L.kind_many}</div>
        <div class="s">${L.in_transit}</div></div>
    </div>
    <div class="card-pad addr-row" style="padding-bottom:0">
      <span class="k">${L.address_k}</span>
      <span class="mono dim t-note">${esc(shortId(ROSEN.hotWallet, 16, 10))}</span>
      <a class="btn-link" href="#/address/${esc(ROSEN.hotWallet)}">${L.open_page}</a>
      <button class="copy" data-copy="${esc(ROSEN.hotWallet)}">${L.copy}</button>
    </div>
    ${rosenList ? `<div class="card-pad"><div class="k" style="margin-bottom:var(--sp-2)">${L.biggest}</div>${rosenList}</div>` : ''}
  </div>
  <div class="warnbox">${L.proto_warn}</div>`
}

let sparkPoints: ProtocolPoint[] = []

export function mountProtocolCharts(): void {
  const sHost = document.querySelector('[data-spark]') as HTMLElement | null
  if (sHost && sparkPoints.length >= 2) {
    sparkline(sHost, sparkPoints.map(p => ({ t: Date.parse(p.at), v: (p.ratioOracle ?? p.ratioMarket)! })),
      { label: L.spark_h, unit: '%', band: [400, 800] })
  }
  const host = document.querySelector('[data-ratio]') as HTMLElement | null
  const ratio = (globalThis as Record<string, unknown>).__protoRatio as number | null
  if (!host || ratio == null) return
  meter(host, {
    label: L.ratio_meter,
    big: ratio.toFixed(0) + '%',
    pct: Math.min(1, ratio / 800),
    left: L.ratio_min,
    right: L.ratio_max,
    tipTitle: L.ratio_tip,
    tipLine: L.ratio_tip_s,
  })
}
