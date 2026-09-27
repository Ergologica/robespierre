import { esc } from './html'
import { icons } from '../icons'
import { L } from '../i18n'
import { ApiError } from '../api/explorer'

/**
 * La pagina d'errore deve rispettare la stessa legge del decodificatore: tace
 * piuttosto che indovinare. Prima diceva sempre «la fonte potrebbe essere
 * momentaneamente giù», anche per un hash che semplicemente non esiste — una
 * spiegazione sbagliata data con sicurezza, cioè il difetto che questo progetto
 * dice di non commettere.
 *
 * Tre casi distinti, ognuno con la sua risposta e col suo bottone:
 *   404            → non c'è (e riprovare non serve: niente bottone Riprova)
 *   400 checksum   → l'id è scritto male (lo dice la catena, non lo deduco io)
 *   tutto il resto → la fonte non risponde, e qui Riprova ha senso
 */
export function errorBox(e: unknown, head: string, query: string): string {
  const id = `<p class="muted mono">${esc(query)}</p>`
  if (e instanceof ApiError && e.notFound) {
    const cosa = head === 'tx' ? L.gone_tx : head === 'token' ? L.gone_token
      : head === 'block' ? L.gone_block : L.gone_any
    return `<div class="errorbox"><h2>${L.gone_title}</h2>
      <p>${esc(cosa)}</p>${id}
      <p class="dim">${esc(L.gone_hint)}</p></div>`
  }
  if (e instanceof ApiError && e.malformed) {
    return `<div class="errorbox"><h2>${esc(L.bad_title)}</h2>
      <p>${esc(L.bad_addr)}</p>${id}
      <p class="dim">${esc(L.bad_hint)}</p></div>`
  }
  return `<div class="errorbox"><h2>${L.err_title}</h2>
    <p class="muted">${esc(e instanceof Error ? e.message : String(e))}</p>
    <p class="dim">${L.err_hint}</p>
    <p><button class="btn" data-retry type="button">${icons.net}${L.retry}</button></p></div>`
}
