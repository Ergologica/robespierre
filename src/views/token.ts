import { api } from '../api/explorer'
import { esc } from './html'
import { formatTokenAmount, groupThousands, shortId } from '../lib/format'
import { hbars } from '../charts'
import type { HBar } from '../charts'

/** Soglie della pagella: dichiarate qui, discutibili via PR come tutto il resto. */
export const SOGLIE = {
  topHolderWarnPct: 60,   // ⚠ se i primi 10 detengono più di questa quota
  maxBoxesForHolders: 3000, // oltre questo numero di box il calcolo live non parte
} as const

/** Controllo omonimi: quanti altri token portano lo stesso nome. Funzione pura sui dati dell'API. */
export function countHomonyms(items: { id: string; name?: string | null }[], name: string, selfId: string): number {
  const n = name.trim().toLowerCase()
  return items.filter(t => (t.name ?? '').trim().toLowerCase() === n && t.id !== selfId).length
}

export async function tokenView(id: string): Promise<string> {
  const t = await api.token(id)
  const name = t.name?.trim() || null
  document.title = `${name ?? shortId(id)} (token) · Robespierre`

  // omonimi: ricerca per nome sull'API — l'unico controllo anti-imitazione possibile senza indice
  let homonyms: number | null = null
  if (name) {
    try {
      const s = await fetch('https://api.ergoplatform.com/api/v1/tokens/search?query=' + encodeURIComponent(name))
      if (s.ok) homonyms = countHomonyms((await s.json()).items ?? [], name, id)
    } catch { /* il controllo resta "non verificabile" */ }
  }

  const checks = [
    homonyms == null
      ? { sig: 'info', text: 'Omonimi: non verificabile in questo momento' }
      : homonyms === 0
        ? { sig: 'ok', text: 'Nessun altro token usa questo nome' }
        : { sig: 'warn', text: `${homonyms} altri token usano questo nome — l'unico identificatore affidabile è l'id` },
    { sig: 'info', text: `Emissione dichiarata al conio: ${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : 'sconosciuta'} · ${t.decimals ?? 0} decimali` },
    t.description
      ? { sig: 'info', text: 'La descrizione è scritta da chi ha coniato il token: non è verificata da nessuno' }
      : { sig: 'info', text: 'Nessuna descrizione dichiarata al conio' },
  ]

  return `
  <div class="card">
    <div class="idrow" style="padding-top:18px">
      <h1>${name ? esc(name) : '<span class="dim">token senza nome</span>'}</h1>
      ${t.type ? `<span class="tag">${esc(t.type)}</span>` : ''}
      <span class="grow"></span>
      <span class="mono dim">${esc(shortId(id, 8))}</span>
      <button class="copy" data-copy="${esc(id)}">copia id</button>
    </div>
    <div class="tiles">
      <div><div class="k">Emissione</div>
        <div class="v">${t.emissionAmount != null ? formatTokenAmount(BigInt(t.emissionAmount), t.decimals ?? 0) : '—'}</div>
        <div class="s">${t.decimals ?? 0} decimali</div></div>
      <div style="grid-column:span 3"><div class="k">Descrizione dichiarata al conio (non verificata)</div>
        <div class="s" style="font-size:14px;margin-top:6px">${t.description ? esc(t.description) : '<span class="dim">nessuna</span>'}</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>Pagella</h2>
      <p>Fatti verificabili, non giudizi. Le soglie sono nel codice, discutibili via pull request.</p></div>
    <div class="card-pad" style="padding-top:4px">
      ${checks.map(c => `<div class="check"><span class="sig ${c.sig}">${c.sig === 'ok' ? '✓' : c.sig === 'warn' ? '⚠' : '·'}</span><span>${esc(c.text)}</span></div>`).join('')}
      <div class="check"><span class="sig info">·</span>
        <span>Concentrazione dei detentori: <button class="copy" data-holders="${esc(id)}">calcola adesso</button>
        <span class="dim">— legge i box non spesi dalla catena; per i token molto diffusi arriverà dal job notturno</span></span></div>
    </div>
    <div class="chart-wrap hidden" data-holders-chart></div>
    <div class="note hidden" data-holders-note></div>
  </div>`
}

/** Concentrazione live: aggrega i box non spesi. Con tetto dichiarato — mai fingere completezza. */
export async function computeHolders(tokenId: string): Promise<void> {
  const chartHost = document.querySelector('[data-holders-chart]') as HTMLElement | null
  const note = document.querySelector('[data-holders-note]') as HTMLElement | null
  const btn = document.querySelector(`[data-holders="${CSS.escape(tokenId)}"]`) as HTMLElement | null
  if (!chartHost || !note) return
  if (btn) btn.textContent = 'calcolo…'
  const base = `https://api.ergoplatform.com/api/v1/boxes/unspent/byTokenId/${tokenId}`
  const first = await (await fetch(base + '?limit=100')).json()
  const total: number = first.total ?? 0
  const capped = total > SOGLIE.maxBoxesForHolders
  const pages = Math.min(Math.ceil(total / 100), Math.ceil(SOGLIE.maxBoxesForHolders / 100))
  const holders = new Map<string, bigint>()
  const addPage = (items: { address: string; assets?: { tokenId: string; amount: number | string }[] }[]) => {
    for (const b of items) {
      const amt = BigInt(b.assets?.find(a => a.tokenId === tokenId)?.amount ?? 0)
      holders.set(b.address, (holders.get(b.address) ?? 0n) + amt)
    }
  }
  addPage(first.items ?? [])
  for (let p = 1; p < pages; p += 5) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(5, pages - p) }, (_, i) =>
        fetch(`${base}?limit=100&offset=${(p + i) * 100}`).then(r => r.json()).catch(() => ({ items: [] }))),
    )
    batch.forEach(pg => addPage(pg.items ?? []))
    if (btn) btn.textContent = `calcolo… ${Math.min(100, Math.round(100 * (p + 5) / pages))}%`
  }
  const totAmt = [...holders.values()].reduce((a, b) => a + b, 0n)
  if (totAmt === 0n) { note.textContent = 'Nessun box non speso trovato.'; note.classList.remove('hidden'); return }
  const sorted = [...holders.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
  const top = sorted.slice(0, 8)
  const pct = (v: bigint) => Number((v * 10000n) / totAmt) / 100
  const bars: HBar[] = top.map(([addr, v]) => ({
    label: shortId(addr, 8), value: pct(v), tipLine: pct(v).toFixed(2).replace('.', ',') + '% del totale nei box letti',
  }))
  const restPct = 100 - top.reduce((s, [, v]) => s + pct(v), 0)
  if (restPct > 0.01) bars.push({ label: `altri ${sorted.length - top.length} detentori`, value: restPct, rest: true, tipLine: restPct.toFixed(2).replace('.', ',') + '%' })
  hbars(chartHost, bars)
  chartHost.classList.remove('hidden')
  note.textContent = capped
    ? `Calcolo parziale: letti ${groupThousands(String(SOGLIE.maxBoxesForHolders))} box su ${groupThousands(String(total))} — le quote sono indicative.`
    : `Calcolato ora su tutti i ${groupThousands(String(total))} box non spesi.`
  note.classList.remove('hidden')
  if (btn) btn.textContent = 'ricalcola'
}
