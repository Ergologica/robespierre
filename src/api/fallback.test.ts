import { describe, it, expect, vi, afterEach } from 'vitest'
import { fallbackAllowed, worthFallingBack, errorInBody, isPhantomTx, renderSerialized, adaptFallback } from './fallback'
import { api, cameFromFallback, ApiError } from './explorer'
import usdDatapoint from '../decoder/fixtures/oracle-usd-datapoint.json'

/* Le due trappole misurate il 27/09/2026 su sigmaspace, e la lista degli endpoint dove il
   ripiego è permesso. Tutto il resto del sito non deve accorgersi di niente. */

describe('dove si può ripiegare, e quando', () => {
  it('solo sugli endpoint misurati uguali', () => {
    expect(fallbackAllowed('/transactions/' + 'a'.repeat(64))).toBe(true)
    expect(fallbackAllowed('/tokens/' + 'b'.repeat(64))).toBe(true)
    expect(fallbackAllowed('/info')).toBe(true)
    expect(fallbackAllowed('/addresses/9gnhfapSW2RtUYXR7DukoaSZfZpNazzcuyUhay5mjBW91qHS345/transactions?offset=0&limit=20')).toBe(true)
    // saldo, blocchi, ricerca: su sigmaspace non esistono o hanno un'altra forma
    expect(fallbackAllowed('/addresses/9gnhfapSW2RtUYXR7DukoaSZfZpNazzcuyUhay5mjBW91qHS345/balance/confirmed')).toBe(false)
    expect(fallbackAllowed('/blocks?limit=8&sortBy=height&sortDirection=desc')).toBe(false)
    expect(fallbackAllowed('/tokens/search?query=COMET&limit=100')).toBe(false)
  })
  it('un 404 o un 400 sono risposte, non guasti: si ripiega solo su rete, 5xx e 429', () => {
    expect(worthFallingBack(null)).toBe(true)
    expect(worthFallingBack(503)).toBe(true)
    expect(worthFallingBack(429)).toBe(true)
    expect(worthFallingBack(404)).toBe(false)
    expect(worthFallingBack(400)).toBe(false)
  })
})

describe('le due trappole', () => {
  it('la transazione finta tutta a zero si riconosce', () => {
    expect(isPhantomTx({ id: '0'.repeat(64), inclusionHeight: 0, timestamp: 0, inputs: [], outputs: [] })).toBe(true)
    expect(isPhantomTx(usdDatapoint)).toBe(false)
  })
  it('l’errore scritto nel corpo di un 200 si riconosce, i dati veri no', () => {
    expect(errorInBody({ status: 404, reason: 'Not found Token with id: search' })).toEqual({ status: 404, reason: 'Not found Token with id: search' })
    expect(errorInBody(usdDatapoint)).toBeNull()
    expect(errorInBody({ items: [], total: 0 })).toBeNull()
  })
})

describe('l’adattatore ricostruisce i registri come li scrive l’API ufficiale', () => {
  it('Long, Int, GroupElement, Coll[Byte]: stessi valori e stessi tipi', () => {
    expect(renderSerialized('05ce89e8aa16')).toEqual({ sigmaType: 'SLong', renderedValue: '2997682791' })
    expect(renderSerialized('04d6d303')).toEqual({ sigmaType: 'SInt', renderedValue: '29931' })
    expect(renderSerialized('0e06536967555344')).toEqual({ sigmaType: 'Coll[SByte]', renderedValue: '536967555344' })
    expect(renderSerialized('07' + '03'.repeat(33))!.renderedValue).toBe('03'.repeat(33))
  })
  it('Coll[Long] come lo scrive l’ufficiale: il registro R5 di uno stato di staking Paideia vero', () => {
    expect(renderSerialized('110788e6afbbd966c0d0121e16c4d6100000'))
      .toEqual({ sigmaType: 'Coll[SLong]', renderedValue: '[1764354292100,152608,15,11,136610,0,0]' })
    expect(renderSerialized('11020000')).toEqual({ sigmaType: 'Coll[SLong]', renderedValue: '[0,0]' })
  })
  it('un tipo che non sa leggere lo lascia com’è, e un valore storto non diventa un numero', () => {
    expect(renderSerialized('1a0101ff')).toBeNull()
    expect(renderSerialized('05ce89')).toBeNull()
    expect(renderSerialized('0e0501')).toBeNull()
  })
  it('su una transazione vera: tolto renderedValue, l’adattatore lo rimette identico', () => {
    const vera = JSON.parse(JSON.stringify(usdDatapoint))
    const riserva = JSON.parse(JSON.stringify(usdDatapoint))
    for (const b of [...riserva.inputs, ...riserva.outputs]) {
      for (const r of Object.values(b.additionalRegisters ?? {}) as Record<string, string>[]) { delete r.renderedValue; delete r.sigmaType }
      delete b.spentTransactionId
    }
    const adattata = adaptFallback('/transactions/' + vera.id, riserva)
    expect(adattata.outputs.map((b: { additionalRegisters?: unknown }) => b.additionalRegisters))
      .toEqual(vera.outputs.map((b: { additionalRegisters?: unknown }) => b.additionalRegisters))
    expect(adattata.spentUnknown).toBe(true)
  })
})

/* ---- il client: ufficiale giù, riserva su ---- */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function route(official: () => Response | Promise<Response>, reserve: () => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('api.sigmaspace.io') ? reserve() : official())))
}
afterEach(() => vi.unstubAllGlobals())

describe('il client ripiega solo quando deve', () => {
  it('ufficiale in 503 → la transazione arriva dalla riserva, adattata e segnata', async () => {
    const t = JSON.parse(JSON.stringify(usdDatapoint))
    for (const o of t.outputs) delete o.spentTransactionId
    route(() => json(503, { reason: 'down' }), () => json(200, { $schema: 'x', ...t }))
    const tx = await api.tx(t.id)
    expect(cameFromFallback(tx)).toBe(true)
    expect(tx.spentUnknown).toBe(true)
    expect((tx as unknown as Record<string, unknown>).$schema).toBeUndefined()
  })
  it('ufficiale giù e riserva con la transazione finta → «non c’è», non una transazione a zero', async () => {
    route(() => { throw new TypeError('Failed to fetch') }, () => json(200, { id: '0'.repeat(64), inclusionHeight: 0, timestamp: 0, inputs: [], outputs: [] }))
    const err = await api.tx('1'.repeat(64)).catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).notFound).toBe(true)
  })
  it('ufficiale giù e riserva con l’errore nel corpo di un 200 → errore, non dati', async () => {
    route(() => json(502, {}), () => json(200, { status: 404, reason: 'Not found Token with id: x' }))
    const err = await api.token('2'.repeat(64)).catch(e => e)
    expect((err as ApiError).notFound).toBe(true)
  })
  it('un 404 dell’ufficiale è una risposta: la riserva non viene nemmeno chiamata', async () => {
    const f = vi.fn(async (url: string) => (String(url).includes('sigmaspace') ? json(200, usdDatapoint) : json(404, { reason: 'not found' })))
    vi.stubGlobal('fetch', f)
    const err = await api.tx('3'.repeat(64)).catch(e => e)
    expect((err as ApiError).notFound).toBe(true)
    expect(f.mock.calls.some(c => String(c[0]).includes('sigmaspace'))).toBe(false)
  })
  it('il saldo non ha riserva: ufficiale giù → errore dell’ufficiale, niente numeri da altrove', async () => {
    const f = vi.fn(async () => json(503, {}))
    vi.stubGlobal('fetch', f)
    const err = await api.addressBalance('9fakeAddr').catch(e => e)
    expect((err as ApiError).status).toBe(503)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('riserva giù anche lei → resta l’errore della fonte principale', async () => {
    route(() => json(503, { reason: 'down' }), () => { throw new TypeError('Failed to fetch') })
    const err = await api.tx('4'.repeat(64)).catch(e => e)
    expect((err as ApiError).status).toBe(503)
  })
})
