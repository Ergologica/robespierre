import type { Tx } from '../api/types'
import type { Decoded, Recognizer } from './types'
import { simpleTransfer } from './recognizers/simple-transfer'
import { sigmaUsd } from './recognizers/sigmausd'
import { spectrumN2T } from './recognizers/spectrum-n2t'
import { rosenBridge } from './recognizers/rosen-bridge'
import { mining } from './recognizers/mining'
import { oracle } from './recognizers/oracle'

/**
 * Il motore: prova i riconoscitori in ordine, si ferma al primo che risponde.
 * L'ordine conta: dal più specifico al più generico.
 * Per aggiungere un protocollo: un file in recognizers/, almeno 3 fixture
 * (caso tipico, caso limite, caso che NON deve riconoscere), una riga qui.
 */
const RECOGNIZERS: Recognizer[] = [
  sigmaUsd,          // Bank NFT nel box: il più specifico
  oracle,            // NFT e gettoni dei pool oracolo (v1 e v2)
  mining,            // NFT dell'emissione e della ri-emissione, forma del contratto delle ricompense
  spectrumN2T,       // contratto condiviso dei pool N2T
  rosenBridge,       // hot wallet etichettato
  simpleTransfer,    // sempre ultimo: è il caso generico
]

export function decode(tx: Tx): Decoded | null {
  for (const r of RECOGNIZERS) {
    const d = r.recognize(tx)
    if (d) return d
  }
  return null
}
