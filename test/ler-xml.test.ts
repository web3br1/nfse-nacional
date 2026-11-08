import { describe, it, expect } from 'vitest'
import { lerXml } from '../src/assinar.js'

describe('lerXml: referência numérica fora do Unicode devolve null, não lança', () => {
  const casos: [string, string][] = [
    ['&#xFFFFFFFF;', '<a>&#xFFFFFFFF;</a>'],
    ['&#x110000;', '<a>&#x110000;</a>'],
    ['decimal gigante', '<a>&#99999999999999999999;</a>'],
    ['em atributo', '<a b="&#x110000;"/>'],
  ]
  for (const [nome, xml] of casos) {
    it(nome, () => { expect(lerXml(xml)).toBeNull() })
  }
  it('referência válida continua lida', () => {
    expect(lerXml('<a>&#x41;&#66;</a>')?.filhos).toEqual([{ tipo: 'tx', valor: 'AB' }])
  })
})
