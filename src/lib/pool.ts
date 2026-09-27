/** Esegue `fn` su tutti gli elementi con al più `n` richieste in volo: l'API pubblica
 *  regge 4-5 richieste parallele senza rispondere 429 (misurato ad agosto). */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i) }
  }))
  return out
}
