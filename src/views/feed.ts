import { api } from '../api/explorer'
import type { BlockHeader, Tx } from '../api/types'
import { decodeWith } from '../decoder/index'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import { categoryOf, tagKeyOf, looksRoutine, markAmounts, shortAgo, CATEGORIES } from '../lib/feed'
import type { Category, LightTx } from '../lib/feed'
import { esc } from './html'
import { shortId, groupThousands } from '../lib/format'
import { isCurrent } from '../lib/nav'
import { L } from '../i18n'
import { pool } from '../lib/pool'

/**
 * «Adesso sulla catena» — il flusso della home, dal vivo.
 *
 * Costo, misurato: un blocco porta ~6,4 transazioni, di cui ~1,2 fuori da mining e
 * oracoli (copertura del 27/09/2026). La risposta di /blocks/{id} non ha i token
 * degli input, quindi per decodificare serve /transactions/{id}, una per una. Con la
 * pre-selezione (lib/feed.ts) la home scarica i 10 blocchi e solo le ~15 transazioni
 * che non sono routine, 4 alla volta — invece di ~65. La routine si scarica solo se
 * la si chiede («mostrale»).
 */

export const FEED_BLOCKS = 10
/** Righe mostrate prima di «mostra le altre»: dieci blocchi ne portano una ventina. */
const FIRST_ROWS = 12
const CONC = 4

interface Item {
  id: string; ts: number; height: number
  kind: string | null; headline: string | null; confidence: 'certa' | 'probabile' | null
  cat: Category; units: string[]; nin: number; nout: number; hasContract: boolean
}
interface Pending { id: string; ts: number; height: number }

const st = {
  gen: -1,
  heights: [] as number[],                  // blocchi nella finestra, dal più recente
  items: new Map<string, Item>(),
  routinePending: [] as Pending[],          // riconosciute come routine dal blocco: non scaricate
  skipped: 0,
  showRoutine: false,
  loadingRoutine: false,
  cat: 'all' as Category | 'all',
  failed: false,
  expanded: false,
  infraShare: null as string | null,
}

function toItem(tx: Tx, height: number): Item {
  const r = decodeWith(tx)
  const d = r?.decoded ?? null
  return {
    id: tx.id, ts: tx.timestamp, height,
    kind: d?.kind ?? null, headline: d?.headline ?? null, confidence: d?.confidence ?? null,
    cat: categoryOf(d?.kind ?? null),
    units: [...tx.inputs, ...tx.outputs].flatMap(b => (b.assets ?? []).map(a => a.name?.trim() ?? '')).filter(Boolean),
    nin: tx.inputs.length, nout: tx.outputs.length,
    hasContract: [...tx.inputs, ...tx.outputs].some(b => !b.address.startsWith('9') && b.address !== FEE_ADDRESS),
  }
}

async function fetchItems(list: Pending[]): Promise<void> {
  await pool(list, CONC, async p => {
    try { st.items.set(p.id, toItem(await api.tx(p.id), p.height)) }
    catch { st.skipped++ }
  })
}

/** Scarica i blocchi indicati e le transazioni che non sono routine. */
async function loadBlocks(headers: BlockHeader[]): Promise<void> {
  const blocks = await pool(headers, CONC, async h => {
    try { return { h, b: await api.blockById(h.id) } } catch { return { h, b: null } }
  })
  const toFetch: Pending[] = []
  for (const { h, b } of blocks) {
    if (!b) { st.skipped += h.transactionsCount; continue }
    for (const t of b.block.blockTransactions as unknown as (LightTx & { timestamp: number })[]) {
      const p = { id: t.id, ts: t.timestamp ?? h.timestamp, height: h.height }
      if (looksRoutine(t)) { if (st.showRoutine) toFetch.push(p); else st.routinePending.push(p) }
      else toFetch.push(p)
    }
  }
  await fetchItems(toFetch)
}

/* ----------------------------- disegno ----------------------------- */

function rowHtml(it: Item, lead?: string): string {
  const read = it.headline != null
  const text = read
    ? markAmounts(esc(it.headline), it.units)
    : esc(it.hasContract ? L.feed_raw(it.nin, it.nout) : L.feed_raw_wallet(it.nin, it.nout))
  const rd = it.confidence === 'certa' ? `<span class="rd rd-sure"><i></i>${L.reading_sure}</span>`
    : it.confidence === 'probabile' ? `<span class="rd rd-prob"><i></i>${L.reading_prob}</span>`
    : `<span class="rd rd-none"><i></i>${L.read_none}</span>`
  return `<a class="frow${read ? '' : ' frow-raw'}" href="#/tx/${esc(it.id)}">
    ${lead != null ? `<span class="ftime">${lead}</span>` : `<span class="ftime" data-ago-short="${it.ts}">${shortAgo(it.ts)}</span>`}
    <span class="fmain">
      <span class="fline"><span class="ftag">${L[tagKeyOf(it.kind)]}</span><span class="ftext">${text}</span></span>
      <span class="fmeta"><span class="mono">${esc(shortId(it.id))}</span><span aria-hidden="true">·</span>${rd}</span>
    </span>
    <span class="fchev" aria-hidden="true">›</span>
  </a>`
}

/** Una transazione come riga del flusso, fuori dalla home (pagina del blocco). */
export function txRow(tx: Tx, height: number, lead?: string): { html: string; kind: string | null } {
  const it = toItem(tx, height)
  return { html: rowHtml(it, lead), kind: it.kind }
}

function visible(): Item[] {
  return [...st.items.values()]
    .filter(i => st.heights.includes(i.height))
    .filter(i => st.showRoutine || i.cat !== 'routine')
    .sort((a, b) => b.ts - a.ts || b.height - a.height)
}

export function renderFeed(): void {
  const list = document.querySelector('[data-feed]') as HTMLElement | null
  const chips = document.querySelector('[data-feed-chips]') as HTMLElement | null
  const foot = document.querySelector('[data-feed-foot]') as HTMLElement | null
  const win = document.querySelector('[data-feed-window]') as HTMLElement | null
  if (!list || !chips || !foot) return
  if (st.failed && !st.items.size) {
    list.innerHTML = `<div class="fempty">${L.feed_unavailable}</div>`
    chips.innerHTML = ''; foot.innerHTML = ''
    return
  }
  const all = visible()
  const count = (c: Category | 'all') => c === 'all' ? all.length : all.filter(i => i.cat === c).length
  const cats: (Category | 'all')[] = ['all', ...CATEGORIES, ...(st.showRoutine ? ['routine' as const] : [])]
  if (!cats.includes(st.cat)) st.cat = 'all'
  const label = (c: Category | 'all') => c === 'all' ? L.cat_all : L[`cat_${c}` as 'cat_transfer']
  chips.innerHTML = cats.map(c => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${st.cat === c}">${label(c)} <span class="n">${count(c)}</span></button>`).join('')

  const shown = st.cat === 'all' ? all : all.filter(i => i.cat === st.cat)
  const cut = st.expanded ? shown.length : FIRST_ROWS
  list.innerHTML = (shown.length ? shown.slice(0, cut).map(it => rowHtml(it)).join('')
    : `<div class="fempty">${st.cat === 'all' ? L.feed_empty : L.feed_empty_cat}</div>`)
    + (shown.length > cut ? `<button type="button" class="feed-more" data-feed-more>${L.feed_more(shown.length - cut)}</button>` : '')

  const routineN = st.routinePending.filter(p => st.heights.includes(p.height)).length
    + [...st.items.values()].filter(i => i.cat === 'routine' && st.heights.includes(i.height)).length
  const note = st.loadingRoutine ? L.feed_routine_loading
    : st.showRoutine ? L.feed_routine_shown(routineN)
    : L.feed_routine_hidden(routineN, st.infraShare)
  const skipped = st.skipped ? ` <span class="dim">${esc(L.feed_skipped(st.skipped))}</span>` : ''
  foot.innerHTML = `<span>${esc(note)}${skipped}</span>${routineN && !st.loadingRoutine
    ? `<button type="button" class="linkbtn" data-routine>${st.showRoutine ? L.feed_routine_hide : L.feed_routine_show}</button>` : ''}`
  if (win && st.heights.length) {
    win.textContent = L.feed_window(st.heights.length, groupThousands(String(Math.min(...st.heights))), groupThousands(String(Math.max(...st.heights))))
  }
}

/* ----------------------------- ciclo di vita ----------------------------- */

/** Avvia il flusso per la navigazione `gen`, dagli header già letti dalla pagina. */
export async function startFeed(gen: number, headers: BlockHeader[], infraShare: string | null): Promise<void> {
  const keep = st.gen === gen
  if (!keep) {
    // una nuova visita alla home: si riparte, ma le transazioni già lette restano in
    // cache nell'API client (30 s), quindi tornare indietro non rifà le richieste
    Object.assign(st, { gen, heights: [], items: new Map(), routinePending: [], skipped: 0, showRoutine: false, loadingRoutine: false, cat: 'all', failed: false, expanded: false })
  }
  st.infraShare = infraShare
  const win = headers.slice(0, FEED_BLOCKS)
  st.heights = win.map(h => h.height)
  try { await loadBlocks(win) } catch { st.failed = true }
  if (!win.length) st.failed = true
  if (isCurrent(gen)) renderFeed()
}

/** Un blocco nuovo: si aggiunge in testa, e la finestra resta di FEED_BLOCKS blocchi. */
export async function advanceFeed(gen: number, headers: BlockHeader[]): Promise<boolean> {
  if (st.gen !== gen || !headers.length) return false
  const top = Math.max(...st.heights, 0)
  const fresh = headers.filter(h => h.height > top)
  if (!fresh.length) return false
  st.heights = headers.slice(0, FEED_BLOCKS).map(h => h.height)
  await loadBlocks(fresh)
  // quello che è uscito dalla finestra si dimentica
  for (const [id, it] of st.items) if (!st.heights.includes(it.height)) st.items.delete(id)
  st.routinePending = st.routinePending.filter(p => st.heights.includes(p.height))
  if (isCurrent(gen)) renderFeed()
  return true
}

/** I comandi del flusso: filtri e «mostrale». Delegati dal main. */
export async function feedClick(t: HTMLElement, gen: number): Promise<void> {
  const chip = t.closest('[data-cat]') as HTMLElement | null
  if (chip) { st.cat = chip.dataset.cat as Category | 'all'; renderFeed(); return }
  if (t.closest('[data-feed-more]')) { st.expanded = true; renderFeed(); return }
  if (t.closest('[data-routine]')) {
    st.showRoutine = !st.showRoutine
    if (st.showRoutine && st.routinePending.length) {
      st.loadingRoutine = true; renderFeed()
      const list = st.routinePending.splice(0)
      await fetchItems(list)
      st.loadingRoutine = false
    }
    if (!st.showRoutine && st.cat === 'routine') st.cat = 'all'
    if (isCurrent(gen)) renderFeed()
  }
}
