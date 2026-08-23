/**
 * Job notturno: concentrazione dei detentori per i token in data/big-tokens.json.
 * Legge TUTTI i box non spesi per token (nessun tetto: qui non c'è un browser che aspetta),
 * scrive data/holders/<tokenId>.json con la data del calcolo.
 * Stesse regole del sito: quote sul totale letto, niente giudizi, solo numeri.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const TOP = 10
const PAGE = 100
const SANITY_MAX_BOXES = 200_000 // paracadute contro loop; dichiarato nel file di uscita se scatta
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function j(url) {
  // tre tentativi con attesa crescente: un 503 di passaggio non deve buttare la notte
  for (let i = 0; ; i++) {
    const r = await fetch(url).catch(() => null)
    if (r?.ok) return r.json()
    if (i >= 2) throw new Error('HTTP ' + (r?.status ?? 'rete') + ' su ' + url)
    await sleep(2000 * (i + 1) ** 2)
  }
}

async function holdersOf(tokenId) {
  const agg = new Map()
  let total = null, read = 0, capped = false
  for (let off = 0; ; off += PAGE) {
    const pg = await j(`https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${tokenId}?limit=${PAGE}&offset=${off}`)
    total ??= pg.total ?? 0
    for (const b of pg.items ?? []) {
      const amt = BigInt(b.assets?.find(a => a.tokenId === tokenId)?.amount ?? 0)
      if (amt > 0n) agg.set(b.address, (agg.get(b.address) ?? 0n) + amt)
    }
    read += (pg.items ?? []).length
    if ((pg.items ?? []).length < PAGE || read >= total) break
    if (read >= SANITY_MAX_BOXES) { capped = true; break }
    await sleep(150) // gentilezza verso l'API pubblica
  }
  const sum = [...agg.values()].reduce((a, b) => a + b, 0n)
  const sorted = [...agg.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
  const pct = v => sum > 0n ? Number(v * 10000n / sum) / 100 : 0
  const top = sorted.slice(0, TOP).map(([address, amount]) => ({ address, amount: amount.toString(), pct: pct(amount) }))
  const restAmt = sorted.slice(TOP).reduce((a, [, v]) => a + v, 0n)
  return {
    at: new Date().toISOString(), total, holders: sorted.length,
    top, restPct: pct(restAmt), restCount: Math.max(0, sorted.length - TOP),
    ...(capped ? { capped: true, readBoxes: read } : {}),
  }
}

const list = JSON.parse(readFileSync('data/big-tokens.json', 'utf8')).tokens
mkdirSync('data/holders', { recursive: true })
for (const t of list) {
  try {
    const res = await holdersOf(t.id)
    writeFileSync(`data/holders/${t.id}.json`, JSON.stringify(res) + '\n')
    console.log(`${t.name}: ${res.holders} indirizzi su ${res.total} box`)
  } catch (e) {
    console.error(`${t.name}: SALTATO (${e.message}) — il file precedente, se c'è, resta valido`)
  }
  await sleep(400)
}
