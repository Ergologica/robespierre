/**
 * Ogni 6 ore: una riga di storia dei protocolli in data/protocols/log.json.
 * Stessa lettura della pagina /protocolli: banca dal box col Bank NFT,
 * oracolo dal box col suo NFT (R4 = nanoERG per USD), prezzo di mercato da CoinGecko.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

import C from '../src/decoder/protocol-constants.json' with { type: 'json' }
const BANK_ADDR = C.sigmausd.bankAddress
const ORACLE_NFT = C.oracle.ergUsdNft
const BANK_NFT = C.sigmausd.bankNft
const SIGUSD = C.sigmausd.sigUsd
const CAP = 4000

async function j(u) { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }

const bankPg = await j(`https://api.ergoplatform.com/api/v1/boxes/unspent/byAddress/${encodeURIComponent(BANK_ADDR)}?limit=10`)
const bank = (bankPg.items ?? []).find(b => b.assets?.some(a => a.tokenId === BANK_NFT))
if (!bank) throw new Error('banca non trovata')
const usdTok = await j(`https://api.ergoplatform.com/api/v1/tokens/${SIGUSD}`)
const bankUsd = BigInt(bank.assets.find(a => a.tokenId === SIGUSD)?.amount ?? 0)
const circUsdUnits = BigInt(usdTok.emissionAmount) - bankUsd
const reserve = BigInt(bank.value)

let ratioOracle = null
try {
  const oPg = await j(`https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${ORACLE_NFT}?limit=5`)
  const oracle = (oPg.items ?? []).find(b => b.assets?.some(a => a.tokenId === ORACLE_NFT))
  const nano = oracle?.additionalRegisters?.R4?.renderedValue
  if (nano && circUsdUnits > 0n) {
    const liab = circUsdUnits * BigInt(nano) / 100n
    if (liab > 0n) ratioOracle = Number(reserve * 10000n / liab) / 100
  }
} catch { /* resta null: il punto lo dichiara */ }

let ratioMarket = null
try {
  const cg = await j('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd')
  const p = cg?.ergo?.usd
  if (p && circUsdUnits > 0n) ratioMarket = (Number(reserve / 1_000_000n) / 1000 * p) / (Number(circUsdUnits) / 100) * 100
} catch { /* opzionale per definizione */ }

mkdirSync('data/protocols', { recursive: true })
const file = 'data/protocols/log.json'
const log = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
log.push({
  at: new Date().toISOString(),
  ratioOracle: ratioOracle != null ? Math.round(ratioOracle * 10) / 10 : null,
  ratioMarket: ratioMarket != null ? Math.round(ratioMarket * 10) / 10 : null,
  reserveErg: Number(reserve / 1_000_000_000n),
  circUsd: Number(circUsdUnits) / 100,
})
writeFileSync(file, JSON.stringify(log.slice(-CAP)) + '\n')
console.log('punti in serie:', Math.min(log.length, CAP), 'ultimo ratioOracle:', ratioOracle)
