/**
 * Un solo punto di conversione per numeri, importi e identificatori.
 * REGOLA: gli importi grezzi restano BigInt fino al momento della stampa.
 * `Number` perde precisione sopra 2^53: alcuni importi di token la superano.
 */

const NANO = 1_000_000_000n

/** nanoERG (BigInt o stringa) → stringa "1.234,5678 ERG" in it-IT, senza passare da Number sull'intero. */
export function formatErg(nano: bigint | string | number, maxDecimals = 4): string {
  const n = typeof nano === 'bigint' ? nano : BigInt(nano)
  const sign = n < 0n ? '-' : ''
  const abs = n < 0n ? -n : n
  // arrotonda (metà in su) all'ultima cifra mostrata, restando in BigInt: mai passare da Number
  const scale = 10n ** BigInt(9 - maxDecimals)
  const rounded = (abs + scale / 2n) / scale
  const unit = 10n ** BigInt(maxDecimals)
  const wholeStr = groupThousands((rounded / unit).toString())
  const fracStr = (rounded % unit).toString().padStart(maxDecimals, '0').replace(/0+$/, '')
  return sign + wholeStr + (fracStr ? ',' + fracStr : '') + ' ERG'
}

/** Importo grezzo di un token con i suoi decimali → stringa leggibile. */
export function formatTokenAmount(raw: bigint | string | number, decimals: number): string {
  const n = typeof raw === 'bigint' ? raw : BigInt(raw)
  if (decimals === 0) return groupThousands(n.toString())
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return groupThousands(whole.toString()) + (frac ? ',' + frac : '')
}

/** Separatore delle migliaia (it-IT: punto) su una stringa di cifre. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Troncamento unico per hash e indirizzi: 6 + … + 4. */
export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id
  return id.slice(0, head) + '…' + id.slice(-tail)
}

/** Tempo relativo in italiano; il timestamp assoluto va sempre nel title/tooltip. */
export function relativeTime(tsMs: number, now = Date.now()): string {
  const s = Math.floor((now - tsMs) / 1000)
  if (s < 0) return 'ora'
  if (s < 60) return s + ' s fa'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' min fa'
  const h = Math.floor(m / 60)
  if (h < 48) return h + ' ore fa'
  const d = Math.floor(h / 24)
  if (d < 60) return d + ' giorni fa'
  return new Date(tsMs).toISOString().slice(0, 10)
}

export function isoUtc(tsMs: number): string {
  return new Date(tsMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

/** Riconoscimento del tipo di una stringa cercata. */
export type QueryKind = 'tx-or-token' | 'address' | 'height' | 'unknown'
export function classifyQuery(q: string): QueryKind {
  const s = q.trim()
  if (/^[0-9a-fA-F]{64}$/.test(s)) return 'tx-or-token'
  if (/^[1-9A-HJ-NP-Za-km-z]{40,}$/.test(s)) return 'address'
  if (/^\d{1,9}$/.test(s)) return 'height'
  return 'unknown'
}
