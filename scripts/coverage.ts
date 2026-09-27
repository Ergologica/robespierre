/**
 * COPERTURA DEL DECODIFICATORE — quante transazioni recenti Robespierre sa spiegare,
 * e quali contratti restano muti, in ordine di frequenza.
 *
 *   npx vite-node scripts/coverage.ts            # ultimi 1.000 blocchi
 *   BLOCKS=200 npx vite-node scripts/coverage.ts # prova veloce
 *
 * Perché esiste: il piano d'autunno misura il vantaggio sugli altri explorer con UN
 * numero pubblico — la quota di transazioni spiegate — e sceglie il prossimo
 * riconoscitore da una classifica misurata, non da quello che immaginiamo.
 *
 * Come raggruppa le transazioni non riconosciute: per MODELLO di contratto, non per
 * indirizzo. Molti contratti incorporano delle costanti (la chiave di chi ha fatto
 * l'ordine, quella del minatore): stesso contratto, mille indirizzi. Quando
 * l'ErgoTree tiene le costanti separate (bit 0x10 dell'intestazione), il modello è
 * l'albero SENZA la tabella delle costanti: `treeTemplate` la salta. Se una costante
 * è di un tipo che non sappiamo leggere, si ripiega sull'indirizzo: un raggruppamento
 * più fine, mai uno sbagliato. (Il campo `ergoTreeScript` dell'API non serve: per lo
 * stesso contratto arriva a volte decompilato, a volte come AST — due impronte.)
 * Si guardano prima i contratti SPESI (con chi si interagisce), poi, se non ce ne
 * sono, quelli CREATI (chi deposita in un contratto).
 *
 * Scrive `data/coverage.json` (riassunto, senza dati personali) e la classifica a schermo.
 * Le transazioni scaricate restano in una cache locale (COV_CACHE, predefinita
 * `.cache/coverage`, fuori dal repo) così una seconda esecuzione non ripete il lavoro.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode } from '../src/decoder/index'
import { FEE_ADDRESS } from '../src/decoder/recognizers/simple-transfer'
import labels from '../src/labels.json'
import type { Tx } from '../src/api/types'

const API = process.env.API ?? 'https://api.ergoplatform.com/api/v1'
const BLOCKS = Number(process.env.BLOCKS ?? 1000)
const CONC = Number(process.env.CONC ?? 4)
const CACHE = process.env.COV_CACHE ?? '.cache/coverage'
mkdirSync(CACHE, { recursive: true })

type Box = Tx['inputs'][number] & { ergoTree?: string }

/* ---- il modello di un ErgoTree: l'albero senza la tabella delle costanti ---- */
class Reader {
  constructor(private b: Uint8Array, public i = 0) {}
  byte(): number { if (this.i >= this.b.length) throw new Error('eof'); return this.b[this.i++]! }
  skip(n: number): void { if (this.i + n > this.b.length) throw new Error('eof'); this.i += n }
  vlq(): number { let r = 0, s = 0, x: number; do { x = this.byte(); r += (x & 0x7f) * 2 ** s; s += 7 } while (x & 0x80); return r }
  rest(): Uint8Array { return this.b.slice(this.i) }
}
// un valore di tipo primitivo; false se il tipo non è gestito
function skipPrim(r: Reader, code: number): boolean {
  switch (code) {
    case 1: case 2: r.skip(1); return true            // Boolean, Byte
    case 3: case 4: case 5: r.vlq(); return true      // Short, Int, Long (zigzag VLQ)
    case 6: r.skip(r.vlq()); return true              // BigInt: lunghezza + byte
    case 7: r.skip(33); return true                   // GroupElement
    case 8: return skipSigma(r)                       // SigmaProp
    default: return false
  }
}
function skipSigma(r: Reader): boolean {
  const op = r.byte()
  if (op === 0xcd) { r.skip(33); return true }        // ProveDlog
  if (op === 0xce) { r.skip(4 * 33); return true }    // ProveDHTuple
  return false                                        // AND/OR/soglie: non ci serve, si ripiega
}
function skipConst(r: Reader): boolean {
  const t = r.byte()
  if (t >= 1 && t <= 8) return skipPrim(r, t)
  if (t === 0x0d) { r.skip(Math.ceil(r.vlq() / 8)); return true }          // Coll[Boolean]: bit
  if (t === 0x0e) { r.skip(r.vlq()); return true }                          // Coll[Byte]
  if (t > 0x0c && t <= 0x0c + 8) { const n = r.vlq(); for (let k = 0; k < n; k++) if (!skipPrim(r, t - 0x0c)) return false; return true }
  if (t === 0x1a) { const n = r.vlq(); for (let k = 0; k < n; k++) r.skip(r.vlq()); return true } // Coll[Coll[Byte]]
  return false
}
function treeTemplate(hex?: string): string | null {
  if (!hex) return null
  try {
    const r = new Reader(Uint8Array.from(hex.match(/../g)!.map(h => parseInt(h, 16))))
    const header = r.byte()
    if (header & 0x08) r.vlq()                        // dimensione dichiarata
    if (!(header & 0x10)) return hex                  // costanti in linea: l'albero è il modello
    const n = r.vlq()
    for (let k = 0; k < n; k++) if (!skipConst(r)) return null
    return header.toString(16) + ':' + Buffer.from(r.rest()).toString('hex')
  } catch { return null }
}

async function get<T>(path: string, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API + path)
      if (r.ok) return (await r.json()) as T
      if (r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${path}`)
      if (i >= tries) throw new Error(`${r.status} dopo ${tries} tentativi: ${path}`)
    } catch (e) {
      if (i >= tries || /^\d{3} /.test(String((e as Error).message))) throw e
    }
    await new Promise(res => setTimeout(res, 800 * 2 ** i))
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0, done = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
      if (++done % 250 === 0) process.stderr.write(`  ${done}/${items.length}\n`)
    }
  }))
  return out
}

/* ---- 1. gli ultimi N blocchi, e gli id delle loro transazioni ---- */
const headers: { id: string; height: number }[] = []
for (let off = 0; headers.length < BLOCKS; off += 100) {
  const p = await get<{ items: { id: string; height: number }[] }>(`/blocks?offset=${off}&limit=100&sortBy=height&sortDirection=desc`)
  headers.push(...p.items)
  if (!p.items.length) break
}
headers.length = Math.min(headers.length, BLOCKS)
const top = headers[0]!.height, bottom = headers[headers.length - 1]!.height
process.stderr.write(`blocchi ${bottom}–${top} (${headers.length})\n`)

const txIds = (await pool(headers, CONC, async h => {
  const f = join(CACHE, `b-${h.id}.json`)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as string[]
  const b = await get<{ block: { blockTransactions: { id: string }[] } }>(`/blocks/${h.id}`)
  const ids = b.block.blockTransactions.map(t => t.id)
  writeFileSync(f, JSON.stringify(ids))
  return ids
})).flat()
process.stderr.write(`transazioni: ${txIds.length}\n`)

/* ---- 2. ogni transazione per intero (servono gli asset degli input) ---- */
const txs = await pool(txIds, CONC, async id => {
  const f = join(CACHE, `t-${id}.json`)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Tx
  const t = await get<Tx>(`/transactions/${id}`)
  writeFileSync(f, JSON.stringify(t))
  return t
})

/* ---- 3. decodifica e raggruppamento ---- */
const label = (a: string): string | null => {
  const l = (labels as Record<string, unknown>)[a]
  return l && typeof l === 'object' && 'name' in l ? String((l as { name: string }).name) : null
}
const isP2PK = (a: string) => a.startsWith('9')
const template = (b: Box) => createHash('sha256').update(treeTemplate(b.ergoTree) ?? b.address).digest('hex').slice(0, 12)

interface Group { key: string; side: 'spende' | 'crea' | 'solo wallet'; txs: number; sample: string; names: Set<string>; addresses: Set<string>; example: string }
const groups = new Map<string, Group>()
const byAddr = new Map<string, Box>()
const byKind = new Map<string, number>()
let recognized = 0

for (const tx of txs) {
  const d = decode(tx)
  if (d) { recognized++; byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1); continue }
  const ins = (tx.inputs as Box[]).filter(b => !isP2PK(b.address) && b.address !== FEE_ADDRESS)
  const outs = (tx.outputs as Box[]).filter(b => !isP2PK(b.address) && b.address !== FEE_ADDRESS)
  // anche il contratto delle commissioni conta, se è SPESO: è il minatore che le raccoglie
  const feeSpent = (tx.inputs as Box[]).filter(b => b.address === FEE_ADDRESS)
  const [side, boxes] = ins.length ? ['spende', ins] as const
    : feeSpent.length ? ['spende', feeSpent] as const
    : outs.length ? ['crea', outs] as const
    : ['solo wallet', [] as Box[]] as const
  const keys = [...new Set(boxes.map(template))].sort()
  const key = side + ':' + (keys.join('+') || 'p2pk')
  const g = groups.get(key) ?? { key, side, txs: 0, sample: boxes[0]?.address ?? '', names: new Set(), addresses: new Set(), example: tx.id }
  g.txs++
  for (const b of boxes) { byAddr.set(b.address, b); g.addresses.add(b.address); const n = label(b.address); if (n) g.names.add(n) }
  groups.set(key, g)
}

// Seconda vista, quella che decide il prossimo riconoscitore: per SINGOLO modello di
// contratto. Una transazione che tocca due contratti conta per entrambi.
const perTemplate = new Map<string, { txs: number; side: string; sample: string; names: Set<string>; addresses: Set<string>; example: string }>()
for (const g of groups.values()) {
  for (const t of g.key.split(':')[1]!.split('+')) {
    if (t === 'p2pk') continue
    const e = perTemplate.get(t) ?? { txs: 0, side: g.side, sample: '', names: new Set<string>(), addresses: new Set<string>(), example: g.example }
    e.txs += g.txs
    g.names.forEach(n => e.names.add(n))
    // l'indirizzo d'esempio deve essere uno di QUESTO modello
    for (const a of g.addresses) { const b = byAddr.get(a); if (b && template(b) === t) { e.addresses.add(a); e.sample ||= a } }
    perTemplate.set(t, e)
  }
}

const total = txs.length
const pct = (n: number) => (100 * n / total).toFixed(1).replace('.', ',') + '%'
const ranking = [...groups.values()].sort((a, b) => b.txs - a.txs)

console.log(`\nCOPERTURA — blocchi ${bottom}–${top}, ${total} transazioni`)
console.log(`riconosciute: ${recognized} (${pct(recognized)})`)
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(22)} ${String(n).padStart(6)}  ${pct(n)}`)
console.log(`\nNON riconosciute, per modello di contratto (prime 25):`)
for (const g of ranking.slice(0, 25)) {
  const name = g.names.size ? [...g.names].join(', ') : g.sample.slice(0, 14) + '…'
  console.log(`${String(g.txs).padStart(6)}  ${pct(g.txs).padStart(6)}  ${g.side.padEnd(11)} ${name}  [${g.addresses.size} indirizzi · es. ${g.example.slice(0, 10)}]`)
}

const perT = [...perTemplate].sort((a, b) => b[1].txs - a[1].txs)
console.log(`\nNON riconosciute, per SINGOLO contratto (una tx può toccarne più d'uno):`)
for (const [t, e] of perT.slice(0, 20)) {
  const name = e.names.size ? [...e.names].join(', ') : e.sample.slice(0, 14) + '…'
  console.log(`${String(e.txs).padStart(6)}  ${pct(e.txs).padStart(6)}  ${name}  [modello ${t} · ${e.addresses.size} indirizzi · es. ${e.example.slice(0, 10)}]`)
}

mkdirSync('data', { recursive: true })
writeFileSync('data/coverage.json', JSON.stringify({
  measuredAt: new Date().toISOString(),
  blocks: { from: bottom, to: top, count: headers.length },
  transactions: total,
  recognized,
  byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  // solo contratti e transazioni d'esempio: niente indirizzi personali (P2PK)
  byContract: perT.slice(0, 40).map(([t, e]) => ({
    template: t, txs: e.txs, names: [...e.names], sampleContract: e.sample || null,
    distinctAddresses: e.addresses.size, exampleTx: e.example,
  })),
  unrecognized: ranking.slice(0, 40).map(g => ({
    side: g.side, txs: g.txs, template: g.key.split(':')[1],
    names: [...g.names], sampleContract: isP2PK(g.sample) ? null : g.sample || null,
    distinctAddresses: g.addresses.size, exampleTx: g.example,
  })),
}, null, 2) + '\n')
console.log(`\nscritto data/coverage.json`)
