import { api, ApiError, tokenSearchAnyCase } from '../api/explorer'
import { tokenPrices } from '../lib/prices'
import type { TokenPrice } from '../lib/prices'
import { classifyQuery, groupThousands, shortId } from '../lib/format'
import { fmtPrice } from './markets'
import { esc } from './html'
import { L } from '../i18n'

/**
 * La ricerca a palette (rinnovo «Cronaca»). Prima la ricerca era una barra sotto
 * l'intestazione: scrivevi, premevi invio, e scoprivi dopo cosa aveva capito.
 * Adesso dice SUBITO cosa ha riconosciuto e perché («non è un indirizzo né un id da
 * 64 caratteri: cerco per nome»), e per un id da 64 caratteri chiede alla catena se
 * è una transazione, un token o un blocco invece di provare a caso.
 *
 * Quando più token portano lo stesso nome lo dice, e ordina per volume storico del
 * pool: non decide quale sia «l'originale», ma non mette in cima un conio di ieri.
 */

interface Item { href: string; html: string }
let seq = 0
let items: Item[] = []
let active = 0
let pendingId: Promise<void> | null = null

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

function chip(kind: string, why: string): string {
  return `<div class="pal-kind"><span class="pal-chip">${esc(kind)}</span><span>${esc(why)}</span></div>`
}
function item(href: string, title: string, right: string, sub: string, hint = ''): Item {
  return {
    href,
    html: `<span class="pi-l"><span class="pi-t">${title}</span>${sub ? `<span class="pi-s">${sub}</span>` : ''}</span>
      <span class="pi-r">${right}${hint ? `<span class="pi-h">${hint}</span>` : ''}</span>`,
  }
}

function paint(head: string, sectionTitle: string | null, list: Item[], after = ''): void {
  const body = $('palBody'); if (!body) return
  items = list
  if (active >= list.length) active = 0
  body.innerHTML = head
    + (sectionTitle ? `<div class="pal-sec">${esc(sectionTitle)}</div>` : '')
    + (list.length ? `<div class="pal-list" role="listbox" id="palList">${list.map((it, i) =>
      `<a class="pal-item" role="option" id="pal-o${i}" href="${it.href}" aria-selected="${i === active}" data-pal-i="${i}">${it.html}</a>`).join('')}</div>` : '')
    + after
  const input = $<HTMLInputElement>('searchInput')
  input?.setAttribute('aria-activedescendant', list.length ? `pal-o${active}` : '')
}

function highlight(): void {
  document.querySelectorAll<HTMLElement>('[data-pal-i]').forEach(el => {
    const on = Number(el.dataset.palI) === active
    el.setAttribute('aria-selected', String(on))
    if (on) el.scrollIntoView({ block: 'nearest' })
  })
  $<HTMLInputElement>('searchInput')?.setAttribute('aria-activedescendant', items.length ? `pal-o${active}` : '')
}

/** Il nome di un token, con le sue prove: prezzo e volume del pool, o la loro assenza. */
function tokenItem(t: { id: string; name?: string | null; description?: string | null }, p: TokenPrice | undefined): Item {
  const right = !p ? `<span class="dim">${L.pal_no_price}</span>`
    : p.thin ? `<span class="dim">${L.pal_thin}</span>` : `${fmtPrice(p.ergPerToken)} ERG`
  const facts = [p ? L.pal_pool_vol(groupThousands(String(Math.round(p.volCumErg)))) : L.pal_no_pool]
  const d = t.description?.trim()
  if (d) facts.push(d.length > 60 ? d.slice(0, 60) + '…' : d)
  return item(`#/token/${esc(t.id)}`,
    `<strong>${esc(t.name?.trim() || L.unnamed)}</strong> <span class="mono dim">${esc(shortId(t.id, 6))}</span>`,
    right, esc(facts.join(' · ')), L.pal_open_card + ' ↵')
}

async function byName(q: string, my: number): Promise<void> {
  const head = chip(L.pal_kind_name, L.pal_why_name)
  paint(head + `<div class="pal-wait">${L.pal_checking}</div>`, null, [])
  try {
    // per nome, in tutte le maiuscole: l'API le distingue (vedi tokenSearchAnyCase)
    const [found, prices] = await Promise.all([
      tokenSearchAnyCase(q),
      tokenPrices().catch(() => new Map<string, TokenPrice>()),
    ])
    if (my !== seq) return
    const all = found.items
    const trunc = found.truncated
    const key = q.trim().toLowerCase()
    const exact = all.filter(t => (t.name ?? '').trim().toLowerCase() === key)
    const list = (exact.length ? exact : all)
      .map(t => ({ t, p: prices.get(t.id) }))
      .sort((a, b) => (b.p?.volCumErg ?? -1) - (a.p?.volCumErg ?? -1))
      .slice(0, 8)
    const goto = `<div class="pal-sec">${L.pal_goto}</div>
      <a class="pal-item pal-goto" href="#/mercati/${encodeURIComponent(q)}"><span class="pi-l">${esc(L.pal_goto_markets(q))}</span><span class="pi-r dim">#/mercati</span></a>`
    if (!list.length) { paint(head + `<div class="pal-wait">${L.pal_name_none}</div>`, null, [], goto); return }
    const warn = exact.length > 1 ? `<div class="pal-warn">${L.pal_shared_warn}</div>` : ''
    paint(head, exact.length ? L.pal_tokens_h(exact.length, trunc) : L.pal_tokens_like(all.length, trunc),
      list.map(x => tokenItem(x.t, x.p)), warn + goto)
  } catch {
    if (my === seq) paint(head + `<div class="pal-wait">${L.pal_err}</div>`, null, [])
  }
}

async function byId(q: string, my: number): Promise<void> {
  const head = chip(L.pal_kind_id, L.pal_why_id)
  paint(head + `<div class="pal-wait">${L.pal_checking}</div>`, null, [])
  const [tx, tok, blk] = await Promise.allSettled([api.tx(q), api.token(q), api.blockById(q)])
  if (my !== seq) return
  const found: Item[] = []
  if (tx.status === 'fulfilled') found.push(item(`#/tx/${q}`, `<strong>${L.tx}</strong> <span class="mono dim">${esc(shortId(q))}</span>`, '', '', L.pal_open + ' ↵'))
  if (tok.status === 'fulfilled') {
    const prices = await tokenPrices().catch(() => new Map<string, TokenPrice>())
    found.push(tokenItem(tok.value, prices.get(q)))
  }
  if (blk.status === 'fulfilled') {
    const h = blk.value.block.header.height
    found.push(item(`#/block/${q}`, `<strong>${esc(L.pal_block(groupThousands(String(h))))}</strong>`, '', '', L.pal_open + ' ↵'))
  }
  if (found.length) { paint(head, L.pal_found, found); return }
  // nessuno dei tre: se tutti hanno risposto «non c'è» lo si dice, altrimenti è la fonte
  const all404 = [tx, tok, blk].every(r => r.status === 'rejected' && r.reason instanceof ApiError && (r.reason.notFound || r.reason.status === 400))
  paint(head + `<div class="pal-wait">${all404 ? L.pal_none_id : L.pal_err}</div>`, null, [])
}

function recognize(raw: string): void {
  const q = raw.trim()
  const my = ++seq
  active = 0
  pendingId = null
  if (!q) { paint(`<div class="pal-wait">${L.pal_empty}</div>`, null, []); return }
  const kind = classifyQuery(q)
  if (kind === 'address') {
    const p2pk = q.startsWith('9') && q.length === 51
    paint(chip(p2pk ? L.pal_kind_addr : L.pal_kind_contract, p2pk ? L.pal_why_addr : L.pal_why_contract), null,
      [item(`#/address/${esc(q)}`, `<span class="mono">${esc(shortId(q, 10))}</span>`, '', '', L.pal_addr_go + ' ↵')])
  } else if (kind === 'height') {
    paint(chip(L.pal_kind_height, L.pal_why_height), null,
      [item(`#/block/${q}`, `<strong>${esc(L.pal_block(groupThousands(q)))}</strong>`, '', '', L.pal_height_go + ' ↵')])
  } else if (kind === 'tx-or-token') {
    pendingId = byId(q.toLowerCase(), my)
  } else {
    void byName(q, my)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

export function openPalette(prefill = ''): void {
  const dlg = $<HTMLDialogElement>('palette'); const input = $<HTMLInputElement>('searchInput')
  if (!dlg || !input) return
  if (!dlg.open) dlg.showModal()
  if (prefill) input.value = prefill
  input.focus(); input.select()
  recognize(input.value)
}
export function closePalette(): void {
  const dlg = $<HTMLDialogElement>('palette')
  if (dlg?.open) dlg.close()
}

function go(href: string): void {
  closePalette()
  const input = $<HTMLInputElement>('searchInput'); if (input) input.value = ''
  location.hash = href.startsWith('#') ? href : '#' + href
}

export function initPalette(): void {
  const dlg = $<HTMLDialogElement>('palette'); const input = $<HTMLInputElement>('searchInput')
  if (!dlg || !input) return
  document.getElementById('searchBtn')?.addEventListener('click', () => openPalette())
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => recognize(input.value), 180)
  })
  input.addEventListener('keydown', async e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
      highlight()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (timer) { clearTimeout(timer); timer = null; recognize(input.value) }
      if (pendingId) await pendingId
      const it = items[active]
      if (it) go(it.href)
    }
  })
  // clic sullo sfondo: il <dialog> riceve il clic solo fuori dalla sua scatola
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { closePalette(); return }
    const a = (e.target as HTMLElement).closest('a.pal-item') as HTMLAnchorElement | null
    if (a) { e.preventDefault(); go(a.getAttribute('href') ?? '#/') }
  })
  dlg.addEventListener('mousemove', e => {
    const el = (e.target as HTMLElement).closest('[data-pal-i]') as HTMLElement | null
    if (el && Number(el.dataset.palI) !== active) { active = Number(el.dataset.palI); highlight() }
  })
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? '')
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault(); openPalette()
    }
  })
}
