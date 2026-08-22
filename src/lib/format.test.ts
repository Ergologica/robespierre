import { describe, it, expect } from 'vitest'
import { formatErg, formatTokenAmount, shortId, classifyQuery, relativeTime } from './format'

describe('formatErg', () => {
  it('converte nanoERG interi', () => {
    expect(formatErg(5_000_000_000_000n)).toBe('5.000 ERG')
  })
  it('mantiene i decimali significativi', () => {
    expect(formatErg(16_400_445_659_922n)).toBe('16.400,4457 ERG')
  })
  it('regge importi oltre 2^53 senza perdere precisione', () => {
    // 765.976,928304746 ERG — l'input reale del wallet MEXC nella fixture
    expect(formatErg(765_976_928_304_746n, 9)).toBe('765.976,928304746 ERG')
  })
  it('accetta stringhe (gli importi arrivano così dal JSON)', () => {
    expect(formatErg('1000000')).toBe('0,001 ERG')
  })
})

describe('formatTokenAmount', () => {
  it('0 decimali', () => { expect(formatTokenAmount(150000n, 0)).toBe('150.000') })
  it('con decimali', () => { expect(formatTokenAmount(2125n, 2)).toBe('21,25') })
  it('oltre 2^53', () => {
    expect(formatTokenAmount(38747980284440391n, 9)).toBe('38.747.980,284440391')
  })
})

describe('shortId', () => {
  it('tronca 6+4', () => {
    expect(shortId('e06697e0e08c2dc69db3b0fb75e89f3bc665e1c79316657a33c4e7c521bfdca3')).toBe('e06697…dca3')
  })
})

describe('classifyQuery', () => {
  it('64 hex → tx o token', () => { expect(classifyQuery('a'.repeat(64))).toBe('tx-or-token') })
  it('indirizzo base58', () => {
    expect(classifyQuery('9gnhfapSW2RtUYXR7DukoaSZfZpNazzcuyUhay5mjBW91qHS345')).toBe('address')
  })
  it('altezza', () => { expect(classifyQuery('1855058')).toBe('height') })
})

describe('relativeTime', () => {
  it('minuti', () => { expect(relativeTime(0, 3 * 60_000)).toBe('3 min fa') })
})
