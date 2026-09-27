/**
 * LA FONTE DI RISERVA — sigmaspace, solo dove la misura dice che si può.
 *
 * Misura del 27/09/2026 (`scripts/api-compat.mjs`): per questi endpoint sigmaspace risponde con
 * gli STESSI valori dell'API ufficiale, cambiano solo alcune chiavi. Per tutti gli altri
 * (lista blocchi, blocco, saldo di un indirizzo, ricerca ed elenco token) i percorsi non
 * esistono o la forma è diversa: lì niente ripiego, e il sito lo dice invece di inventare.
 *
 * Due trappole trovate misurando, e chiuse qui:
 *   1. una transazione INESISTENTE non dà 404: dà 200 con una transazione finta tutta a zero
 *      (id 000…, altezza 0, timestamp 0). Mostrata così sarebbe un falso.
 *   2. alcuni errori arrivano con stato 200 e l'errore scritto nel corpo ({status, reason}).
 */
export const FALLBACK_BASE = 'https://api.sigmaspace.io/api/v1'

const OK: RegExp[] = [
  /^\/info$/,
  /^\/tokens\/[0-9a-f]{64}$/,
  /^\/transactions\/[0-9a-f]{64}$/,
  /^\/boxes\/[0-9a-f]{64}$/,
  /^\/addresses\/[1-9A-HJ-NP-Za-km-z]+\/transactions\?offset=\d+&limit=\d+$/,
]
export const fallbackAllowed = (path: string) => OK.some(r => r.test(path))

/** Ripiegare solo quando la fonte principale NON ha risposto: rete, 5xx, 429.
 *  Un 404 o un 400 sono risposte, non guasti: la riserva direbbe la stessa cosa. */
export const worthFallingBack = (status: number | null) => status === null || status === 429 || status >= 500

/** Un errore scritto nel corpo di una risposta 200. */
export function errorInBody(body: unknown): { status: number; reason?: string } | null {
  if (body && typeof body === 'object' && 'status' in body && typeof (body as { status: unknown }).status === 'number'
      && !('id' in body) && !('items' in body)) {
    const b = body as { status: number; reason?: string }
    return { status: b.status, reason: b.reason }
  }
  return null
}

/** La transazione finta che sigmaspace restituisce per un id che non esiste. */
export function isPhantomTx(body: unknown): boolean {
  const t = body as { id?: string; inclusionHeight?: number; timestamp?: number } | null
  return !!t && typeof t.id === 'string' && /^0+$/.test(t.id) && !t.inclusionHeight && !t.timestamp
}

/* ---- adattatore: le chiavi che mancano, ricostruite dai dati che ci sono ---- */

const SIGMA_TYPE: Record<string, string> = { '04': 'SInt', '05': 'SLong' }

function vlq(hex: string, i: number): [bigint, number] {
  let n = 0n, shift = 0n, b: number
  do { b = parseInt(hex.slice(i, i + 2), 16); if (Number.isNaN(b)) throw new Error('vlq'); n |= BigInt(b & 0x7f) << shift; shift += 7n; i += 2 } while (b & 0x80)
  return [n, i]
}
/** PURA: serializedValue → renderedValue come lo scrive l'API ufficiale, per i tipi che si
 *  leggono senza ambiguità. Per gli altri non si scrive niente: meglio assente che sbagliato. */
export function renderSerialized(ser: string): { sigmaType: string; renderedValue: string } | null {
  const t = ser.slice(0, 2).toLowerCase()
  try {
    if (t === '04' || t === '05') {
      const [n, end] = vlq(ser, 2)
      if (end !== ser.length) return null
      return { sigmaType: SIGMA_TYPE[t]!, renderedValue: String((n >> 1n) ^ -(n & 1n)) }
    }
    if (t === '10' || t === '11') {                    // Coll[SInt], Coll[SLong]: «[a,b,c]» come l'ufficiale
      let [n, i] = vlq(ser, 2)
      const out: string[] = []
      for (let k = 0n; k < n; k++) { let v: bigint; [v, i] = vlq(ser, i); out.push(String((v >> 1n) ^ -(v & 1n))) }
      return i === ser.length ? { sigmaType: t === '10' ? 'Coll[SInt]' : 'Coll[SLong]', renderedValue: `[${out.join(',')}]` } : null
    }
    if (t === '07') return ser.length === 2 + 66 ? { sigmaType: 'SGroupElement', renderedValue: ser.slice(2) } : null
    if (t === '0e') {
      const [len, start] = vlq(ser, 2)
      return start + Number(len) * 2 === ser.length ? { sigmaType: 'Coll[SByte]', renderedValue: ser.slice(start) } : null
    }
  } catch { return null }
  return null
}

type Regs = Record<string, { serializedValue?: string; renderedValue?: string; sigmaType?: string } | string>
function adaptBox<T extends { additionalRegisters?: Regs }>(b: T): T {
  const regs = b.additionalRegisters
  if (regs) for (const [k, v] of Object.entries(regs)) {
    if (typeof v === 'object' && v.serializedValue && v.renderedValue == null) {
      const r = renderSerialized(v.serializedValue)
      if (r) regs[k] = { ...v, ...r }
    }
  }
  return b
}

/** PURA: il corpo di sigmaspace portato alla forma che il sito si aspetta. Le transazioni
 *  sono segnate: i loro output NON hanno `spentTransactionId`, e la pagina deve dire che
 *  lo stato speso/non speso non è noto, non che è «non speso». */
export function adaptFallback<T>(path: string, body: T): T {
  const b = body as Record<string, unknown>
  delete b.$schema
  const tx = (t: Record<string, unknown>) => {
    for (const side of ['inputs', 'outputs', 'dataInputs'] as const)
      for (const box of (t[side] as { additionalRegisters?: Regs }[] | undefined) ?? []) adaptBox(box)
    t.spentUnknown = true
    return t
  }
  if (/^\/transactions\//.test(path)) tx(b)
  else if (/^\/addresses\//.test(path)) for (const t of (b.items as Record<string, unknown>[] | undefined) ?? []) tx(t)
  else if (/^\/boxes\//.test(path)) adaptBox(b as { additionalRegisters?: Regs })
  return body
}
