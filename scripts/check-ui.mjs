/**
 * Verifica di impaginazione: nessun testo dei grafici deve uscire dal proprio
 * riquadro e nessuna pagina deve scorrere di lato. Nasce da un difetto vero:
 * «61,6%» usciva dalla ciambella e si leggeva «1,6%» — un numero sbagliato.
 *
 *   npm run build && node scripts/check-ui.mjs
 *
 * Serve rete (legge dati veri dalla mainnet) e il Chromium di Playwright.
 */
// Playwright non è una dipendenza del progetto: serve solo a questo controllo,
// e non deve pesare sulla Action che pubblica il sito.
//   npm i -D playwright && npx playwright install chromium
let chromium
try { ({ chromium } = await import('playwright')) }
catch {
  console.error('Manca Playwright. Installalo solo per questo controllo:\n  npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.svg':'image/svg+xml' }
const srv = createServer((req, res) => {
  let p = normalize(join('dist', decodeURIComponent(req.url.split('?')[0])))
  if (!existsSync(p) || p.endsWith('/')) p = 'dist/index.html'
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p))
}).listen(4174)
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const page = await b.newPage({ viewport: { width: 1180, height: 1200 } })
// un wallet finto che possiede una chiave di staking Paideia reale: serve a
// disegnare la scheda «In staking» senza usare l'indirizzo di nessuno
const FINTO = '9fRusAarL1KkrWQVsxSRVYnvWzceTdA7N4YkQPX9EJvbAvzcCzR'
// due chiavi vere di due DAO diversi: la scheda deve reggere più posizioni
const CHIAVE = 'db56504be9f1e78ae989088b7afba3fdb1f86901bfaec62eb0a3d092d60a9a8d'
const CHIAVE2 = '895ca7298ca635899ef9e1f871047eba15696557ad3ffe8a9ec678165f8bcb27'
for (const h of ['api.ergoplatform.com', 'api.spectrum.fi', 'api.coingecko.com', 'raw.githubusercontent.com'])
  await page.route(`**://${h}/**`, async r => {
    const url = r.request().url()
    if (url.includes(`/addresses/${FINTO}/balance/confirmed`))
      return r.fulfill({ json: { nanoErgs: 41_230_000_000, tokens: [
        { tokenId: CHIAVE, amount: 1, decimals: 0, name: 'Autolykos Membership' },
        { tokenId: CHIAVE2, amount: 1, decimals: 0, name: 'Walrus DAO Membership' },
        { tokenId: '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b', amount: 12_000_000, decimals: 0, name: 'COMET' },
      ] } })
    if (url.includes(`/addresses/${FINTO}/transactions`)) return r.fulfill({ json: { items: [], total: 0 } })
    try { const q = await fetch(url); return r.fulfill({ status: q.status, body: await q.text(), contentType: 'application/json' }) }
    catch { return r.fulfill({ status: 500, body: '{}' , contentType: 'application/json'}) }
  })
const PAGINE = ['#/', '#/mercati', '#/protocolli',
  '#/token/0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b',
  '#/address/9gD9khJaxi3SvcX9VVPQ3vnV3xUTonVQe3Fvg5X7cGGbXMRgd8i',   // Coinex: pubblico, in labels.json — ha ERG e token, quindi disegna la ciambella
  '#/address/' + FINTO]   // il wallet finto: qui compare la scheda «In staking»
let guai = 0
for (const w of [1180, 390]) {
  await page.setViewportSize({ width: w, height: 1200 })
  for (const t of ['dark', 'light']) {
    for (const u of PAGINE) {
      await page.goto('http://localhost:4174/' + u, { waitUntil: 'networkidle' })
      await page.evaluate(th => document.documentElement.dataset.theme = th, t)
      await page.waitForTimeout(1500)
      const bad = await page.evaluate(() => {
        const out = []
        for (const s of document.querySelectorAll('svg')) {
          const vb = s.viewBox.baseVal; if (!vb.width) continue
          for (const el of s.querySelectorAll('text')) {
            const x = el.getBBox()
            if (x.x < -0.5 || x.x + x.width > vb.width + 0.5)
              out.push(`«${el.textContent}» ${x.x.toFixed(0)}..${(x.x + x.width).toFixed(0)} / ${vb.width}`)
          }
        }
        return out
      })
      if (u.endsWith(FINTO)) {
        await page.waitForSelector('#staking', { timeout: 30000 }).catch(() => { guai++; console.log(`✗ ${w}px ${t}: la scheda «In staking» non è comparsa`) })
      }
      if (process.env.SHOTS) {
        mkdirSync('.shots', { recursive: true })
        await page.screenshot({ path: `.shots/${w}-${t}-${u.replace(/[^a-z]/gi, '') || 'home'}.png`, fullPage: true })
      }
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (bad.length || scroll > 0) { guai++; console.log(`✗ ${w}px ${t} ${u}`, bad, 'scroll', scroll) }
    }
  }
}
console.log(guai ? `${guai} pagine con problemi` : '✓ nessun testo fuori riquadro, nessuno scroll orizzontale')
await b.close(); srv.close()
process.exitCode = guai ? 1 : 0
