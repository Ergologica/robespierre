import { api, ergPrice } from '../api/explorer'
import { SIGMAUSD, ROSEN } from '../decoder/protocols'
import { formatErg, formatTokenAmount, groupThousands } from '../lib/format'
import { meter } from '../charts'

/**
 * La pagina-segnalibro: risponde a "i miei soldi sono al sicuro?" ogni settimana.
 * Tutto calcolato dai box in catena; l'unico dato esterno è il prezzo di mercato
 * dell'ERG, ed è DICHIARATO come indicativo — il protocollo usa il suo oracolo,
 * che leggeremo in una fase successiva.
 */

export interface AgeUsdStats {
  reserveErg: bigint          // nanoERG nella banca
  circUsdUnits: bigint        // centesimi di SigUSD in circolazione
  circRsvUnits: bigint        // SigRSV in circolazione
  reserveRatioPct: number | null // % — null se manca il prezzo
}

/** Funzione pura: dai numeri della banca alle statistiche. Testata su numeri reali. */
export function computeAgeUsd(o: {
  bankErg: bigint; bankUsdUnits: bigint; emissionUsd: bigint
  bankRsvUnits: bigint; emissionRsv: bigint; priceUsd: number | null
}): AgeUsdStats {
  const circUsdUnits = o.emissionUsd - o.bankUsdUnits
  const circRsvUnits = o.emissionRsv - o.bankRsvUnits
  let reserveRatioPct: number | null = null
  if (o.priceUsd && circUsdUnits > 0n) {
    const reserveUsd = Number(o.bankErg / 1_000_000n) / 1000 * o.priceUsd // via milli-ERG: resta nei limiti di Number
    const liabilitiesUsd = Number(circUsdUnits) / 100
    reserveRatioPct = (reserveUsd / liabilitiesUsd) * 100
  }
  return { reserveErg: o.bankErg, circUsdUnits, circRsvUnits, reserveRatioPct }
}

interface UnspentBox { value: number | string; assets?: { tokenId: string; amount: number | string }[] }

async function fetchBankBox(): Promise<UnspentBox | null> {
  try {
    const r = await fetch(`https://api.ergoplatform.com/api/v1/boxes/unspent/byAddress/${encodeURIComponent(SIGMAUSD.bankAddress)}?limit=10`)
    if (!r.ok) return null
    const j = await r.json()
    return (j.items as UnspentBox[] ?? []).find(b => b.assets?.some(a => a.tokenId === SIGMAUSD.bankNft)) ?? null
  } catch { return null }
}

export async function protocolsView(): Promise<string> {
  document.title = 'Protocolli · Robespierre'
  const [bank, rosen, price, usdTok, rsvTok] = await Promise.all([
    fetchBankBox(), api.addressBalance(ROSEN.hotWallet), ergPrice(),
    api.token(SIGMAUSD.sigUsd), api.token(SIGMAUSD.sigRsv),
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
    const ratio = stats.reserveRatioPct
    const state = ratio == null ? null
      : ratio < 400 ? { sig: 'warn', text: `Sotto il minimo del 400%: il mint di SigUSD è chiuso, i riscatti restano aperti` }
      : ratio > 800 ? { sig: 'info', text: `Sopra l'800%: il mint di SigRSV è chiuso` }
      : { sig: 'ok', text: 'Dentro la banda 400–800%: mint e riscatti aperti' }
    ;(globalThis as Record<string, unknown>).__protoRatio = ratio // per il meter montato dopo il render
    sigmaSection = `
    <div class="tiles">
      <div><div class="k">Riserva della banca</div><div class="v">${formatErg(stats.reserveErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(stats.reserveErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">SigUSD in circolazione</div><div class="v">${formatTokenAmount(stats.circUsdUnits, 2)}</div>
        <div class="s">emissione − quanto è in banca</div></div>
      <div><div class="k">SigRSV in circolazione</div><div class="v">${formatTokenAmount(stats.circRsvUnits, 0)}</div>
        <div class="s">quote di riserva</div></div>
      <div><div class="k">Tasso di riserva</div>
        <div class="v">${ratio != null ? ratio.toFixed(0) + '%' : '—'}</div>
        <div class="s">indicativo: prezzo di mercato, non l'oracolo del protocollo</div></div>
    </div>
    <div class="chart-wrap" data-ratio></div>
    ${state ? `<div class="card-pad" style="padding-top:0"><div class="check"><span class="sig ${state.sig}">${state.sig === 'ok' ? '✓' : state.sig === 'warn' ? '⚠' : '·'}</span><span>${state.text}</span></div></div>` : ''}`
  } else {
    sigmaSection = `<div class="card-pad dim">La banca non è raggiungibile in questo momento — i dati restano sulla catena, riprova tra poco.</div>`
  }

  const rosenErg = BigInt(rosen.nanoErgs)
  return `
  <div class="card">
    <div class="card-head"><h2>SigmaUSD</h2>
      <p>La stablecoin algoritmica di Ergo. Tutto letto ora dal box della banca (quello con il Bank NFT), non da un'API di terzi.</p></div>
    ${sigmaSection}
  </div>
  <div class="card">
    <div class="card-head"><h2>Rosen Bridge — hot wallet</h2>
      <p>I fondi operativi del ponte sul lato Ergo. Il grosso della custodia sta nel cold wallet multifirma, non qui.</p></div>
    <div class="tiles">
      <div><div class="k">ERG nel hot wallet</div><div class="v">${formatErg(rosenErg, 0)}</div>
        <div class="s">${price ? '≈ ' + groupThousands(String(Math.round(Number(rosenErg / 1_000_000n) / 1000 * price.usd))) + ' $' : ''}</div></div>
      <div><div class="k">Token custoditi</div><div class="v">${rosen.tokens?.length ?? 0} tipi</div>
        <div class="s">token avvolti in transito</div></div>
      <div style="grid-column:span 2"><div class="k">Indirizzo</div>
        <div class="s mono" style="margin-top:6px;word-break:break-all">${ROSEN.hotWallet.slice(0, 60)}…</div></div>
    </div>
  </div>
  <div class="warnbox">Questa pagina non dà giudizi di solvibilità: mostra i numeri della catena e dichiara le proprie approssimazioni.
    Il tasso di riserva ufficiale usa l'oracolo del protocollo; la lettura dell'oracolo è nel perimetro della prossima fase.</div>`
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
    tipLine: 'riserva in $ / SigUSD in circolazione — col prezzo di mercato ERG/USD',
  })
}
