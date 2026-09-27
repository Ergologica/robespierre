/**
 * COMPATIBILITÀ fra l'Explorer API ufficiale e quella di sigmaspace, endpoint per endpoint.
 *
 *   node scripts/api-compat.mjs
 *
 * Serve a decidere il ripiego (piano d'autunno, 1.7 e 2.3): quando l'API ufficiale non
 * risponde, per quali chiamate il sito può chiedere a sigmaspace SENZA cambiare codice.
 * Regola: si ripiega solo dove la risposta ha la stessa forma E gli stessi valori.
 * Una forma uguale con valori diversi è peggio di un errore: il sito mostrerebbe con
 * sicurezza un dato diverso a seconda di quale fonte ha risposto.
 *
 * Per ogni endpoint confronta: stato HTTP, chiavi (ricorsivamente, sul primo elemento
 * delle liste), e i valori che il sito usa davvero (id, importi, totali).
 */
const A = 'https://api.ergoplatform.com/api/v1'
const B = 'https://api.sigmaspace.io/api/v1'

const ROSEN_TX = 'e06697e0e08c2dc69db3b0fb75e89f3bc665e1c79316657a33c4e7c521bfdca3'
const COMET = '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b'
const NOPE = '0'.repeat(64)

async function call(base, path) {
  const t0 = Date.now()
  try {
    const r = await fetch(base + path, { headers: { Origin: 'https://ergologica.github.io' } })
    const text = await r.text()
    let body = null; try { body = JSON.parse(text) } catch {}
    return { status: r.status, body, ms: Date.now() - t0, cors: r.headers.get('access-control-allow-origin') }
  } catch (e) { return { status: 0, body: null, ms: Date.now() - t0, err: String(e) } }
}

// la forma: chiavi ricorsive, liste ridotte al primo elemento, "$schema" ignorato
function shape(v, depth = 0) {
  if (depth > 4) return '…'
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : []
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v).sort()) if (k !== '$schema') o[k] = shape(v[k], depth + 1)
    return o
  }
  return v === null ? 'null' : typeof v
}
function diffShape(a, b, path = '') {
  const out = []
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    // null contro valore: le due API a volte omettono, a volte mettono null
    if (a === 'null' || b === 'null') return out
    return [`${path || '·'}: ${JSON.stringify(a).slice(0, 30)} ≠ ${JSON.stringify(b).slice(0, 30)}`]
  }
  if (Array.isArray(a)) return a.length && b.length ? diffShape(a[0], b[0], path + '[0]') : out
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) out.push(`${path}.${k}: solo ufficiale`)
      else if (!(k in a)) out.push(`${path}.${k}: solo sigmaspace`)
      else out.push(...diffShape(a[k], b[k], path + '.' + k))
    }
  }
  return out
}

const sum = xs => xs.reduce((s, x) => s + BigInt(x.value), 0n)
const cases = () => [
  ['/info', 'rete', (a, b) => Math.abs(a.height - b.height) <= 2 || `altezza ${a.height} vs ${b.height}`],
  ['/blocks?limit=8&sortBy=height&sortDirection=desc', 'ultimi blocchi', (a, b) =>
    a.items[3]?.id === b.items.find(x => x.height === a.items[3]?.height)?.id || 'id dei blocchi diversi'],
  [`/transactions/${ROSEN_TX}`, 'transazione', (a, b) =>
    (a.outputs.length === b.outputs.length && sum(a.outputs) === sum(b.outputs) && sum(a.inputs) === sum(b.inputs)
      && JSON.stringify(a.outputs.map(o => o.assets.map(x => x.amount))) === JSON.stringify(b.outputs.map(o => o.assets.map(x => x.amount))))
      || 'box o importi diversi'],
  [`/addresses/${ADDR}/balance/confirmed`, 'saldo indirizzo', (a, b) => String(a.nanoErgs) === String(b.nanoErgs) || `${a.nanoErgs} vs ${b.nanoErgs}`],
  [`/addresses/${ADDR}/transactions?offset=0&limit=5`, 'movimenti indirizzo', (a, b) =>
    (a.total === b.total && a.items[0]?.id === b.items[0]?.id) || `totale ${a.total} vs ${b.total}`],
  [`/tokens/${COMET}`, 'token', (a, b) => (a.name === b.name && String(a.emissionAmount) === String(b.emissionAmount)) || 'nome o emissione diversi'],
  ['__BOX__', 'box', (a, b) => (a.value === b.value && a.address === b.address) || 'valore/indirizzo diversi'],
  ['__BLOCKH__', 'blocco per altezza', (a, b) => a.items[0]?.id === b.items[0]?.id || 'id diverso'],
  ['__BLOCK__', 'blocco completo', (a, b) => a.block.blockTransactions.length === b.block.blockTransactions.length || 'n. transazioni diverso'],
  ['/tokens/search?query=COMET&limit=100', 'ricerca token per nome', (a, b) => a.total === b.total || `${a.total} vs ${b.total}`],
  ['/tokens?offset=0&limit=5', 'elenco token', (a, b) => a.total === b.total || `${a.total} vs ${b.total}`],
  [`/boxes/unspent/byAddress/${ADDR}?limit=100&offset=0`, 'box non spesi di un indirizzo', (a, b) => a.total === b.total || `${a.total} vs ${b.total}`],
  [`/boxes/unspent/byTokenId/${COMET}?limit=100`, 'box non spesi di un token (holder)', (a, b) => a.total === b.total || `${a.total} vs ${b.total}`],
  [`/transactions/${NOPE}`, 'errore: tx inesistente → 404', () => true],
  ['/addresses/9fakeaddress/balance/confirmed', 'errore: indirizzo malformato → 400', (a, b) => true],
]

const rosen = (await call(A, `/transactions/${ROSEN_TX}`)).body
// il ricevente del tx Rosen: preso dalla catena, non scritto a mano
const ADDR = rosen.outputs.find(o => o.address.startsWith('9gnh')).address
const boxId = rosen.outputs[0].boxId
const blocks = (await call(A, '/blocks?limit=8&sortBy=height&sortDirection=desc')).body
const h = blocks.items[3]

const rows = []
for (const [p0, what, same] of cases()) {
  const p = p0 === '__BOX__' ? `/boxes/${boxId}` : p0 === '__BLOCKH__' ? `/blocks?minHeight=${h.height}&maxHeight=${h.height}` : p0 === '__BLOCK__' ? `/blocks/${h.id}` : p0
  const [a, b] = await Promise.all([call(A, p), call(B, p)])
  let verdict, note = ''
  if (a.status !== b.status) { verdict = 'NO'; note = `stato ${a.status} vs ${b.status}` }
  else if (a.status >= 400) {
    // sugli errori conta che il sito riconosca il caso: 404 = non c'è, 400+checksum = malformato
    const ra = a.body?.reason ?? '', rb = b.body?.reason ?? b.body?.detail ?? ''
    verdict = /checksum/i.test(ra) === /checksum/i.test(rb) ? 'SÌ' : 'NO'
    note = `${a.status} · ufficiale «${String(ra).slice(0, 40)}» · sigmaspace «${String(rb).slice(0, 40)}»`
  } else {
    const d = diffShape(shape(a.body), shape(b.body))
    let v; try { v = same(a.body, b.body) } catch (e) { v = 'confronto fallito: ' + e.message }
    verdict = d.length === 0 && v === true ? 'SÌ' : v === true ? 'FORMA' : 'NO'
    note = [v === true ? '' : v, d.slice(0, 3).join('; ') + (d.length > 3 ? ` (+${d.length - 3})` : '')].filter(Boolean).join(' · ')
  }
  rows.push({ what, path: p.replace(/[0-9a-f]{40,}/g, m => m.slice(0, 8) + '…').replace(ADDR, '9gnh…S345'), verdict, note, ms: `${a.ms} / ${b.ms}`, cors: b.cors ?? '—' })
}

console.log('| endpoint | percorso | ripiego | ms uff./sigma | CORS sigma | note |')
console.log('|---|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.what} | \`${r.path}\` | **${r.verdict}** | ${r.ms} | ${r.cors} | ${r.note.replace(/\|/g, '/')} |`)
console.log(`\nSÌ = stessa forma e stessi valori · FORMA = valori uguali, chiavi diverse · NO = non usabile così (misurato ${new Date().toISOString()})`)
