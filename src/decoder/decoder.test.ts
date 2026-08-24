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

import { computeOracleRatio } from '../views/protocols'
describe('protocolli — tasso ufficiale dal box dell\'oracolo (R4 reale del 22/08/2026)', () => {
  it('R4 = 4.773.652.507 nanoERG/USD → tasso ≈ 194%', () => {
    const r = computeOracleRatio({
      bankErg: 1_685_533_129_871_118n,
      circUsdUnits: 18_160_026n,
      oracleNanoPerUsd: 4_773_652_507n,
    })
    expect(r).toBeGreaterThan(190); expect(r).toBeLessThan(199)
  })
  it('con zero circolante o oracolo assente: null, mai inventato', () => {
    expect(computeOracleRatio({ bankErg: 1n, circUsdUnits: 0n, oracleNanoPerUsd: 1n })).toBeNull()
    expect(computeOracleRatio({ bankErg: 1n, circUsdUnits: 1n, oracleNanoPerUsd: 0n })).toBeNull()
  })
})

import { aggregateHolders, topHolders } from '../views/token'
describe('detentori — aggregazione pura', () => {
  const T = 'tok'
  const boxes = [
    { address: 'A', assets: [{ tokenId: T, amount: 600 }] },
    { address: 'A', assets: [{ tokenId: T, amount: '100' }] },   // stringa: arriva così dal JSON
    { address: 'B', assets: [{ tokenId: T, amount: 200 }] },
    { address: 'C', assets: [{ tokenId: 'altro', amount: 999 }] }, // token diverso: ignorato
    { address: 'D', assets: [{ tokenId: T, amount: 100 }] },
  ]
  it('somma per indirizzo, ignora gli altri token', () => {
    const m = aggregateHolders(boxes, T)
    expect(m.get('A')).toBe(700n)
    expect(m.get('B')).toBe(200n)
    expect(m.has('C')).toBe(false)
    expect(m.size).toBe(3)
  })
  it('top N + resto con quote sul totale letto', () => {
    const { top, rest, holders, total } = topHolders(aggregateHolders(boxes, T), 2)
    expect(total).toBe(1000n)
    expect(holders).toBe(3)
    expect(top[0]).toMatchObject({ address: 'A', amount: 700n, pct: 70 })
    expect(top[1]).toMatchObject({ address: 'B', pct: 20 })
    expect(rest?.amount).toBe(100n)
    expect(rest?.pct).toBe(10)
  })
  it('senza box: totale zero, nessun resto', () => {
    const { total, rest, holders } = topHolders(aggregateHolders([], T), 5)
    expect(total).toBe(0n); expect(rest).toBeNull(); expect(holders).toBe(0)
  })
})

import { sortWalletTokens } from '../views/address'
describe('portafoglio — ordinamento dei token', () => {
  it('con nome prima (alfabetico, senza maiuscole), senza nome in fondo per id', () => {
    const out = sortWalletTokens([
      { tokenId: 'zzz', name: null }, { tokenId: 'bbb', name: 'zeta' },
      { tokenId: 'aaa', name: null }, { tokenId: 'ccc', name: 'Alfa' },
      { tokenId: 'ddd', name: '  ' },
    ])
    expect(out.map(t => t.name?.trim() || t.tokenId)).toEqual(['Alfa', 'zeta', 'aaa', 'ddd', 'zzz'])
  })
})

import { walletComposition } from '../views/address'
describe('portafoglio — composizione del valore', () => {
  const perErg = new Map([['sig', 0.25], ['comet', 180000]])  // 1 ERG = 0,25 SigUSD = 180k COMET
  it('converte in ERG con i decimali giusti e dichiara i senza-prezzo', () => {
    const c = walletComposition(10_000_000_000n, [                 // 10 ERG
      { tokenId: 'sig', name: 'SigUSD', amount: 500, decimals: 2 },   // 5,00 SigUSD → 20 ERG
      { tokenId: 'comet', name: 'COMET', amount: 360000, decimals: 0 }, // → 2 ERG
      { tokenId: 'boh', name: 'Ignoto', amount: 999, decimals: 0 },  // senza prezzo
    ], perErg)
    expect(c.slices.map(s => s.label)).toEqual(['ERG', 'SigUSD', 'COMET'])
    expect(c.slices[1]!.erg).toBeCloseTo(20, 6)
    expect(c.slices[2]!.erg).toBeCloseTo(2, 6)
    expect(c.totalErg).toBeCloseTo(32, 6)
    expect(c.unpricedCount).toBe(1)
  })
  it('oltre il tetto aggrega in «altri N token con prezzo»', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ tokenId: 'sig', name: 'T' + i, amount: 100 - i, decimals: 2 }))
    const c = walletComposition(0n, many, perErg, 4)
    expect(c.slices.at(-1)!.label).toBe('altri 3 token con prezzo')
  })
})

import { hexToUtf8, eip4ImageUrl } from '../views/token'
describe('EIP-4 — immagine dichiarata al conio', () => {
  it('decodifica esadecimale → UTF-8 e rifiuta hex non valido', () => {
    expect(hexToUtf8('68747470733a2f2f')).toBe('https://')
    expect(hexToUtf8('7a')).toBe('z')
    expect(hexToUtf8('7')).toBeNull()       // lunghezza dispari
    expect(hexToUtf8('zz')).toBeNull()      // non hex
    expect(hexToUtf8('')).toBeNull()
  })
  const hex = (s: string) => [...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  it('riconosce R7=immagine e converte ipfs:// nel gateway', () => {
    const regs = {
      R7: { serializedValue: '0e020101', renderedValue: '0101' },
      R9: { renderedValue: hex('ipfs://QmABC/img.png') },
    }
    expect(eip4ImageUrl(regs)).toBe('https://ipfs.io/ipfs/QmABC/img.png')
  })
  it('accetta solo https; senza R7-immagine risponde null', () => {
    expect(eip4ImageUrl({ R7: { renderedValue: '0101' }, R9: { renderedValue: hex('http://x.png') } })).toBeNull()
    expect(eip4ImageUrl({ R9: { renderedValue: hex('https://x.png') } })).toBeNull()
    expect(eip4ImageUrl({ R7: { renderedValue: '0102' }, R9: { renderedValue: hex('https://x.png') } })).toBeNull()
    expect(eip4ImageUrl(undefined)).toBeNull()
  })
})

import { classifyRent, RENT } from '../views/address'
describe('storage rent — classificazione dei box per età', () => {
  const tip = 1_600_000
  it('separa: in riscossione (≥4 anni), presto (≥3,5), tranquilli', () => {
    const { paying, soon } = classifyRent([
      tip - RENT.periodBlocks,       // esattamente 4 anni → paga
      tip - RENT.periodBlocks - 10,  // oltre → paga
      tip - RENT.soonBlocks - 1,     // 3,5 anni → presto
      tip - 100,                     // giovane
    ], tip)
    expect(paying).toBe(2)
    expect(soon).toBe(1)
  })
  it('nessun box vecchio → nessun avviso', () => {
    expect(classifyRent([tip - 5, tip - 1000], tip)).toEqual({ paying: 0, soon: 0 })
  })
})

import { setLang, getLang, L as Ldict } from '../i18n'
import { formatErg, formatPct } from '../lib/format'
describe('i18n — cambio lingua completo e reversibile', () => {
  it('EN cambia testi e separatori; IT li ripristina', () => {
    try {
      setLang('en')
      expect(getLang()).toBe('en')
      expect(formatErg(1_234_500_000_000n, 2)).toBe('1,234.5 ERG')
      expect(formatPct(12.34)).toBe('12.34')
    } finally {
      setLang('it')
    }
    expect(formatErg(1_234_500_000_000n, 2)).toBe('1.234,5 ERG')
    expect(formatPct(12.34)).toBe('12,34')
    expect(Ldict.retry).toBe('riprova')
  })
})

import { tokenDeltas } from '../views/address'
describe('movimenti — variazione token per indirizzo', () => {
  it('su uno swap reale: chi compra riceve +61 DORT, chi esegue paga solo la fee', () => {
    const tx = swapBuy as unknown as Tx
    const buyer = tx.outputs[1]!.address               // il contratto di buyback: è lui che compra
    const bot = tx.outputs[2]!.address                 // l'esecutore P2PK: muove ERG, nessun token
    const d = tokenDeltas(tx, buyer)
    expect(d).toHaveLength(1)
    expect(d[0]!.delta).toBe(61n)                      // 54.476 − 54.415, dal vivo della catena
    expect(d[0]!.name).toBe('DORT')
    expect(tokenDeltas(tx, bot)).toHaveLength(0)
  })
  it('aggrega più box e scarta i delta nulli (token passato invariato)', () => {
    const tx = {
      inputs: [
        { boxId: 'i1', value: 1000, address: 'me', assets: [{ tokenId: 'A', amount: 50 }, { tokenId: 'B', amount: 7 }] },
        { boxId: 'i2', value: 1000, address: 'me', assets: [{ tokenId: 'A', amount: 50 }] },
      ],
      outputs: [
        { boxId: 'o1', value: 900, address: 'me', assets: [{ tokenId: 'A', amount: 30, name: 'Alfa', decimals: 1 }, { tokenId: 'B', amount: 7 }] },
        { boxId: 'o2', value: 1100, address: 'other', assets: [{ tokenId: 'A', amount: 70 }] },
      ],
      id: 't', timestamp: 0,
    } as unknown as Tx
    const d = tokenDeltas(tx, 'me')
    expect(d).toHaveLength(1)                          // B è invariato: non compare
    expect(d[0]).toMatchObject({ tokenId: 'A', delta: -70n, name: 'Alfa', decimals: 1 })
  })
  it('per chi non è nella transazione: nessun delta', () => {
    expect(tokenDeltas(swapBuy as unknown as Tx, '9xNessuno')).toHaveLength(0)
  })
})

import { fmtPrice } from '../views/markets'
import { buildPrices, THIN_POOL_ERG } from '../lib/prices'
describe('prezzi — fonte unica per mercati e wallet', () => {
  const ERG0 = '0'.repeat(64)
  const mk = (q: string, sym: string, lastPrice: number, vol: number) =>
    ({ baseId: ERG0, quoteId: q, quoteSymbol: sym, lastPrice, baseVolume: { value: vol } })
  it('sceglie il pool col volume storico maggiore e usa il prezzo fresco delle 24h', () => {
    const p = buildPrices([
      mk('aa', 'SigUSD', 4, 100e9),      // pool piccolo: scartato
      mk('aa', 'SigUSD', 5, 900e9),      // pool grande: vince
      { baseId: 'cc', quoteId: 'dd', lastPrice: 3, baseVolume: { value: 1e15 } }, // non-ERG: fuori
    ], new Map([['aa', { volNano: 42e9, lastPrice: 8 }]]))
    const sig = p.get('aa')!
    expect(sig.ergPerToken).toBeCloseTo(1 / 8, 12)   // prezzo FRESCO, non 1/5
    expect(sig.fresh).toBe(true)
    expect(sig.vol24Erg).toBeCloseTo(42, 6)
    expect(sig.volCumErg).toBeCloseTo(900, 6)
    expect(p.has('dd')).toBe(false)
  })
  it('senza scambi nelle 24h il prezzo è quello storico e NON è dichiarato fresco', () => {
    const p = buildPrices([mk('aa', 'X', 4, 500e9)], new Map())
    expect(p.get('aa')!.fresh).toBe(false)
    expect(p.get('aa')!.ergPerToken).toBeCloseTo(0.25, 12)
  })
  it('marca i pool sottili: la soglia è dichiarata, non nascosta', () => {
    const p = buildPrices([mk('a', 'GROSSO', 2, (THIN_POOL_ERG + 1) * 1e9), mk('b', 'PICCOLO', 2, 1e9)], new Map())
    expect(p.get('a')!.thin).toBe(false)
    expect(p.get('b')!.thin).toBe(true)
  })
  it('conta gli omonimi: il caso RSN visto vivo sui mercati il 23/08/2026', () => {
    const p = buildPrices([
      mk('vero', 'RSN', 30, 2_400_000e9),   // l'originale
      mk('finto', 'rsn', 30, 2e9),          // l'imitazione, maiuscole diverse
      mk('solo', 'NETA', 1, 5e9),
    ], new Map())
    expect(p.get('vero')!.sharedName).toBe(1)
    expect(p.get('finto')!.sharedName).toBe(1)   // entrambi marcati: chi è l'originale non lo decide un explorer
    expect(p.get('solo')!.sharedName).toBe(0)
  })
})

describe('formato dei prezzi', () => {
  it('mai uno zero che sarebbe una bugia: sotto la soglia dice «meno di»', () => {
    expect(fmtPrice(1.234e-15)).toBe('< 0,000000001')   // BBC, vivo sui mercati
    expect(fmtPrice(5.07e-12)).toBe('< 0,000000001')
    expect(fmtPrice(0)).toBe('0')                        // zero vero: zero
  })
  it('cifre sensate secondo la grandezza, zeri finali via, mai notazione scientifica', () => {
    expect(fmtPrice(0.269528)).toBe('0,269528')
    expect(fmtPrice(1234.5)).toBe('1234,5')
    expect(fmtPrice(0.000001234)).toBe('0,000001234')
    expect(fmtPrice(2)).toBe('2')
    expect(fmtPrice(3.5e-7)).not.toContain('e')
  })
})

import { buildAddressCsv } from '../views/address'
import type { CsvRow } from '../views/address'
describe('export CSV — costruzione pura', () => {
  const rows: CsvRow[] = [
    { dateUtc: '2026-08-20 10:00:00', day: '2026-08-20', txId: 'abc', dirIn: true,
      who: 'Rosen Bridge', ergNet: 9_950_990_000_000n, tokens: '' },
    { dateUtc: '2026-08-21 11:00:00', day: '2026-08-21', txId: 'def', dirIn: false,
      who: '9h5K"strano"', ergNet: -1_600_000_000_000n, tokens: '+62 DORT | -1 COMET' },
    { dateUtc: '2020-01-01 00:00:00', day: '2020-01-01', txId: 'old', dirIn: true,
      who: '', ergNet: 1_000_000_000n, tokens: '' },
  ]
  const prices = new Map([['2026-08-20', 0.25], ['2026-08-21', 0.3]])
  it('it: separatore ; virgola decimale, virgolette raddoppiate, prezzo mancante = cella vuota', () => {
    const csv = buildAddressCsv(rows, prices, 'it', 3)
    const lines = csv.split('\r\n')
    expect(lines[2]).toContain('9950,99')            // ERG con virgola
    expect(lines[2]).toContain('2487,75')            // 9950,99 × 0,25
    expect(lines[3]).toContain('"9h5K""strano"""')   // quoting CSV corretto
    expect(lines[4]!.endsWith(';;')).toBe(true)      // 2020: fuori serie → prezzo e valore VUOTI
    expect(csv).not.toContain('undefined')
  })
  it('un nome di token coniato come formula NON diventa una formula in Excel', () => {
    const evil: CsvRow[] = [{ dateUtc: '2026-08-23 00:00:00', day: '2026-08-23', txId: 'x', dirIn: true,
      who: '=HYPERLINK("http://male.example","clicca")', ergNet: 1n, tokens: '+1 =CMD|calc!A1 | -2 @SUM(1)' }]
    const csv = buildAddressCsv(evil, new Map(), 'it', 1)
    const line = csv.split('\r\n')[2]!
    expect(line).toContain(' =HYPERLINK')   // spazio davanti: testo, non formula
    expect(line).toContain('; +1 =CMD')     // anche la colonna token è neutralizzata
    expect(line.startsWith('2026')).toBe(true)
  })
  it('en: separatore virgola e punto decimale; il tetto è dichiarato', () => {
    const csv = buildAddressCsv(rows.slice(0, 1), prices, 'en', 100)
    expect(csv.split('\r\n')[2]).toContain('9950.99')
    expect(csv).toContain('100')                     // nota "1 su 100"
  })
})

import { sparkDomain } from '../charts'
describe('serie storica — la scala la decidono i dati', () => {
  it('una banda lontana NON schiaccia i dati (il caso 243–257% con banda 400–800)', () => {
    const d = sparkDomain([243, 250, 257], [400, 800])
    expect(d.y1).toBeLessThan(300)          // il grafico resta sui dati…
    expect(d.y0).toBeGreaterThan(230)
    expect(d.bandVisible).toBeNull()        // …e la banda semplicemente non si disegna
  })
  it('una banda dentro la scala si disegna, tagliata alla parte visibile', () => {
    const d = sparkDomain([380, 420, 450], [400, 800])
    expect(d.bandVisible).not.toBeNull()
    expect(d.bandVisible![0]).toBe(400)                 // parte dal minimo…
    expect(d.bandVisible![1]).toBeLessThanOrEqual(d.y1) // …e non esce dalla scala
  })
  it('serie piatta: la scala si apre lo stesso, niente divisione per zero', () => {
    const d = sparkDomain([250, 250, 250])
    expect(d.y1).toBeGreaterThan(d.y0)
    expect(Number.isFinite(d.y0) && Number.isFinite(d.y1)).toBe(true)
  })
})

import { niceScale } from '../charts'
describe('scale dei grafici — tacche leggibili', () => {
  it('arrotonda a passi 1·2·5 invece di dividere il massimo in cinque', () => {
    expect(niceScale(48.9)).toEqual({ max: 50, step: 10 })   // prima: 0·10·21·31·41·51
    expect(niceScale(7)).toEqual({ max: 8, step: 2 })      // 0·2·4·6·8
    expect(niceScale(230)).toEqual({ max: 250, step: 50 })
    expect(niceScale(0.42)).toEqual({ max: 0.5, step: 0.1 })
  })
  it('il massimo arrotondato non taglia mai il dato più grande', () => {
    for (const v of [1, 3.3, 17, 99, 101, 4321]) expect(niceScale(v).max).toBeGreaterThanOrEqual(v)
  })
  it('zero o valori assurdi non rompono la scala', () => {
    expect(niceScale(0).max).toBe(1)
    expect(niceScale(-5).max).toBe(1)
  })
})

/* ---------------- staking Paideia — fixture reali ---------------- */
import { paideiaDao, readStakeOp, readStakeState, buildPosition } from '../stake/paideia'
import stakeTx from '../stake/fixtures/paideia-stake-autolykos.json'
import stateBox from '../stake/fixtures/paideia-state-autolykos.json'
import keyFix from '../stake/fixtures/paideia-key-autolykos.json'
import keyVecchia from '../stake/fixtures/paideia-key-sigmanauts-vecchia.json'
import stakeVecchia from '../stake/fixtures/paideia-stake-sigmanauts-vecchia.json'
import rincalzoWalrus from '../stake/fixtures/paideia-rincalzo-walrus.json'

describe('staking Paideia — riconoscimento della chiave', () => {
  it('riconosce la chiave dalla firma che ogni DAO scrive nella descrizione', () => {
    expect(paideiaDao(keyFix.chiave)).toBe('Autolykos')
    expect(paideiaDao({ name: 'X', description: 'Sigmanauts - Powered by Paideia - https://app.paideia.im', emissionAmount: 1 })).toBe('Sigmanauts')
    expect(paideiaDao({ name: 'X', description: 'Walrus DAO - Powered by Paideia - https://app.paideia.im', emissionAmount: 1 })).toBe('Walrus DAO')
  })
  it('NEGATIVO: un token qualunque non è una chiave, e nemmeno un NFT con descrizione simile ma emissione diversa', () => {
    expect(paideiaDao(keyFix.nonChiave)).toBeNull()          // COMET, 21 miliardi di unità
    expect(paideiaDao({ description: 'Autolykos - Powered by Paideia - https://app.paideia.im', emissionAmount: 5 })).toBeNull()
    expect(paideiaDao({ description: 'Powered by Paideia', emissionAmount: 1 })).toBeNull()
    expect(paideiaDao({ description: null, emissionAmount: 1 })).toBeNull()
  })
})

describe('staking Paideia — operazione letta dalla catena', () => {
  it('ricava stato, token depositato e importo dalla transazione di ingresso (4/12/2025)', () => {
    const op = readStakeOp(stakeTx as never)!
    expect(op).not.toBeNull()
    expect(op.stakedName).toBe('LYKOS')
    expect(op.delta).toBe(8783n)          // 143.980 − 135.197, letto dai box di stato
    expect(op.totalAfter).toBe(143980n)
    expect(op.stateTokenId).toBe('3b7fb49bc0a262ea890df52483fafe4b59bd376bb6788452796c13ae083b6f50')
  })
  it('lo stato attuale dà il totale nel pool e quanti partecipano', () => {
    const st = readStakeState(stateBox as never, '3b7fb49bc0a262ea890df52483fafe4b59bd376bb6788452796c13ae083b6f50')!
    expect(st.total).toBe(152609n)
    expect(st.stakers).toBe(15)           // R5[2]
  })
  it('la posizione somma le operazioni e NON inventa il saldo con le ricompense', () => {
    const op = readStakeOp(stakeTx as never)!
    const st = readStakeState(stateBox as never, op.stateTokenId)!
    const p = buildPosition('Autolykos', 'chiave', [op], st)!
    expect(p.deposited).toBe(8783n)
    expect(p.operations).toBe(1)
    expect(p.poolStakers).toBe(15)
    expect(Object.keys(p)).not.toContain('balance')   // il saldo corrente non esiste in questo oggetto
  })
})

/* ---------------- staking: la scheda dice quello che sa e tace il resto ---------------- */
import { stakeCardHtml } from '../stake/card'
import { mergeOps, ruoloChiave, altreChiaviDelDao, ordinaCandidati } from '../stake/index'
import { L } from '../i18n'
import type { StakePosition } from '../stake/paideia'

const POS: StakePosition = {
  dao: 'Autolykos', keyId: 'db56504be9f1e78ae989088b7afba3fdb1f86901bfaec62eb0a3d092d60a9a8d',
  stakedTokenId: 'e840e3bf0c4a3390d6ad9e3e9bcc14638e649feddcdd8d245f75b9738680fef6',
  stakedName: 'LYKOS', stakedDecimals: 2, deposited: 8783n, operations: 1,
  since: 1764858003577, poolTotal: 152609n, poolStakers: 15, partial: false,
}

describe('staking — scheda', () => {
  it('senza posizioni non stampa nulla: la scheda non compare', () => {
    expect(stakeCardHtml([], new Map(), 3)).toBe('')
  })
  it('mostra depositato, pool e partecipanti, e non stampa un controvalore quando il token non ha prezzo', () => {
    const h = stakeCardHtml([POS], new Map(), 3)
    expect(h).toContain('87,83 LYKOS')       // depositato
    expect(h).toContain('1.526,09 LYKOS')    // totale nel pool
    expect(h).toContain('15 partecipanti')
    expect(h).not.toContain('$')             // LYKOS non ha pool su Spectrum: niente numero inventato
    expect(h).toContain('AvlTree')           // il buco è dichiarato, non nascosto
  })
  it('col prezzo mostra il controvalore DEL DEPOSITATO, mai un saldo di oggi', () => {
    const prices = new Map([[POS.stakedTokenId, {
      tokenId: POS.stakedTokenId, symbol: 'LYKOS', ergPerToken: 0.5,
      vol24Erg: 900, volCumErg: 9000, fresh: true, thin: false, sharedName: 0,
    }]])
    const h = stakeCardHtml([POS], prices, 4)
    expect(h).toContain('176 $')             // 87,83 × 0,5 ERG × 4 $ = 175,66
    expect(h).toContain('del depositato')
  })
  it('un nome di DAO ostile viene sfuggito come ogni altro dato di catena', () => {
    const h = stakeCardHtml([{ ...POS, dao: '<img src=x onerror=alert(1)>' }], new Map(), 3)
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;img')
  })

  it('lettura parziale del contratto: lo dichiara invece di far finta di niente', () => {
    const h = stakeCardHtml([{ ...POS, partial: true }], new Map(), 3)
    expect(h).toContain(L.stake_partial)
    expect(stakeCardHtml([POS], new Map(), 3)).not.toContain(L.stake_partial)
  })
})

describe('staking — unione delle operazioni', () => {
  it("l'ingresso non viene contato due volte quando lo scorrimento del contratto lo ritrova", () => {
    const op = readStakeOp(stakeTx as never)!
    const merged = mergeOps(op, [op])
    expect(merged.length).toBe(1)
    expect(merged.reduce((s, o) => s + o.delta, 0n)).toBe(8783n)
  })
  it("un ritiro successivo si somma con segno: il depositato è netto", () => {
    const op = readStakeOp(stakeTx as never)!
    const uscita = { ...op, txId: 'altra', delta: -3000n, at: op.at + 86_400_000 }
    const merged = mergeOps(op, [uscita])
    expect(merged.length).toBe(2)
    expect(merged.reduce((s, o) => s + o.delta, 0n)).toBe(5783n)
    expect(merged[0]!.at < merged[1]!.at).toBe(true)   // ordine cronologico
  })
})

/* ---------------- staking: le DUE generazioni di chiavi Paideia ---------------- */
describe('staking Paideia — la generazione vecchia', () => {
  it('la chiave vecchia non porta il nome del DAO nella descrizione: sta nel nome', () => {
    // «Sigmanauts Stake Key» · descrizione «Powered by Paideia», e basta
    expect(keyVecchia.description).toBe('Powered by Paideia')
    expect(paideiaDao(keyVecchia)).toBe('Sigmanauts')
    expect(paideiaDao({ name: 'Walrus DAO Stake Key', description: 'Powered by Paideia', emissionAmount: 1 })).toBe('Walrus DAO')
    expect(paideiaDao({ name: 'RosenGuards Stake Key', description: 'Powered by Paideia', emissionAmount: 1 })).toBe('RosenGuards')
  })
  it('NEGATIVO: la firma senza nome del DAO, su un token che non è una chiave, non basta', () => {
    expect(paideiaDao({ name: 'Walrus DAO Logo #1', description: 'Powered by Paideia', emissionAmount: 1 })).toBeNull()
    expect(paideiaDao({ name: 'Sigmanauts Stake State', description: 'Powered by Paideia', emissionAmount: 1 })).toBeNull()
    expect(paideiaDao({ name: null, description: 'Powered by Paideia', emissionAmount: 1 })).toBeNull()
  })
  it('la transazione di ingresso del 2024 si legge come quella di oggi', () => {
    const op = readStakeOp(stakeVecchia as never)!
    expect(op).not.toBeNull()
    expect(op.stakedName).toBe('Sigmanaut')
    expect(op.delta).toBe(1n)
  })
})

describe('staking Paideia — a chi si può attribuire una variazione', () => {
  const KEY_V = '4679238680dadf89f6670c1d83563e87e16616407845ce7bdf5b9e3aee1ae8b8'
  const KEY_W = '895ca7298ca635899ef9e1f871047eba15696557ad3ffe8a9ec678165f8bcb27'
  it('la chiave che NASCE nella transazione è un ingresso certo', () => {
    expect(ruoloChiave(stakeVecchia as never, KEY_V)).toBe('conio')
    expect(ruoloChiave(stakeTx as never, 'db56504be9f1e78ae989088b7afba3fdb1f86901bfaec62eb0a3d092d60a9a8d')).toBe('conio')
  })
  it('la chiave che sta ferma in un box speso è ambigua di per sé', () => {
    expect(ruoloChiave(rincalzoWalrus as never, KEY_W)).toBe('ambiguo')
  })
  it('ma diventa attribuibile se nessun altra chiave DELLO STESSO DAO è in ballo', () => {
    // la transazione contiene ~90 NFT del wallet, fra cui altre chiavi di staking
    // (Paideia, EGIO, AHT) e perfino «Walrus DAO Logo #1»: nessuna è una chiave Walrus
    expect(altreChiaviDelDao(rincalzoWalrus as never, 'Walrus DAO', KEY_W)).toBe(0)
    const op = readStakeOp(rincalzoWalrus as never)!
    expect(op.delta).toBe(35000n)      // il rincalzo del deposito, che altrimenti si perdeva
  })
  it('una seconda chiave dello stesso DAO nella stessa transazione ferma tutto', () => {
    const finta = { ...(rincalzoWalrus as never as Tx) }
    finta.outputs = [...finta.outputs, { boxId: 'x', value: 1, address: 'z',
      assets: [{ tokenId: 'altra', amount: 1, name: 'Walrus DAO Membership' }] }]
    expect(altreChiaviDelDao(finta, 'Walrus DAO', KEY_W)).toBe(1)
  })
})

describe('staking Paideia — posizione chiusa', () => {
  it('chi ha ritirato tutto tiene la chiave ma non ha una posizione: si tace', () => {
    const op = readStakeOp(stakeVecchia as never)!
    const uscita = { ...op, txId: 'uscita', delta: -op.delta, at: op.at + 1000 }
    const st = { total: 15n, stakers: 14 }
    expect(buildPosition('Sigmanauts', 'k', [op, uscita], st)).toBeNull()
    expect(buildPosition('Sigmanauts', 'k', [op], st)).not.toBeNull()
  })
})

describe('staking — quali NFT del wallet si interrogano, e in che ordine', () => {
  const n = (name: string | null, amount: number | string = 1, decimals = 0) =>
    ({ tokenId: (name ?? 'x') + '-id', amount, decimals, name })
  it('le chiavi passano avanti alle figurine, ma le figurine restano in coda', () => {
    const ordinati = ordinaCandidati([
      n('Ritual Scroll #161'), n('T-Rekt #0019'), n('Autolykos Membership'),
      n('Cybercitizen #4000'), n('EGIO Stake Key'),
    ] as never)
    expect(ordinati.slice(0, 2).map(t => t.name)).toEqual(['Autolykos Membership', 'EGIO Stake Key'])
    expect(ordinati.length).toBe(5)          // ordine, non filtro
  })
  it('quello che non è un NFT non si interroga nemmeno', () => {
    const ordinati = ordinaCandidati([
      n('COMET', 21_000_000_000), n('LYKOS', 1, 2), n('Walrus DAO Membership'),
    ] as never)
    expect(ordinati.map(t => t.name)).toEqual(['Walrus DAO Membership'])
  })
})
