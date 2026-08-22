import type { Tx } from '../api/types'

/**
 * Il contratto di ogni riconoscitore.
 * Una funzione pura: transazione → descrizione, oppure null se non è il suo caso.
 * REGOLA: nel dubbio si restituisce null. Una decodifica sbagliata è peggio
 * di nessuna decodifica.
 */
export interface Decoded {
  /** identificatore stabile del tipo: 'transfer', 'spectrum-swap', 'sigmausd-mint', … */
  kind: string
  /** la riga in linguaggio piano mostrata in cima alla pagina */
  headline: string
  /** protagonisti, per i link */
  from?: string
  to?: string
  /** quanto è "sicura" la lettura: 'certa' solo per pattern strutturali inequivocabili */
  confidence: 'certa' | 'probabile'
}

export type Recognizer = {
  id: string
  recognize: (tx: Tx) => Decoded | null
}
