import { describe, it, expect } from 'vitest'
import { txMovement, ledgerSide } from './movement'
import { FEE_ADDRESS } from '../decoder/recognizers/simple-transfer'
import type { Tx } from '../api/types'
import bridge from '../decoder/fixtures/bridge-e06697e0.json'
import redeem from '../decoder/fixtures/sigmausd-redeem.json'
import consolida from '../decoder/fixtures/wallet-consolida.json'
import soloToken from '../decoder/fixtures/transfer-token-senza-erg.json'

const mov = (tx: unknown) => txMovement(tx as Tx, FEE_ADDRESS)

describe('libro mastro — il saldo di ogni indirizzo, prima chi dà', () => {
  it('arrivo Rosen: il hot wallet dà, il destinatario riceve la cifra della frase', () => {
    const m = mov(bridge)
    expect(ledgerSide(m.ledger[0]!)).toBe('out')
    expect(m.ledger[0]!.address.startsWith('nB3L2PD3J4')).toBe(true)
    const dest = m.ledger.find(r => r.address.startsWith('9gnhfapSW2'))!
    expect(dest.erg).toBe(9_950_988_300_000n)
    // la somma di chi riceve è il valore mosso: il libro mastro e il riquadro dicono lo stesso numero
    const inTot = m.ledger.filter(r => r.erg > 0n).reduce((s, r) => s + r.erg, 0n)
    expect(inTot).toBe(m.ergMoved)
  })
  it('il resto si dichiara: torna al hot wallet, con i suoi token', () => {
    const m = mov(bridge)
    expect(m.returned!.address.startsWith('nB3L2PD3J4')).toBe(true)
    expect(m.returned!.erg).toBe(14_494_951_171_518n)
    expect(m.returned!.tokenKinds).toBe(53)
  })
  it('riscatto SigmaUSD: la banca dà ERG, chi riscatta dà SigUSD e riceve ERG', () => {
    const m = mov(redeem)
    const user = m.ledger.find(r => r.address.startsWith('9etDbVVWiZ'))!
    expect(ledgerSide(user)).toBe('in')                // conta l'ERG, non la polvere
    expect(user.tokens[0]!.amount).toBe(-20_000n)      // i SigUSD escono da lui
  })
  it('un trasferimento di soli token: il verso lo decidono i token, non 0,00004 ERG', () => {
    const m = mov(soloToken)
    const to = m.ledger.find(r => r.tokens.some(t => t.amount > 0n))!
    expect(ledgerSide(to)).toBe('in')
    expect(m.ledger.map(ledgerSide)).toEqual(['out', 'in'])
  })
  it('consolidamento: resta solo chi paga la commissione', () => {
    const m = mov(consolida)
    expect(m.ledger).toHaveLength(1)
    expect(m.ledger[0]!.erg).toBe(-m.fee)
  })
})
