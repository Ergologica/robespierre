import type { BoxLike, RegValue } from '../api/types'

/**
 * Un registro Long di un box, come BigInt — o null se non c'è o non è un Long.
 *
 * L'API ufficiale dà `renderedValue` (il numero già scritto); sigmaspace no, dà solo
 * `serializedValue` (il byte di tipo 0x05 = Long, poi il valore in VLQ zig-zag). Si legge
 * il primo che c'è, così lo stesso riconoscitore funziona con tutte e due le fonti.
 * Qualunque cosa non torni esattamente — tipo diverso, byte avanzati, testo non numerico —
 * dà null: un prezzo letto male è peggio di un prezzo taciuto.
 */
export function longReg(box: BoxLike | undefined, reg: 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9'): bigint | null {
  const v = (box?.additionalRegisters as Record<string, RegValue> | undefined)?.[reg]
  if (v == null) return null
  if (typeof v === 'object') {
    if (v.sigmaType && v.sigmaType !== 'SLong') return null
    if (v.renderedValue != null && /^-?\d+$/.test(v.renderedValue)) return BigInt(v.renderedValue)
    return v.serializedValue ? decodeLong(v.serializedValue) : null
  }
  return decodeLong(v)
}

/** PURA: "05" + VLQ zig-zag → BigInt. Esportata per i test. */
export function decodeLong(hex: string): bigint | null {
  if (!/^05([0-9a-f]{2})+$/i.test(hex)) return null
  const bytes = hex.slice(2).match(/../g)!.map(h => parseInt(h, 16))
  let n = 0n, shift = 0n, i = 0
  for (; i < bytes.length; i++) {
    n |= BigInt(bytes[i]! & 0x7f) << shift
    shift += 7n
    if (!(bytes[i]! & 0x80)) break
  }
  if (i !== bytes.length - 1) return null           // byte avanzati o VLQ troncato
  return (n >> 1n) ^ -(n & 1n)                       // zig-zag
}
