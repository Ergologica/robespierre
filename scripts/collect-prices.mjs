// Raccoglie i prezzi del giorno: ERG in USD/EUR (CoinGecko) + mercati Spectrum.
// Un file al giorno in data/prices/YYYY-MM-DD.json — un commit al giorno, non 35.000 l'anno.
import { writeFileSync, mkdirSync } from 'node:fs'
const day = new Date().toISOString().slice(0, 10)
const out = { day, collectedAt: new Date().toISOString() }
try {
  const cg = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ergo&vs_currencies=usd,eur')).json()
  out.erg = cg?.ergo ?? null
} catch { out.erg = null }
try {
  const mk = await (await fetch('https://api.spectrum.fi/v1/price-tracking/markets')).json()
  out.spectrumMarkets = Array.isArray(mk) ? mk : null
} catch { out.spectrumMarkets = null }
mkdirSync('data/prices', { recursive: true })
writeFileSync(`data/prices/${day}.json`, JSON.stringify(out, null, 1))
console.log('salvato data/prices/' + day + '.json',
  '· erg:', out.erg ? 'ok' : 'MANCANTE', '· mercati:', out.spectrumMarkets?.length ?? 'MANCANTI')
