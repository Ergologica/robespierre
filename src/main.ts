import './style.css'
import { icons } from './icons'
import { errorBox } from './views/errorbox'
import { homeData, infraShare, stateCard, blocksList } from './views/net'
import { networkStats, mempoolCount } from './api/explorer'
import { txView, mountTxSchema, selectTxTab, TX_TABS } from './views/tx'
import type { TxTab } from './views/tx'
import { startFeed, advanceFeed, feedClick } from './views/feed'
import { mempoolView } from './views/mempool'
import { initPalette } from './views/palette'
import { shortAgo } from './lib/feed'
import { addressView, mountWalletChart, mountRentCheck } from './views/address'
import { mountStakes } from './stake/card'
import { tokenView, computeHolders, mountHoldersIfCached, mountPrecomputedHolders } from './views/token'
import { marketsView, mountMarkets } from './views/markets'
import { tokensDirView } from './views/tokens-dir'
import { exportAddressCsv } from './views/address'
import { protocolsView, mountProtocolCharts } from './views/protocols'
import { blockView } from './views/block'
import { api } from './api/explorer'
import { relativeTime, groupThousands } from './lib/format'
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
  document.getElementById('searchBtn')?.setAttribute('aria-label', L.search_open)
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
/** Base apre la transazione sul Racconto, Avanzato sui Box: è quello che prima faceva
 *  il riquadro «Dettaglio dei box», aperto o chiuso secondo la modalità. Un tab scelto
 *  a mano (nell'URL) vince sulla modalità. */
const defaultTab = (): TxTab => (advanced ? 'box' : 'story')
function modeClick(adv: boolean): void {
  advanced = adv; applyMode()
  const [head, id, tab] = location.hash.replace(/^#\/?/, '').split('/')
  if (head === 'tx' && id && !tab) selectTxTab(defaultTab(), currentTx)
}
document.getElementById('modeBase')!.addEventListener('click', () => modeClick(false))
document.getElementById('modeAdv')!.addEventListener('click', () => modeClick(true))

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
let currentTx: import('./api/types').Tx | null = null
let homeGen = -1
async function route() {
  const gen = newNav()                       // questa navigazione ha un numero…
  const show = (html: string) => {           // …e nessuno scrive se non è più la sua
    if (isCurrent(gen)) app.innerHTML = html
    return isCurrent(gen)
  }
  const hash = location.hash.replace(/^#\/?/, '')
  const [head, a, b] = hash.split('/')
  currentTx = null
  show(`<div class="loading">${L.loading}</div>`)
  try {
    if (!head) {
      document.title = 'Robespierre — ' + L.tagline
      const d = await homeData()
      if (!show(d.html)) return
      homeGen = gen
      void startFeed(gen, d.headers, infraShare(d.cov))
    }
    else if (head === 'tx' && a) {
      const tab: TxTab = (TX_TABS as readonly string[]).includes(b ?? '') ? b as TxTab : defaultTab()
      if (!show(await txView(a, tab))) return
      currentTx = await api.tx(a)            // già in cache: nessuna seconda chiamata
      if (isCurrent(gen) && tab === 'schema') mountTxSchema(currentTx)
    }
    else if (head === 'address' && a) {
      if (!show(await addressView(a, b ? parseInt(b, 10) || 0 : 0))) return
      mountWalletChart()
      void mountRentCheck(a, gen)
      void mountStakes(a, gen)
    }
    else if (head === 'token' && a) {
      if (!show(await tokenView(a))) return
      if (!mountHoldersIfCached(a)) void mountPrecomputedHolders(a, gen)
    }
    else if (head === 'mercati') {
      let q = ''
      try { q = a ? decodeURIComponent(a) : '' } catch { q = a ?? '' }
      if (!show(await marketsView(q))) return
      mountMarkets()
    }
    else if (head === 'mempool') { if (!show(await mempoolView())) return }
    else if (head === 'tokens') { if (!show(await tokensDirView(a ? parseInt(a, 10) || 0 : 0))) return }
    else if (head === 'block' && a) { if (!show(await blockView(a))) return }
    else if (head === 'protocolli') { if (!show(await protocolsView())) return; mountProtocolCharts() }
    else show(`<div class="errorbox"><h2>${L.notfound_title}</h2>
      <p class="muted"><span class="mono">${esc(hash)}</span></p></div>`)
  } catch (e) {
    if (!isCurrent(gen)) return              // errore di una pagina abbandonata: non disturba
    app.innerHTML = errorBox(e, head ?? '', hash)
  }
  if (isCurrent(gen)) { applyMode(); markCurrentNav(head ?? '') }
}

/* ----- la home si aggiorna a ogni blocco: una richiesta ogni 30 s, solo se la
   pagina è quella e la scheda è visibile. Nessun aggiornamento a vuoto. ----- */
setInterval(async () => {
  if (!isCurrent(homeGen) || document.visibilityState !== 'visible') return
  const gen = homeGen
  try {
    const [blocks, stats, memp] = await Promise.all([api.blocks(16), networkStats(), mempoolCount()])
    if (!isCurrent(gen)) return
    const h = blocks.items[0]?.height
    const liveH = document.querySelector('[data-live-h]')
    if (h && liveH && liveH.textContent !== groupThousands(String(h))) {
      liveH.textContent = groupThousands(String(h))
      const card = document.querySelector('[data-state]')
      if (card) card.outerHTML = stateCard(h, blocks.items, stats, memp)
      const list = document.querySelector('[data-blocks]')
      if (list) list.innerHTML = blocksList(blocks.items)
      const ago = document.querySelector('.live [data-ago]') as HTMLElement | null
      if (ago && blocks.items[0]) ago.dataset.ago = String(blocks.items[0].timestamp)
      await advanceFeed(gen, blocks.items)
    }
  } catch { /* al prossimo giro: un aggiornamento mancato non è un errore da mostrare */ }
}, 30_000)

/* ----- tempi relativi che restano veri: «38 s fa» non resta 38 s per sempre ----- */
function tick(): void {
  document.querySelectorAll<HTMLElement>('[data-ago]').forEach(e => { e.textContent = relativeTime(Number(e.dataset.ago)) })
  document.querySelectorAll<HTMLElement>('[data-ago-short]').forEach(e => { e.textContent = shortAgo(Number(e.dataset.agoShort)) })
}
setInterval(tick, 15_000)

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
window.addEventListener('hashchange', () => { void route() })

/* ----- ricerca: la palette (views/palette.ts) ----- */
initPalette()

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
  const tab = t.closest('[data-tab]') as HTMLElement | null
  if (tab) chooseTab(tab.dataset.tab as TxTab)
  if (t.closest('[data-cat],[data-routine],[data-feed-more]')) void feedClick(t, homeGen)
})

/** Un tab scelto a mano finisce nell'URL (senza ricaricare): il link condiviso apre
 *  lo stesso livello. Il Racconto è l'indirizzo canonico, senza suffisso. */
function chooseTab(tab: TxTab): void {
  selectTxTab(tab, currentTx)
  const [, id] = location.hash.replace(/^#\/?/, '').split('/')
  if (id) history.replaceState(null, '', `#/tx/${id}${tab === defaultTab() ? '' : '/' + tab}`)
}
/* tastiera nei tab: frecce destra/sinistra, come si aspetta chi usa uno screen reader */
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement
  if (!t.matches?.('[role="tab"]') || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
  const i = TX_TABS.indexOf(t.dataset.tab as TxTab)
  const next = TX_TABS[(i + (e.key === 'ArrowRight' ? 1 : TX_TABS.length - 1)) % TX_TABS.length]!
  chooseTab(next)
  ;(document.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus()
  e.preventDefault()
})

route()
