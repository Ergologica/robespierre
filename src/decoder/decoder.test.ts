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

/* ---------------- la pagina d'errore non indovina ---------------- */
import { errorBox } from '../views/errorbox'
import { ApiError } from '../api/explorer'

describe('errore: tre cause diverse, tre risposte diverse', () => {
  const ID = '0000000000000000000000000000000000000000000000000000000000000000'
  it('un hash che non esiste NON dice che la fonte è giù, e non offre di riprovare', () => {
    const h = errorBox(new ApiError(404, '/transactions/' + ID, 'Not found Transaction with id: ' + ID), 'tx', ID)
    expect(h).toContain(L.gone_tx)
    expect(h).not.toContain(L.err_hint)     // «la fonte potrebbe essere giù»: qui sarebbe falso
    expect(h).not.toContain('data-retry')   // riprovare un 404 non serve a niente
  })
  it('dice quale cosa non c’è, non un generico «non trovato»', () => {
    expect(errorBox(new ApiError(404, '/tokens/x'), 'token', ID)).toContain(L.gone_token)
    expect(errorBox(new ApiError(404, '/blocks/x'), 'block', ID)).toContain(L.gone_block)
  })
  it('un id scritto male è un caso a sé: lo dice la catena col checksum', () => {
    const h = errorBox(new ApiError(400, '/addresses/9nonesiste/balance/confirmed', 'Unknown error: Checksum check fails for 9nonesiste'), 'address', '9nonesiste')
    expect(h).toContain(L.bad_addr)
    expect(h).not.toContain(L.gone_any)
  })
  it('una fonte che non risponde resta quello che era: avviso e bottone Riprova', () => {
    const h = errorBox(new Error('Failed to fetch'), 'tx', ID)
    expect(h).toContain(L.err_hint)
    expect(h).toContain('data-retry')
  })
  it('l’id finisce nella pagina sfuggito, come ogni dato che arriva da fuori', () => {
    const h = errorBox(new ApiError(404, '/transactions/x'), 'tx', '<img src=x onerror=alert(1)>')
    expect(h).not.toContain('<img')
    expect(h).toContain('&lt;img')
  })
})

/* ---------------- i riquadri non devono smentire la frase ---------------- */
import { txMovement } from '../lib/movement'
import { FEE_ADDRESS } from './recognizers/simple-transfer'

describe('movimento netto: chi ha dato cosa a chi', () => {
  it('su un mint SigmaUSD il token si è mosso, anche se nessun indirizzo è "nuovo"', () => {
    // il difetto: banca e wallet compaiono sia in entrata che in uscita, quindi
    // il conteggio vecchio («token finiti a indirizzi non in entrata») dava ZERO
    const m = txMovement(rsvMint as never, FEE_ADDRESS)
    expect(m.tokens.length).toBe(1)
    expect(m.tokens[0]!.name).toBe('SigRSV')
    expect(m.tokens[0]!.amount > 0n).toBe(true)
  })
  it('il numero grande diventa quello che si è mosso, non quello che sta nella banca', () => {
    const m = txMovement(rsvMint as never, FEE_ADDRESS)
    expect(m.ergMoved).toBeLessThan(100n * 10n ** 9n)          // ~7,6 ERG
    expect(m.totalOut).toBeGreaterThan(1_000_000n * 10n ** 9n) // ~1,7 milioni: c'è, ma come nota
  })
  it('su uno swap Spectrum il token mosso si vede', () => {
    const m = txMovement(swapBuy as never, FEE_ADDRESS)
    expect(m.tokens.length).toBe(1)
    expect(m.ergMoved).toBe(3_407_189_732n)      // 3,407189732 ERG → «3,41 ERG» nella frase decodificata
  })
  it('su un trasferimento semplice il movimento è l’importo inviato, senza il resto', () => {
    const m = txMovement(transferSimple as never, FEE_ADDRESS)
    expect(m.ergMoved).toBe(5000n * 10n ** 9n)   // 5.000 ERG esatti
    expect(m.totalOut).toBeGreaterThan(m.ergMoved)
    expect(m.clear).toBe(true)
  })
  it('la commissione non entra nel movimento: ha il suo riquadro', () => {
    const m = txMovement(transferSimple as never, FEE_ADDRESS)
    expect(m.fee > 0n).toBe(true)
    expect(m.ergMoved % (10n ** 9n)).toBe(0n)    // 5.000 tondi: la fee è fuori
  })
  it('con 57 box in uscita il ricevente principale è comunque uno solo, e si dichiara chiaro', () => {
    const m = txMovement(bridge as never, FEE_ADDRESS)
    expect(m.clear).toBe(true)
    expect(m.receiver).toBeTruthy()
    expect(m.tokens.length).toBe(3)
  })
  it('quando il movimento è sparso su più paganti la pagina non elegge nessuno', () => {
    const finta = { ...(transferSimple as never as Tx) }
    finta.outputs = [...finta.outputs]
    expect(txMovement({ ...finta, inputs: [], outputs: [] } as never, FEE_ADDRESS).clear).toBe(false)
  })
})

/* ---------------- il flusso: ognuno col suo importo ---------------- */
// Il difetto (27/09): il riquadro del flusso metteva lo STESSO numero ai due lati,
// cioè il totale di quello che aveva cambiato mano. Sull'arrivo Rosen del post di
// lancio il ricevente appariva con +10.001,3 ERG, mentre ne ha ricevuti 9.950,99:
// gli altri ~50 ERG sono andati a un altro indirizzo. La frase diceva il vero, il
// flusso no. Qui il netto di ogni parte si ricalcola A MANO, senza passare dal modulo.
function nettoA(tx: Tx, addr: string): bigint {
  let n = 0n
  for (const o of tx.outputs) if (o.address === addr) n += BigInt(o.value)
  for (const i of tx.inputs) if (i.address === addr) n -= BigInt(i.value)
  return n
}

describe('flusso: il ricevente con quello che ha ricevuto, il pagante con quello che ha dato', () => {
  it('arrivo Rosen: 9.950,9883 ERG al ricevente, 10.001,2059 dal hot wallet', () => {
    const m = txMovement(bridge as never, FEE_ADDRESS)
    expect(m.receiverIn).toBe(9_950_988_300_000n)
    expect(m.payerOut).toBe(10_001_205_900_000n)
    expect(m.receiverIn).toBeLessThan(m.ergMoved)            // il resto è andato ad altri
  })
  const tutte: [string, unknown][] = [
    ['transfer-cb8f8f17', transferSimple], ['transfer-941552e9', transferSweep],
    ['bridge-e06697e0', bridge], ['spectrum-swap-buy', swapBuy], ['spectrum-swap-sell', swapSell],
    ['spectrum-deposit', deposit], ['sigmausd-redeem', redeem], ['sigmausd-rsv', rsvMint],
  ]
  for (const [nome, fx] of tutte) {
    it(`${nome}: i due lati del flusso coincidono col netto ricalcolato a mano`, () => {
      const tx = fx as never as Tx
      const m = txMovement(tx, FEE_ADDRESS)
      if (!m.clear || !m.payer || !m.receiver) return             // il flusso non si disegna: niente da smentire
      expect(m.receiverIn).toBe(nettoA(tx, m.receiver) > 0n ? nettoA(tx, m.receiver) : 0n)
      expect(m.payerOut).toBe(-nettoA(tx, m.payer) > 0n ? -nettoA(tx, m.payer) : 0n)
      expect(m.receiverIn).toBeLessThanOrEqual(m.ergMoved)
    })
  }
})

describe('flusso: la differenza fra i due lati ha sempre un nome', () => {
  it('riscatto SigmaUSD: 935,63589 dalla banca, 935,63089 al ricevente, 0,005 di commissione', () => {
    const m = txMovement(redeem as never, FEE_ADDRESS)
    expect(m.payerOut - m.receiverIn).toBe(m.fee)
    expect(m.othersCount).toBe(0)
  })
  it('arrivo Rosen: la differenza è andata ad altri 4 indirizzi, e si dice quanto', () => {
    const m = txMovement(bridge as never, FEE_ADDRESS)
    expect(m.othersCount).toBe(4)
    expect(m.receiverIn + m.othersIn).toBe(m.ergMoved)
  })
})

/* ---------------- mining e oracoli: l'80% del traffico, finalmente spiegato ---------------- */
// Misura del 27/09/2026 su 1.000 blocchi: oracoli 46,2%, mining 32,2%. Tutte fixture reali.
import { mining, isMinerReward } from './recognizers/mining'
import { oracle } from './recognizers/oracle'
import { decodeLong, longReg } from './regs'
import mEmission from './fixtures/mining-emission.json'
import mFees from './fixtures/mining-fees.json'
import mReward from './fixtures/mining-reward.json'
import mPayout from './fixtures/mining-payout.json'
import mReem from './fixtures/mining-reemission.json'
import oUsdDp from './fixtures/oracle-usd-datapoint.json'
import oUsdRef from './fixtures/oracle-usd-refresh.json'
import oGoldDp from './fixtures/oracle-gold-datapoint.json'
import oGoldRef from './fixtures/oracle-gold-refresh.json'
import oV1Dp from './fixtures/oracle-v1-datapoint.json'
import oV1Col from './fixtures/oracle-v1-collect.json'
import oV1Ep from './fixtures/oracle-v1-epoch.json'

const dec = (fx: unknown) => decode(fx as Tx)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

describe('mining: le transazioni che fa la rete da sola', () => {
  it('emissione: 12 ERG al minatore, 9 vincolati alla ri-emissione, col numero del blocco', () => {
    const d = dec(mEmission)!
    expect(d.kind).toBe('mining-emission')
    expect(d.headline).toContain('blocco 1.881.538')
    expect(d.headline).toContain('12 ERG al minatore')
    expect(d.headline).toContain('9 ERG vincolati alla ri-emissione')
    expect(d.confidence).toBe('certa')
  })
  it('commissioni: tutti gli input nel contratto delle commissioni, un solo output alla ricompensa', () => {
    const d = dec(mFees)!
    expect(d.kind).toBe('mining-fees')
    expect(d.headline).toContain('1 commissione')
  })
  it('incasso semplice: ricompense senza gettoni di ri-emissione, niente versamento da dichiarare', () => {
    const d = dec(mReward)!
    expect(d.kind).toBe('mining-reward')
    expect(d.headline).toContain('2 ricompense mature')
    expect(d.headline).not.toContain('ri-emissione')
  })
  it('incasso di una pool: 36,02 ERG, 27 versati alla ri-emissione, inviati a 12 indirizzi', () => {
    const d = dec(mPayout)!
    expect(d.kind).toBe('mining-reward')
    expect(d.headline).toContain('36,02 ERG')
    expect(d.headline).toContain('27 ERG versati alla ri-emissione')
    expect(d.headline).toContain('12 indirizzi')
  })
  it('ri-emissione: i versamenti entrano nel contratto, e si dice quanto', () => {
    const d = dec(mReem)!
    expect(d.kind).toBe('mining-reemission')
    expect(d.headline).toContain('2 versamenti')
    expect(d.headline).toContain('155,99 ERG')
  })
  it('se il versamento alla ri-emissione non torna col vincolo, il riconoscitore TACE', () => {
    const t = clone(mPayout) as unknown as Tx
    const v = t.outputs.find(o => o.address.startsWith('6Kxused'))!
    v.value = String(BigInt(v.value) - 1n)            // un nanoERG in meno: non è la forma che conosciamo
    expect(mining.recognize(t)).toBeNull()
  })
  it('il contratto delle ricompense si riconosce dalla forma esatta: un byte in più e non lo è', () => {
    const box = (mEmission as unknown as Tx).outputs.find(isMinerReward)!
    expect(isMinerReward(box)).toBe(true)
    expect(isMinerReward({ ...box, ergoTree: box.ergoTree!.replace('cd', 'cd00') })).toBe(false)
    expect(isMinerReward({ ...box, ergoTree: undefined })).toBe(false)
  })
})

describe('oracoli: chi porta il prezzo in catena', () => {
  it('pool v2 USD, datapoint: 1 ERG = 0,3336 $ (R6 = nanoERG per dollaro)', () => {
    const d = dec(oUsdDp)!
    expect(d.kind).toBe('oracle-datapoint')
    expect(d.headline).toBe('Oracolo ERG/USD (pool v2): un operatore pubblica il prezzo, 1 ERG = 0,3336 $')
  })
  it('pool v2 USD, refresh: nuovo prezzo e numero di operatori', () => {
    const d = dec(oUsdRef)!
    expect(d.kind).toBe('oracle-refresh')
    expect(d.headline).toContain('1 ERG = 0,3277 $')
    expect(d.headline).toContain('da 8 operatori')
  })
  it('pool oro: si dice che il prezzo è stato pubblicato, NON quale (unità non verificata)', () => {
    expect(dec(oGoldDp)!.headline).toBe('Oracolo oro (pool v2): un operatore pubblica un nuovo prezzo')
    const r = dec(oGoldRef)!
    expect(r.kind).toBe('oracle-refresh')
    expect(r.headline).not.toMatch(/\$/)
  })
  it('pool v1 (quello di SigmaUSD): datapoint, chiusura dell’epoca, apertura', () => {
    expect(dec(oV1Dp)!.headline).toContain('1 ERG = 0,327 $')
    const c = dec(oV1Col)!
    expect(c.kind).toBe('oracle-v1-collect')
    expect(c.headline).toContain('da 4 operatori')
    expect(dec(oV1Ep)!.kind).toBe('oracle-v1-epoch')
  })
  it('un operatore che sposta il suo gettone su un altro indirizzo NON pubblica un prezzo', () => {
    const t = clone(oUsdDp) as unknown as Tx
    const op = t.outputs.find(o => (o.assets ?? []).some(a => a.tokenId.startsWith('74fa4aee')))!
    op.address = '9gnhfapSW2RtUYXR7DukoaSZfZpNazzcuyUhay5mjBW91qHS345'
    expect(oracle.recognize(t)).toBeNull()
  })
  it('la banca SigmaUSD legge l’oracolo come dataInput: resta una transazione SigmaUSD', () => {
    expect(dec(redeem)!.kind).toBe('sigmausd')
    expect(dec(rsvMint)!.kind).toBe('sigmausd')
  })
  it('uno swap di DORT (il gettone-ricompensa degli oracoli) resta uno swap', () => {
    expect(dec(swapBuy)!.kind).toBe('spectrum-n2t')
  })
})

describe('registri Long: stessa lettura da renderedValue e da serializedValue', () => {
  it('05ce89e8aa16 → 2.997.682.791', () => expect(decodeLong('05ce89e8aa16')).toBe(2_997_682_791n))
  it('zig-zag: 03 → -2, 04 → 2', () => { expect(decodeLong('0503')).toBe(-2n); expect(decodeLong('0504')).toBe(2n) })
  it('tipo sbagliato, byte avanzati, VLQ troncato → null, mai un numero inventato', () => {
    expect(decodeLong('04d6d303')).toBeNull()
    expect(decodeLong('05ce89e8aa1600')).toBeNull()
    expect(decodeLong('05ce89')).toBeNull()
  })
  it('senza renderedValue (come risponde sigmaspace) il prezzo è lo stesso', () => {
    const t = clone(oUsdDp) as unknown as Tx
    const out = t.outputs.find(o => (o.additionalRegisters as Record<string, unknown> | undefined)?.R6)!
    const r6 = (out.additionalRegisters as Record<string, { renderedValue?: string; serializedValue?: string }>).R6!
    const atteso = longReg(out, 'R6')
    delete r6.renderedValue
    expect(longReg(out, 'R6')).toBe(atteso)
    expect(dec(t)!.headline).toContain('0,3336 $')
  })
})

/* ---------------- movimenti fra wallet: la frase dice COSA arriva ---------------- */
// Il difetto (27/09): con dei token il trasferimento diceva solo l'ERG. «Trasferimento:
// A → B, 0 ERG» mentre partivano 2.000 token; «0,001 ERG» mentre partivano 320.000 SigRSV.
// Misurato su 1.000 blocchi: 95 trasferimenti «certi» così. Tutte fixture reali.
import { feeOnly } from './recognizers/fee-only'
import { simpleTransfer } from './recognizers/simple-transfer'
import tSigRsv from './fixtures/transfer-token-sigrsv.json'
import tNoErg from './fixtures/transfer-token-senza-erg.json'
import tDec from './fixtures/transfer-token-decimali.json'
import tMany from './fixtures/transfer-molti.json'
import wReorg from './fixtures/wallet-consolida.json'
import wInternal from './fixtures/wallet-interno.json'
import wBurn from './fixtures/wallet-brucia.json'
import fTrue from './fixtures/feeonly-true.json'
import f3p from './fixtures/feeonly-3pwdzr.json'
import f5y from './fixtures/feeonly-5ye8z.json'
import fWallet from './fixtures/feeonly-wallet.json'

describe('trasferimenti: i token prima, l’ERG solo se non è il minimo del box', () => {
  it('320.000 SigRSV, non «0,001 ERG»', () => {
    const h = dec(tSigRsv)!.headline
    expect(h).toContain('320.000 SigRSV')
    expect(h).not.toContain('0,001 ERG')
  })
  it('2.000 Mi Goreng, non «0 ERG»', () => {
    const h = dec(tNoErg)!.headline
    expect(h).toContain('2.000 Mi Goreng')
    expect(h).not.toMatch(/\b0 ERG/)
  })
  it('i decimali del token contano: 270 unità di ergopad (2 decimali) = 2,7; e l’ERG sopra 0,01 si dice', () => {
    expect(dec(tDec)!.headline).toContain('2,7 ergopad + 0,0161 ERG')
  })
  it('più di due destinatari non è più «troppo»: si dice quanti', () => {
    const d = dec(tMany)!
    expect(d.kind).toBe('transfer')
    expect(d.headline).toContain('6 destinatari')
  })
  it('i trasferimenti di sempre non cambiano', () => {
    expect(dec(transferSimple)!.headline).toBe('Trasferimento: 9gnhfapS…S345 → 9hcPxnnp…HbJD, 5.000 ERG')
  })
  it('un token che non era negli input è un CONIO: il riconoscitore dei trasferimenti tace', () => {
    const t = clone(tSigRsv) as unknown as Tx
    t.outputs[0]!.assets = [...(t.outputs[0]!.assets ?? []), { tokenId: 'ff'.repeat(32), amount: 1, name: 'Nuovo', decimals: 0 }]
    expect(simpleTransfer.recognize(t)).toBeNull()
  })
})

describe('movimenti interni: nessun destinatario esterno', () => {
  it('un solo wallet che divide o riunisce i suoi box', () => {
    const d = dec(wReorg)!
    expect(d.kind).toBe('wallet-internal')
    expect(d.headline).toContain('riorganizza i propri box: 1 → 2')
  })
  it('più indirizzi, il valore resta fra loro', () => {
    expect(dec(wInternal)!.headline).toContain('2 box da 2 indirizzi diventano 1')
  })
  it('i token che spariscono si dicono bruciati, coi loro decimali', () => {
    expect(dec(wBurn)!.headline).toContain('e brucia 500 WT_ADA, 25 WT_ERG')
  })
})

describe('commissione pura: tutto ai minatori', () => {
  it('dal contratto «sempre vero» (ErgoTree 0008d3): conta fra il mining, e si dice che può spenderlo chiunque', () => {
    const d = dec(fTrue)!
    expect(d.kind).toBe('mining-tip')
    expect(d.headline).toContain('può spenderlo chiunque')
  })
  it('da altri contratti: stessa lettura, senza dire chi può spenderli', () => {
    for (const fx of [f3p, f5y]) {
      const d = dec(fx)!
      expect(d.kind).toBe('mining-tip')
      expect(d.headline).not.toContain('chiunque')
    }
  })
  it('da un wallet: NON è mining, conta fra le transazioni di persone', () => {
    const d = dec(fWallet)!
    expect(d.kind).toBe('fee-only')
    expect(d.headline).toContain('ai minatori, senza altri destinatari')
  })
  it('la raccolta delle commissioni del minatore resta mining-fees, e un trasferimento non è commissione pura', () => {
    expect(dec(mFees)!.kind).toBe('mining-fees')
    expect(feeOnly.recognize(transferSimple as never)).toBeNull()
  })
})
