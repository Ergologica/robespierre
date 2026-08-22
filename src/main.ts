import './style.css'
import { netView } from './views/net'
import { txView } from './views/tx'
import { addressView } from './views/address'
import { tokenView } from './views/token'
import { api } from './api/explorer'
import { classifyQuery } from './lib/format'
import { esc } from './views/html'

const app = document.getElementById('app') as HTMLElement

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
  const hash = location.hash.replace(/^#\/?/, '')
  const [head, a, b] = hash.split('/')
  app.innerHTML = '<div class="loading">carico dalla catena…</div>'
  try {
    if (!head) { document.title = 'Robespierre — l\'explorer che interpreta'; app.innerHTML = await netView() }
    else if (head === 'tx' && a) app.innerHTML = await txView(a)
    else if (head === 'address' && a) app.innerHTML = await addressView(a, b ? parseInt(b, 10) || 0 : 0)
    else if (head === 'token' && a) app.innerHTML = await tokenView(a)
    else app.innerHTML = `<div class="errorbox"><h2>Pagina non trovata</h2>
      <p class="muted">Il percorso <span class="mono">${esc(hash)}</span> non esiste. La ricerca qui sopra riconosce da sola indirizzi, transazioni e token.</p></div>`
  } catch (e) {
    app.innerHTML = `<div class="errorbox"><h2>Non sono riuscito a caricare</h2>
      <p class="muted">${esc(e instanceof Error ? e.message : String(e))}</p>
      <p class="dim">La fonte potrebbe essere momentaneamente giù: i dati restano sulla catena, riprova tra poco.</p></div>`
  }
  applyMode()
}
window.addEventListener('hashchange', route)

/* ----- ricerca: riconoscimento del tipo, tendina solo come ripiego ----- */
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
    alert('La pagina del blocco per altezza arriva nella prossima iterazione.')
  } else {
    alert('Non sembra un indirizzo (inizia con 9, ~51 caratteri), né un id di transazione o token (64 caratteri esadecimali).')
  }
  input.value = ''
})
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus() }
})

/* ----- pulsanti copia e paginazione (deleghe globali) ----- */
document.addEventListener('click', e => {
  const t = e.target as HTMLElement
  const copy = t.closest('[data-copy]') as HTMLElement | null
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy ?? ''); copy.textContent = 'copiato ✓'; setTimeout(() => (copy.textContent = 'copia'), 1200) }
  const nav = t.closest('[data-nav]') as HTMLElement | null
  if (nav && !nav.hasAttribute('disabled')) location.hash = nav.dataset.nav ?? '#/'
})

route()
