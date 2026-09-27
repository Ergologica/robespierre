import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { decodeWith, RECOGNIZER_IDS } from './index'
import { FIXTURES, explain } from './explain'
import type { Tx } from '../api/types'

const DIR = join(__dirname, 'fixtures')

describe('«come lo sappiamo» — la pagina non promette più verifiche di quante ne esistano', () => {
  it('il numero di fixture per riconoscitore è quello vero', () => {
    const counted: Record<string, number> = {}
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
      const r = decodeWith(JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Tx)
      if (r) counted[r.recognizer] = (counted[r.recognizer] ?? 0) + 1
    }
    expect(counted).toEqual(FIXTURES)
  })

  it('ogni riconoscitore ha una spiegazione e un file sorgente col suo nome', () => {
    for (const id of RECOGNIZER_IDS) {
      expect(explain(id, ''), id).not.toBe('')
      expect(existsSync(join(__dirname, 'recognizers', id + '.ts')), id).toBe(true)
    }
  })
})
