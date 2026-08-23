import './style.css'
import { icons } from './icons'
import { netView, mountNetCharts } from './views/net'
import { networkStats } from './api/explorer'
import { txView, mountTxSchema } from './views/tx'
import { addressView, mountWalletChart, mountRentCheck } from './views/address'
import { tokenView, computeHolders, mountHoldersIfCached, mountPrecomputedHolders } from './views/token'
import { marketsView } from './views/markets'
import { tokensDirView } from './views/tokens-dir'
import { exportAddressCsv } from './views/address'
import { protocolsView, mountProtocolCharts } from './views/protocols'
import { blockView } from './views/block'
import { api } from './api/explorer'
import { classifyQuery, shortId } from './lib/format'
import { esc } from './views/html'
import { L, initLang, setLang, getLang } from './i18n'
import { newNav, isCurrent, currentNav } from './lib/nav'

const app = document.getElementById('app') as HTMLElement

/* ----- lingua: inizializzata PRIMA di ogni render ----- */
initLang()

/* icone statiche dichiarate con data-ic */
document.querySelectorAll<HTMLElement>('[data-ic]').forEach(e => {
  const ic = icons[e.dataset.ic as keyof typeof icons]
  if (ic) e.insertAdjacentHTML('afterbegin', ic)
})

/** Testi statici di header/footer/ricerca: elementi marcati con data-t. */
function applyLang(): void {
  document.querySelectorAll<HTMLElement>('[data-t]').forEach(e => {
    const v = L[e.dataset.t as keyof typeof L]
    if (typeof v === 'string') e.textContent = v
  })
  const input = document.getElementById('searchInput') as HTMLInputElement | null
  if (input) input.placeholder = L.search_ph
  const btn = document.getElementById('langBtn')
  if (btn) btn.textContent = getLang() === 'it' ? 'EN' : 'IT'
}
applyLang()

document.getElementById('langBtn')!.addEventListener('click', () => {
  setLang(getLang() === 'it' ? 'en' : 'it')
  applyLang()
  void route() // la pagina corrente si ridisegna nella nuova lingua
})

/* ----- modalità Base/Avanzato: ricordata, riflessa nel DOM ----- */
let advanced = false
try { advanced = localStorage.getItem('robespierre.mode') === 'advanced' } catch {}
function applyMode() {
  document.getElementById('modeBase')!.setAttribute('aria-pressed', String(!advanced))
  document.getElementById('modeAdv')!.setAttribute('aria-pressed', String(advanced))
  document.querySelectorAll<HTMLDetailsElement>('details.adv-open').forEach(d => { d.open = advanced })
  try { localStorage.setItem('robespierre.mode', advanced ? 'advanced' : 'base') } catch {}
}
document.getElementById('modeBase')!.addEventListener('click', () => { advanced = false; applyMode() })
document.getElementById('modeAdv')!.addEventListener('click', () => { advanced = true; applyMode() })

/* ----- tema ----- */
let theme = 'dark'
try { theme = localStorage.getItem('robespierre.theme') ?? 'dark' } catch {}
document.documentElement.setAttribute('data-theme', theme)
document.getElementById('themeBtn')!.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('robespierre.theme', theme) } catch {}
})

/* ----- router hash: URL condivisibili senza configurazione server ----- */
async function route() {
  const gen = newNav()                       // questa navigazione ha un numero…
  const show = (html: string) => {           // …e nessuno scrive se non è più la sua
    if (isCurrent(gen)) app.innerHTML = html
    return isCurrent(gen)
  }
  const hash = location.hash.replace(/^#\/?/, '')
  const [head, a, b] = hash.split('/')
  show(`<div class="loading">${L.loading}</div>`)
  try {
    if (!head) {
      document.title = 'Robespierre — ' + L.tagline
      if (!show(await netView())) return
      const st = await networkStats()
      if (st && isCurrent(gen)) mountNetCharts(BigInt(Math.round(st.supply)))
    }
    else if (head === 'tx' && a) {
      if (!show(await txView(a))) return
      const tx = await api.tx(a)             // già in cache: nessuna seconda chiamata
      if (isCurrent(gen)) mountTxSchema(tx)
    }
    else if (head === 'address' && a) {
      if (!show(await addressView(a, b ? parseInt(b, 10) || 0 : 0))) return
      mountWalletChart()
      void mountRentCheck(a, gen)
    }
    else if (head === 'token' && a) {
      if (!show(await tokenView(a))) return
      if (!mountHoldersIfCached(a)) void mountPrecomputedHolders(a, gen)
    }
    else if (head === 'mercati') { if (!show(await marketsView())) return }
    else if (head === 'tokens') { if (!show(await tokensDirView(a ? parseInt(a, 10) || 0 : 0))) return }
    else if (head === 'block' && a) { if (!show(await blockView(a))) return }
    else if (head === 'protocolli') { if (!show(await protocolsView())) return; mountProtocolCharts() }
    else show(`<div class="errorbox"><h2>${L.notfound_title}</h2>
      <p class="muted"><span class="mono">${esc(hash)}</span></p></div>`)
  } catch (e) {
    if (!isCurrent(gen)) return              // errore di una pagina abbandonata: non disturba
    app.innerHTML = `<div class="errorbox"><h2>${L.err_title}</h2>
      <p class="muted">${esc(e instanceof Error ? e.message : String(e))}</p>
      <p class="dim">${L.err_hint}</p>
      <p><button class="btn" data-retry type="button">${icons.net}${L.retry}</button></p></div>`
  }
  if (isCurrent(gen)) { applyMode(); markCurrentNav(head ?? "") }
}

/** La voce di navigazione della sezione aperta si distingue: prima nulla diceva
 *  in che parte del sito ci si trovasse. */
function markCurrentNav(head: string): void {
  const target = head === '' ? '#/' : head === 'mercati' ? '#/mercati'
    : head === 'tokens' ? '#/tokens' : head === 'protocolli' ? '#/protocolli' : null
  document.querySelectorAll<HTMLAnchorElement>('.topnav a').forEach(a => {
    if (target && a.getAttribute('href') === target) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
}
window.addEventListener('hashchange', () => { searchHint(null); void route() })

/* ----- ricerca: riconoscimento del tipo; per il resto, ricerca token per nome ----- */
function searchHint(msg: string | null, html = false): void {
  let h = document.getElementById('searchHint')
  if (!h) {
    h = document.createElement('div')
    h.id = 'searchHint'
    h.className = 'search-hint'
    document.querySelector('.searchrow')!.appendChild(h)
  }
  if (html && msg) h.innerHTML = msg
  else h.textContent = msg ?? ''
  h.classList.toggle('hidden', !msg)
}

/** A2: chi scrive "COMET" non sta sbagliando — sta cercando un token per nome. */
async function searchByName(q: string): Promise<void> {
  try {
    const res = await api.tokenSearch(q)
    const items = (res.items ?? []).slice(0, 8)
    if (!items.length) { searchHint(L.search_name_hint + L.search_bad); return }
    const list = items.map(t =>
      `<a class="sr" href="#/token/${esc(t.id)}"><strong>${esc(t.name?.trim() || L.unnamed)}</strong>
       <span class="mono dim">${esc(shortId(t.id, 8))}</span></a>`).join('')
    searchHint(`<div class="sr-head">${esc(L.search_results)}</div>${list}`, true)
  } catch {
    searchHint(L.search_bad)
  }
}

const form = document.getElementById('searchForm') as HTMLFormElement
const input = document.getElementById('searchInput') as HTMLInputElement
form.addEventListener('submit', async ev => {
  ev.preventDefault()
  const q = input.value.trim()
  if (!q) return
  const kind = classifyQuery(q)
  if (kind === 'address') location.hash = '#/address/' + q
  else if (kind === 'tx-or-token') {
    // prova come transazione; se non esiste, come token
    try { await api.tx(q); location.hash = '#/tx/' + q }
    catch { location.hash = '#/token/' + q }
  } else if (kind === 'height') {
    location.hash = '#/block/' + q
  } else {
    await searchByName(q)
    return
  }
  searchHint(null)
  input.value = ''
})
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus() }
  if (e.key === 'Escape') searchHint(null)
})

/* ----- deleghe globali: copia, holders, filtri, immagini, retry ----- */
document.addEventListener('click', e => {
  const t = e.target as HTMLElement
  const copy = t.closest('[data-copy]') as HTMLElement | null
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy ?? '')
    const prev = copy.textContent
    copy.textContent = L.copied
    setTimeout(() => (copy.textContent = prev), 1200)
  }
  const hold = t.closest('[data-holders]') as HTMLElement | null
  if (hold) void computeHolders(hold.dataset.holders ?? '', currentNav())
  const retry = t.closest('[data-retry]') as HTMLElement | null
  if (retry) void route()
  const exp = t.closest('[data-export]') as HTMLElement | null
  if (exp) void exportAddressCsv(exp.dataset.export ?? '')
  const img = t.closest('[data-img]') as HTMLElement | null
  if (img) {
    // contenuto di terzi: caricato SOLO adesso, su richiesta esplicita
    const url = img.dataset.img ?? ''
    const slot = document.querySelector('[data-img-slot]') as HTMLElement | null
    if (slot && url.startsWith('https://')) {
      const el = document.createElement('img')
      el.src = url
      el.alt = ''
      el.loading = 'lazy'
      el.referrerPolicy = 'no-referrer'
      el.style.cssText = 'max-width:min(420px,100%);border-radius:10px;display:block'
      el.onerror = () => { slot.innerHTML = `<span class="dim">${L.img_fail}</span>` }
      slot.replaceChildren(el)
    }
  }
  const mov = t.closest('[data-mov]') as HTMLElement | null
  if (mov) {
    const dir = mov.dataset.mov ?? 'all'
    document.querySelectorAll<HTMLElement>('[data-mov]').forEach(c => c.setAttribute('aria-pressed', String(c === mov)))
    document.querySelectorAll<HTMLElement>('tr[data-dir]').forEach(r =>
      r.classList.toggle('hidden', dir !== 'all' && r.dataset.dir !== dir))
  }
  const tog = t.closest('[data-toggle-tokens]') as HTMLElement | null
  if (tog) {
    const rows = document.querySelectorAll('.tok-extra')
    const first = rows[0]
    const opening = !!first && first.classList.contains('hidden')
    rows.forEach(r => r.classList.toggle('hidden', !opening))
    const label = tog.querySelector('span[data-label]') as HTMLElement | null
    if (label) label.textContent = opening ? L.collapse : (tog.dataset.full ?? '')
  }
  const sc = t.closest('[data-scroll]') as HTMLElement | null
  if (sc) { e.preventDefault(); document.querySelector(sc.getAttribute('href') ?? '')?.scrollIntoView({ behavior: 'smooth' }) }
  const nav = t.closest('[data-nav]') as HTMLElement | null
  if (nav && !nav.hasAttribute('disabled')) location.hash = nav.dataset.nav ?? '#/'
})

route()
