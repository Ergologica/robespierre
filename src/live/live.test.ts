/**
 * Verifica DAL VIVO contro la mainnet: si attiva solo con LIVE=1
 * (LIVE=1 npx vitest run src/live). Non gira nel `npm test` normale:
 * i test di default devono restare deterministici sulle fixture.
 * Oltre alle asserzioni, salva l'HTML reso in .live-out/ per l'ispezione visiva.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'

const LIVE = !!process.env.LIVE

describe.skipIf(!LIVE)('pagine dal vivo (mainnet)', () => {
  beforeAll(() => {
    ;(globalThis as Record<string, unknown>).document ??= { title: '' }
    mkdirSync('.live-out', { recursive: true })
  })

  it('rete: altezza e blocchi recenti', async () => {
    const { netView } = await import('../views/net')
    const html = await netView()
    writeFileSync('.live-out/net.html', html)
    expect(html).toContain('Stato della rete')
    expect(html).toMatch(/Altezza/)
    expect(html).toMatch(/1\.8\d\d\.\d{3}/) // altezza attuale ~1.85M
  })

  it('transazione semplice: il decodificatore scrive la riga', async () => {
    const { txView } = await import('../views/tx')
    const html = await txView('cb8f8f1731918de7ef8bcae831cef8768e74e43d763bd15aba82faca04371236')
    writeFileSync('.live-out/tx-simple.html', html)
    expect(html).toContain('Trasferimento:')
    expect(html).toContain('5.000 ERG')
    expect(html).toContain('lettura certa')
  })

  it('transazione del bridge: decodificata da Rosen, token troncati', async () => {
    const { txView } = await import('../views/tx')
    const html = await txView('e06697e0e08c2dc69db3b0fb75e89f3bc665e1c79316657a33c4e7c521bfdca3')
    writeFileSync('.live-out/tx-bridge.html', html)
    expect(html).toContain('Rosen Bridge: arrivo di')
    expect(html).toContain('altri token di questo box')
  })

  it('indirizzo: saldo, totale movimenti, direzione', async () => {
    const { addressView } = await import('../views/address')
    const html = await addressView('9gnhfapSW2RtUYXR7DukoaSZfZpNazzcuyUhay5mjBW91qHS345')
    writeFileSync('.live-out/address.html', html)
    expect(html).toMatch(/Movimenti/)
    expect(html).toMatch(/\d{1,3}(\.\d{3})*<\/strong> movimenti/) // conteggio reale, non "1 of 77"
    expect(html).toContain('Rosen Bridge') // la controparte etichettata deve comparire nelle righe
  })


  it('decodifica dal vivo: un\'operazione recente della banca SigmaUSD', async () => {
    const { txView } = await import('../views/tx')
    // 3dec9ae3… era un riscatto reale al momento della raccolta fixture
    const html = await txView('3dec9ae3d71ae9fec22bfe6cfc85c7872d32788242cfbe5014fe390d21aa650c')
    writeFileSync('.live-out/tx-sigmausd.html', html)
    expect(html).toContain('SigmaUSD:')
    expect(html).toContain('lettura certa')
  })

  it('decodifica dal vivo: uno swap Spectrum recente', async () => {
    const { txView } = await import('../views/tx')
    const html = await txView('e2b09570ba1693f17f64f72060b664689df2a67b391b74be5b101c8983b5ccf9')
    writeFileSync('.live-out/tx-spectrum.html', html)
    expect(html).toContain('Swap su Spectrum:')
  })

  it('token COMET: nome come titolo, id come dato tecnico', async () => {
    const { tokenView } = await import('../views/token')
    const html = await tokenView('0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b')
    writeFileSync('.live-out/token.html', html)
    expect(html).toContain('COMET')
    expect(html).toContain('21.000.000.000')
  })
})
