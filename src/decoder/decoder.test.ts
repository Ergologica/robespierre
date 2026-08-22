import { describe, it, expect } from 'vitest'
import { decode } from './index'
import type { Tx } from '../api/types'
import transferSimple from './fixtures/transfer-cb8f8f17.json'
import transferSweep from './fixtures/transfer-941552e9.json'
import bridge from './fixtures/bridge-e06697e0.json'

describe('decode — fixture reali dalla mainnet', () => {
  it('riconosce un trasferimento semplice (9gnh… → 9ehar…, 5.000 ERG)', () => {
    const d = decode(transferSimple as unknown as Tx)
    expect(d).not.toBeNull()
    expect(d!.kind).toBe('transfer')
    expect(d!.headline).toContain('5.000 ERG')
    expect(d!.confidence).toBe('certa')
  })

  it('riconosce un prelievo da exchange (input multipli, resto al mittente)', () => {
    const d = decode(transferSweep as unknown as Tx)
    expect(d).not.toBeNull()
    expect(d!.kind).toBe('transfer')
    expect(d!.headline).toContain('10,9 ERG')
  })

  it('la transazione del bridge NON è un trasferimento semplice: la legge il riconoscitore Rosen (in Fase 1 qui si pretendeva il silenzio)', () => {
    const d = decode(bridge as unknown as Tx)
    expect(d).not.toBeNull()
    expect(d!.kind).toBe('rosen-in')
  })
})

import swapBuy from './fixtures/spectrum-swap-buy.json'
import swapSell from './fixtures/spectrum-swap-sell.json'
import deposit from './fixtures/spectrum-deposit.json'
import redeem from './fixtures/sigmausd-redeem.json'
import rsvMint from './fixtures/sigmausd-rsv.json'

describe('spectrum-n2t — fixture reali', () => {
  it('swap ERG → token', () => {
    const d = decode(swapBuy as unknown as Tx)
    expect(d?.kind).toBe('spectrum-n2t')
    expect(d?.headline).toMatch(/^Swap su Spectrum: .*ERG → .*DORT$/)
    expect(d?.confidence).toBe('certa')
  })
  it('swap token → ERG', () => {
    const d = decode(swapSell as unknown as Tx)
    expect(d?.kind).toBe('spectrum-n2t')
    expect(d?.headline).toMatch(/^Swap su Spectrum: .*rsADA → .*ERG$/)
  })
  it('deposito di liquidità: NON è uno swap', () => {
    const d = decode(deposit as unknown as Tx)
    expect(d?.kind).toBe('spectrum-n2t')
    expect(d?.headline).toContain('deposito di liquidità')
  })
})

describe('sigmausd — fixture reali', () => {
  it('riscatto di SigUSD contro la riserva', () => {
    const d = decode(redeem as unknown as Tx)
    expect(d?.kind).toBe('sigmausd')
    expect(d?.headline).toMatch(/riscatto di .*SigUSD per .*ERG/)
    expect(d?.confidence).toBe('certa')
  })
  it('mint di SigRSV (delta della riserva in direzione opposta)', () => {
    const d = decode(rsvMint as unknown as Tx)
    expect(d?.kind).toBe('sigmausd')
    expect(d?.headline).toMatch(/mint di .*SigRSV/)
  })
  it('NEGATIVO: uno swap Spectrum non deve mai leggersi come SigmaUSD', () => {
    const d = decode(swapBuy as unknown as Tx)
    expect(d?.kind).not.toBe('sigmausd')
  })
})

describe('rosen-bridge — fixture reale', () => {
  it('arrivo dal bridge, con token e destinatario', () => {
    const d = decode(bridge as unknown as Tx)
    expect(d?.kind).toBe('rosen-in')
    expect(d?.headline).toMatch(/^Rosen Bridge: arrivo di /)
    expect(d?.headline).toContain('9.950,99 ERG')
  })
  it('NEGATIVO: un trasferimento semplice non è mai Rosen', () => {
    const d = decode(transferSimple as unknown as Tx)
    expect(d?.kind).toBe('transfer')
  })
})

import { countHomonyms } from '../views/token'
describe('pagella — omonimi', () => {
  const items = [
    { id: 'aaa', name: 'COMET' }, { id: 'bbb', name: 'comet' },
    { id: 'ccc', name: 'COMET ' }, { id: 'ddd', name: 'Comete' },
  ]
  it('conta gli altri token con lo stesso nome, ignorando maiuscole e spazi', () => {
    expect(countHomonyms(items, 'COMET', 'aaa')).toBe(2)
  })
  it('non conta se stesso né i nomi simili ma diversi', () => {
    expect(countHomonyms(items, 'Comete', 'ddd')).toBe(0)
  })
})

import { computeAgeUsd } from '../views/protocols'
describe('protocolli — SigmaUSD, numeri reali della banca (22/08/2026)', () => {
  const real = {
    bankErg: 1_685_533_129_871_118n,      // 1.685.533,13 ERG
    bankUsdUnits: 9_999_981_839_975n,     // SigUSD rimasti in banca
    emissionUsd: 10_000_000_000_001n,
    bankRsvUnits: 9_994_707_218_873n,
    emissionRsv: 10_000_000_000_001n,
    priceUsd: 0.26,
  }
  it('circolante = emissione − banca (in centesimi)', () => {
    const s = computeAgeUsd(real)
    expect(s.circUsdUnits).toBe(18_160_026n)   // 181.600,26 SigUSD
    expect(s.circRsvUnits).toBe(5_292_781_128n)
  })
  it('tasso di riserva ≈ 241% col prezzo di mercato: il mint è chiuso — coerente con le sole operazioni di riscatto viste in Fase 2', () => {
    const s = computeAgeUsd(real)
    expect(s.reserveRatioPct).toBeGreaterThan(230)
    expect(s.reserveRatioPct).toBeLessThan(255)
  })
  it('senza prezzo il tasso è null, mai inventato', () => {
    expect(computeAgeUsd({ ...real, priceUsd: null }).reserveRatioPct).toBeNull()
  })
})
