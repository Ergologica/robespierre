import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from '../decoder/index'
import { categoryOf, tagKeyOf, looksRoutine, fractionOf, markAmounts, linkAddresses, shortAgo } from './feed'
import type { Tx } from '../api/types'

const DIR = join(__dirname, '../decoder/fixtures')
const fixtures = readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => ({ f, tx: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Tx }))
/** Quello che porta /blocks/{id}: gli input SENZA token. */
const light = (tx: Tx) => ({
  id: tx.id,
  inputs: tx.inputs.map(b => ({ address: b.address })),
  outputs: tx.outputs.map(b => ({ address: b.address, assets: b.assets?.map(a => ({ tokenId: a.tokenId })) })),
})

describe('flusso — la pre-selezione della routine non nasconde mai una transazione vera', () => {
  it('nessuna fixture fuori da mining e oracoli viene presa per routine', () => {
    for (const { f, tx } of fixtures) {
      if (categoryOf(decode(tx)?.kind ?? null) !== 'routine') expect(looksRoutine(light(tx)), f).toBe(false)
    }
  })
  it('oracoli, emissione, ri-emissione e raccolta delle commissioni si riconoscono dal blocco', () => {
    for (const f of ['oracle-usd-datapoint', 'oracle-usd-refresh', 'oracle-gold-datapoint', 'oracle-gold-refresh',
      'oracle-v1-datapoint', 'oracle-v1-collect', 'oracle-v1-epoch', 'mining-emission', 'mining-reemission', 'mining-fees']) {
      const fx = fixtures.find(x => x.f === f + '.json')!
      expect(looksRoutine(light(fx.tx)), f).toBe(true)
    }
  })
})

describe('flusso — categorie e sigle', () => {
  it('ogni tipo di lettura ha la sua categoria', () => {
    expect(categoryOf(null)).toBe('raw')
    expect(categoryOf('transfer')).toBe('transfer')
    expect(categoryOf('wallet-internal')).toBe('transfer')
    expect(categoryOf('spectrum-n2t')).toBe('defi')
    expect(categoryOf('rosen-in')).toBe('bridge')
    expect(categoryOf('sigmausd')).toBe('stable')
    expect(categoryOf('mining-tip')).toBe('routine')     // commissione pura da un contratto: la conta la rete
    expect(categoryOf('oracle-datapoint')).toBe('routine')
    expect(categoryOf('un-riconoscitore-futuro')).toBe('other')
  })
  it('la sigla dice chi ha letto, non cosa si immagina', () => {
    expect(tagKeyOf(null)).toBe('tag_raw')
    expect(tagKeyOf('wallet-internal')).toBe('tag_wallet')
    expect(tagKeyOf('rosen-out')).toBe('tag_rosen')
  })
})

describe('titolo della home — la frase viene dal numero, non da chi la scrive', () => {
  it('66,4% è «quasi due su tre», non «due su tre»', () => {
    expect(fractionOf(0.664)).toEqual({ num: 2, den: 3, q: 'quasi' })
  })
  it('esattamente la metà', () => {
    expect(fractionOf(0.5)).toEqual({ num: 1, den: 2, q: '' })
  })
  it('30,7% — la misura della settimana prima — è «più di tre su dieci»', () => {
    expect(fractionOf(0.307)).toEqual({ num: 3, den: 10, q: 'oltre' })
  })
  it('93,8% non si arrotonda in su: «più di nove su dieci»', () => {
    expect(fractionOf(0.938)).toEqual({ num: 9, den: 10, q: 'oltre' })
  })
  it('75% è tre su quattro, e la frazione è ridotta', () => {
    expect(fractionOf(0.75)).toEqual({ num: 3, den: 4, q: '' })
    expect(fractionOf(0.4)).toEqual({ num: 2, den: 5, q: '' })
  })
})

describe('frase — importi in evidenza, e solo quelli', () => {
  it('ERG e token della transazione', () => {
    expect(markAmounts('Swap su Spectrum: 250 ERG → 312,4 SigUSD', ['SigUSD']))
      .toBe('Swap su Spectrum: <strong class="amt-b">250 ERG</strong> → <strong class="amt-b">312,4 SigUSD</strong>')
  })
  it('un\'altezza o un numero di destinatari non sono importi', () => {
    const h = markAmounts('Emissione: ricompensa del blocco 1.834.215 — 6 ERG al minatore', [])
    expect(h).toContain('blocco 1.834.215 —')
    expect(h).toContain('<strong class="amt-b">6 ERG</strong>')
    expect(markAmounts('Trasferimento: 9hA1b2…c3D4 → 3 destinatari, 1.415,2 ERG', []))
      .toBe('Trasferimento: 9hA1b2…c3D4 → 3 destinatari, <strong class="amt-b">1.415,2 ERG</strong>')
  })
  it('in inglese i separatori sono invertiti', () => {
    expect(markAmounts('redemption of 200 SigUSD for 935.64 ERG', ['SigUSD']))
      .toBe('redemption of <strong class="amt-b">200 SigUSD</strong> for <strong class="amt-b">935.64 ERG</strong>')
  })
  it('un nome di token ostile resta escapato', () => {
    const out = markAmounts('arrivo di 5 &lt;b&gt;', ['<b>'])
    expect(out).toBe('arrivo di <strong class="amt-b">5 &lt;b&gt;</strong>')
  })
})

describe('frase — gli indirizzi diventano link solo se sono nella transazione', () => {
  const a = '9hY4Zm7aQeLkXq3nP5sT8vWbC2dE6fG1hJ9kM4nR7tU2wZxQ2kd'
  it('forma accorciata a 8 caratteri, quella del decodificatore', () => {
    const h = linkAddresses('Rosen Bridge: arrivo di 9.950,99 ERG a 9hY4Zm7a…Q2kd', [a])
    expect(h).toContain(`<a href="#/address/${a}" title="${a}">9hY4Zm7a…Q2kd</a>`)
  })
  it('un indirizzo assente dalla frase non aggiunge nulla', () => {
    expect(linkAddresses('Swap su Spectrum', [a])).toBe('Swap su Spectrum')
  })
})

describe('tempo corto del flusso', () => {
  it('secondi, minuti, ore', () => {
    const now = 1_000_000_000_000
    expect(shortAgo(now - 38_000, now)).toBe('38 s')
    expect(shortAgo(now - 4 * 60_000, now)).toBe('4 min')
    expect(shortAgo(now - 3 * 3600_000, now)).toBe('3 h')
  })
})
