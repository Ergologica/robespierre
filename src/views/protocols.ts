import { api, ergPrice } from '../api/explorer'
import { SIGMAUSD, ROSEN, ORACLE } from '../decoder/protocols'
import { decode } from '../decoder/index'
import { esc } from './html'
import { formatErg, formatTokenAmount, groupThousands, relativeTime, isoUtc, shortId } from '../lib/format'
import { meter } from '../charts'
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
  document.title = 'Protocolli · Robespierre'
  const [bank, oracle, rosen, price, usdTok, rsvTok, lastOp] = await Promise.all([
    fetchBoxByNft(SIGMAUSD.bankNft, SIGMAUSD.bankAddress),
    fetchBoxByNft(ORACLE.ergUsdNft),
    api.addressBalance(ROSEN.hotWallet), ergPrice(),
    api.token(SIGMAUSD.sigUsd), api.token(SIGMAUSD.sigRsv),
    lastBankOp(),
  ])

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
      : ratioShown < 400 ? { sig: 'warn', text: 'Sotto il minimo del 400%: il mint di SigUSD è chiuso, i riscatti restano aperti' }
      : ratioShown > 800 ? { sig: 'info', text: "Sopra l'800%: il mint di SigRSV è chiuso" }
      : { sig: 'ok', text: 'Dentro la banda 400–800%: mint e riscatti aperti' }
    ;(globalThis as Record<string, unknown>).__protoRatio = ratioShown
    sigmaSection = `
    <div class="tiles">
      <div><div class="k">Riserva della banca</div><div class="v">${formatErg(stats.reserveErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(stats.reserveErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">SigUSD in circolazione</div><div class="v">${formatTokenAmount(stats.circUsdUnits, 2)}</div>
        <div class="s">emissione − quanto è in banca</div></div>
      <div><div class="k">Tasso di riserva · oracolo</div>
        <div class="v">${oracleRatio != null ? oracleRatio.toFixed(0) + '%' : '—'}</div>
        <div class="s">quello che usa il protocollo${oracleErgUsd ? ` · oracolo: 1 ERG = ${oracleErgUsd.toFixed(3).replace('.', ',')} $` : ''}</div></div>
      <div><div class="k">Tasso · prezzo di mercato</div>
        <div class="v">${stats.reserveRatioPct != null ? stats.reserveRatioPct.toFixed(0) + '%' : '—'}</div>
        <div class="s">indicativo, per confronto</div></div>
    </div>
    <div class="chart-wrap" data-ratio></div>
    ${state ? `<div class="card-pad" style="padding-top:0"><div class="check"><span class="sig ${state.sig}">${state.sig === 'ok' ? '✓' : state.sig === 'warn' ? '⚠' : '·'}</span><span>${esc(state.text)}</span></div></div>` : ''}
    ${lastOp ? `<div class="card-pad" style="padding-top:0"><div class="check"><span class="sig info">·</span>
      <span>Ultima operazione: <a href="#/tx/${esc(lastOp.tx.id)}">${esc(lastOp.headline)}</a>
      <span class="dim">· ${relativeTime(lastOp.tx.timestamp)}</span></span></div></div>` : ''}
    <div class="note">SigRSV in circolazione: ${formatTokenAmount(stats.circRsvUnits, 0)}. Il tasso "oracolo" usa il box dell'oracolo ERG/USD
      (quello coi dataInput delle operazioni della banca); quello "di mercato" usa il prezzo degli exchange. Se divergono, è l'oracolo che comanda il protocollo.</div>`
  } else {
    sigmaSection = `<div class="card-pad dim">La banca non è raggiungibile in questo momento — i dati restano sulla catena, riprova tra poco.</div>`
  }

  const rosenErg = BigInt(rosen.nanoErgs)
  const rosenTokens = (rosen.tokens ?? [])
    .slice()
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))
    .slice(0, 8)
  const rosenList = rosenTokens.map(t =>
    `<div class="arow"><span><a href="#/token/${esc(t.tokenId)}">${esc(t.name?.trim() || shortId(t.tokenId, 8))}</a></span>
     <span>${formatTokenAmount(BigInt(t.amount), t.decimals ?? 0)}</span></div>`).join('')

  return `
  <div class="card">
    <div class="card-head"><h2>${icons.bank}SigmaUSD</h2>
      <p>La stablecoin algoritmica di Ergo. Tutto letto ora dai box in catena — banca e oracolo compresi.</p></div>
    ${sigmaSection}
  </div>
  <div class="card">
    <div class="card-head"><h2>${icons.bridge}Rosen Bridge — hot wallet</h2>
      <p>I fondi operativi del ponte sul lato Ergo. Il grosso della custodia sta nel cold wallet multifirma, non qui.</p></div>
    <div class="tiles">
      <div><div class="k">ERG nel hot wallet</div><div class="v">${formatErg(rosenErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(rosenErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">Token custoditi</div><div class="v">${rosen.tokens?.length ?? 0} tipi</div>
        <div class="s">token avvolti in transito</div></div>
      <div style="grid-column:span 2"><div class="k">Indirizzo · <a href="#/address/${esc(ROSEN.hotWallet)}">apri la pagina</a></div>
        <div class="s mono" style="margin-top:6px;word-break:break-all">${ROSEN.hotWallet.slice(0, 60)}…</div></div>
    </div>
    ${rosenList ? `<div class="card-pad" style="padding-top:6px"><div class="k" style="margin-bottom:6px">I maggiori per quantità — ogni nome apre la pagella</div>${rosenList}</div>` : ''}
  </div>
  <div class="warnbox">Questa pagina non dà giudizi di solvibilità: mostra i numeri della catena e dichiara le proprie approssimazioni.</div>`
}

export function mountProtocolCharts(): void {
  const host = document.querySelector('[data-ratio]') as HTMLElement | null
  const ratio = (globalThis as Record<string, unknown>).__protoRatio as number | null
  if (!host || ratio == null) return
  meter(host, {
    label: 'Tasso di riserva (banda del protocollo: 400–800%)',
    big: ratio.toFixed(0) + '%',
    pct: Math.min(1, ratio / 800),
    left: 'minimo per il mint: 400%',
    right: 'massimo: 800%',
    tipTitle: 'Tasso di riserva',
    tipLine: "calcolato con l'oracolo del protocollo quando disponibile",
  })
}
