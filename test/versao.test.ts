import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSAO_PACOTE } from '../src/index.js'

describe('VERSAO_PACOTE', () => {
  it('é a version do package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(VERSAO_PACOTE).toBe(pkg.version)
  })
})
