import { L } from '../i18n'

/**
 * «Come lo sappiamo» — per ogni riconoscitore, la frase che dice su cosa si regge
 * la lettura e su quante transazioni reali è stato verificato.
 *
 * Il numero di fixture NON si scrive a occhio: `explain.test.ts` decodifica ogni
 * file di `fixtures/` e confronta il conteggio per riconoscitore con questa tabella.
 * Se qualcuno aggiunge una fixture e non aggiorna il numero, il test fallisce: la
 * pagina non deve promettere più verifiche di quante ne esistano. (La proposta
 * grafica diceva «verificato su 3 transazioni reali» per Rosen: le fixture di Rosen
 * sono 1. Qui si scrive 1.)
 */
export const FIXTURES: Record<string, number> = {
  'sigmausd': 2,
  'oracle': 7,
  'mining': 5,
  'spectrum-n2t': 3,
  'rosen-bridge': 1,
  'fee-only': 4,
  'simple-transfer': 9,
}

/** Il sorgente del riconoscitore, per chi vuole leggere la regola e non fidarsi. */
export const SOURCE_BASE = 'https://github.com/Ergologica/robespierre/blob/main/src/decoder/recognizers/'

/** La frase che spiega su cosa si regge la lettura di questo riconoscitore. */
export function explain(recognizer: string, kind: string): string {
  switch (recognizer) {
    case 'sigmausd': return L.rec_sigmausd
    case 'oracle': return L.rec_oracle
    case 'mining': return L.rec_mining
    case 'spectrum-n2t': return L.rec_spectrum
    case 'rosen-bridge': return kind === 'rosen-out' ? L.rec_rosen_out : L.rec_rosen
    case 'fee-only': return L.rec_fee
    case 'simple-transfer': return L.rec_transfer
    default: return ''
  }
}

/** Il file sorgente di un riconoscitore (gli id coincidono coi nomi dei file). */
export function sourceUrl(recognizer: string): string {
  return SOURCE_BASE + recognizer + '.ts'
}
