import { describe, it, expect } from 'vitest'
import { selectRows, fmtPrice } from './markets'
import { sharedSymbolCount } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'

const tp = (symbol: string, tokenId: string, vol24Erg: number, volCumErg: number, ergPerToken = 1, sharedName = 0): TokenPrice =>
  ({ symbol, tokenId, vol24Erg, volCumErg, ergPerToken, fresh: vol24Erg > 0, thin: volCumErg < 100, sharedName })
const rows = [
  tp('SigUSD', '5d3a1f07aa', 18420, 2_410_000, 0.8),
  tp('RSN', '8b08cdd5aa', 9310, 2_402_115, 0.016, 1),
  tp('COMET', '0cd8c9b2aa', 1540, 38_410, 4.2e-6),
  tp('EXLE', '01dce8a5aa', 0, 20_100, 0.0027),
  tp('rsn', '03faf2cbaa', 0, 2, 0.02, 1),
]
const base = { view: '24' as const, hideThin: false, q: '', sort: 'vol24' as const, desc: true, limit: 100 }

describe('mercati — filtri e ordinamento', () => {
  it('«Scambiati 24 h» mostra solo chi ha scambiato, dal volume più alto', () => {
    expect(selectRows(rows, base).map(r => r.symbol)).toEqual(['SigUSD', 'RSN', 'COMET'])
  })
  it('«Tutti» e «nascondi pool sottili»', () => {
    const all = selectRows(rows, { ...base, view: 'all' })
    expect(all).toHaveLength(5)
    expect(selectRows(rows, { ...base, view: 'all', hideThin: true }).map(r => r.symbol)).not.toContain('rsn')
  })
  it('il filtro trova per simbolo (senza maiuscole) e per inizio dell’id', () => {
    expect(selectRows(rows, { ...base, view: 'all', q: 'rsn' }).map(r => r.tokenId)).toEqual(['8b08cdd5aa', '03faf2cbaa'])
    expect(selectRows(rows, { ...base, view: 'all', q: '0cd8' }).map(r => r.symbol)).toEqual(['COMET'])
  })
  it('ordina per volume storico e per nome', () => {
    expect(selectRows(rows, { ...base, view: 'all', sort: 'volcum' })[0]!.symbol).toBe('SigUSD')
    expect(selectRows(rows, { ...base, view: 'all', sort: 'sym', desc: false }).map(r => r.symbol)[0]).toBe('COMET')
  })
})

describe('mercati — i conti delle tessere', () => {
  it('i nomi condivisi si contano per SIMBOLO, non per riga: RSN e rsn sono uno', () => {
    expect(sharedSymbolCount(rows)).toBe(1)
  })
  it('prezzi grandi con le migliaia separate', () => {
    expect(fmtPrice(95051.04)).toBe('95.051,04')
    expect(fmtPrice(76120)).toBe('76.120')
  })
})

import { windowVolNano } from '../api/explorer'
describe('mercati — il volume 24 h conta i due versi', () => {
  const ERG0 = '0'.repeat(64)
  // le due voci vere della finestra del 27/09/2026
  const cypx = { baseId: ERG0, quoteId: '01dce8a5', quoteSymbol: 'CYPX', lastPrice: 4065.013641,
    baseVolume: { value: 0 }, quoteVolume: { value: 155_000_000, units: { asset: { decimals: 4 } } } }
  const rsv = { baseId: ERG0, quoteId: '003bd19d', quoteSymbol: 'SigRSV', lastPrice: 5296.493787,
    baseVolume: { value: 8_346_631_457 }, quoteVolume: { value: 0, units: { asset: { decimals: 0 } } } }
  it('chi vende token per ERG conta: 15.500 CYPX a 4.065 per ERG sono ~3,81 ERG', () => {
    expect(windowVolNano(cypx) / 1e9).toBeCloseTo(15_500 / 4065.013641, 6)
  })
  it('chi compra token con ERG conta come prima', () => {
    expect(windowVolNano(rsv)).toBe(8_346_631_457)
  })
})
