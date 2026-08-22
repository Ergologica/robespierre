/** Escape obbligatorio per ogni stringa che arriva dalla catena
 *  (nomi token, descrizioni, indirizzi): mai innerHTML su dati grezzi. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

import labelsRaw from '../labels.json'
const labels = labelsRaw as Record<string, { name?: string; category?: string } | string>

export function labelOf(address: string): string | null {
  const l = labels[address]
  if (!l || typeof l === 'string') return null
  return l.name ?? null
}

import { shortId } from '../lib/format'
/** Un indirizzo si mostra sempre così: etichetta se nota, altrimenti troncato; link alla sua pagina. */
export function addrLink(address: string): string {
  const name = labelOf(address)
  const text = name ? `<strong>${esc(name)}</strong>` : `<span class="mono">${esc(shortId(address, 10))}</span>`
  return `<a href="#/address/${esc(address)}" title="${esc(address)}">${text}</a>`
}
