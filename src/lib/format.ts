/**
 * Un solo punto di conversione per numeri, importi e identificatori.
 * REGOLA: gli importi grezzi restano BigInt fino al momento della stampa.
 * `Number` perde precisione sopra 2^53: alcuni importi di token la superano.
 */

const NANO = 1_000_000_000n

/* separatori correnti: it = 1.234,56 · en = 1,234.56 */
let GROUP = '.'
let DEC = ','
export function setNumberLocale(lang: 'it' | 'en'): void {
  GROUP = lang === 'it' ? '.' : ','
  DEC = lang === 'it' ? ',' : '.'
}

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
  return sign + wholeStr + (fracStr ? DEC + fracStr : '') + ' ERG'
}

/** Importo grezzo di un token con i suoi decimali → stringa leggibile.
 *  `maxDecimals` taglia la coda nelle LISTE di riepilogo (arrotondando, non
 *  troncando): «1.030.446.883,81097088» in un elenco non si legge. */
export function formatTokenAmount(raw: bigint | string | number, decimals: number, maxDecimals?: number): string {
  let n = typeof raw === 'bigint' ? raw : BigInt(raw)
  let dec = decimals
  if (maxDecimals != null && decimals > maxDecimals) {
    const scale = 10n ** BigInt(decimals - maxDecimals)
    const neg = n < 0n
    const abs = neg ? -n : n
    n = (abs + scale / 2n) / scale        // arrotonda a metà in su, in BigInt
    if (neg) n = -n
    dec = maxDecimals
  }
  if (dec === 0) return groupThousands(n.toString())
  const base = 10n ** BigInt(dec)
  const whole = n / base
  const frac = (n % base).toString().padStart(dec, '0').replace(/0+$/, '')
  return groupThousands(whole.toString()) + (frac ? DEC + frac : '')
}

/** Separatore delle migliaia (it-IT: punto) su una stringa di cifre. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)
}

/** Percentuale (o numero) con separatore decimale coerente con la lingua corrente. */
export function formatPct(v: number, digits = 2): string {
  return v.toFixed(digits).replace('.', DEC)
}

/** Troncamento unico per hash e indirizzi: 6 + … + 4. */
export function shortId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id
  return id.slice(0, head) + '…' + id.slice(-tail)
}

/** Tempo relativo; le parole sono iniettate da i18n (default italiano). */
let REL = { now: 'ora', s: 's fa', min: 'min fa', h: 'ore fa', d: 'giorni fa' }
export function setRelativeWords(words: typeof REL): void { REL = words }
export function relativeTime(tsMs: number, now = Date.now()): string {
  const s = Math.floor((now - tsMs) / 1000)
  if (s < 0) return REL.now
  if (s < 60) return s + ' ' + REL.s
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' ' + REL.min
  const h = Math.floor(m / 60)
  if (h < 48) return h + ' ' + REL.h
  const d = Math.floor(h / 24)
  if (d < 60) return d + ' ' + REL.d
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
