import { api } from '../api/explorer'
import { esc } from './html'
import { formatTokenAmount, shortId } from '../lib/format'

export async function tokenView(id: string): Promise<string> {
  const t = await api.token(id)
  const name = t.name?.trim() || null
  document.title = `${name ?? shortId(id)} (token) · Robespierre`
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
  <div class="warnbox">La pagella del token — omonimi, concentrazione dei detentori, liquidità reale — arriva in Fase 3.
    Fino ad allora: chiunque può coniare un token con qualsiasi nome; l'unico identificatore affidabile è l'id.</div>`
}
