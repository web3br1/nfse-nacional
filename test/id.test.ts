import { describe, it, expect } from 'vitest'
import { idDps, idPedidoEvento } from '../src/id.js'

describe('Id da DPS (manual §1.4.1, E0004)', () => {
  it('CNPJ: tipo 2, série e número com zeros à esquerda, 45 caracteres', () => {
    const id = idDps({ cMun: '3550308', tpInsc: 2, inscricao: '12345678000195', serie: 1, nDPS: 42 })
    expect(id).toBe('DPS355030821234567800019500001000000000000042')
    expect(id).toHaveLength(45)
  })
  it('CPF: tipo 1, inscrição completada a 14 com zeros à esquerda', () => {
    expect(idDps({ cMun: '3550308', tpInsc: 1, inscricao: '12345678909', serie: 49999, nDPS: 1 }))
      .toBe('DPS355030810001234567890949999000000000000001')
  })
  it.each([['cMun', { cMun: '355030' }], ['serie', { serie: 0 }], ['serie', { serie: 50000 }], ['nDPS', { nDPS: 0 }], ['inscricao', { inscricao: '1234' }]])(
    'recusa %s fora da forma', (campo, troca) => {
      const base = { cMun: '3550308', tpInsc: 2 as const, inscricao: '12345678000195', serie: 1, nDPS: 1 }
      expect(() => idDps({ ...base, ...troca })).toThrow(campo)
    })
})

describe('Id do pedido de evento (E1235)', () => {
  it('PRE + chave de 50 + tipo de 6 = 59', () => {
    const chave = '3'.repeat(50)
    expect(idPedidoEvento({ chave, tipo: '101101' })).toBe(`PRE${chave}101101`)
    expect(idPedidoEvento({ chave, tipo: '101101' })).toHaveLength(59)
  })
  it('recusa chave que não tem 50 dígitos', () => {
    expect(() => idPedidoEvento({ chave: '1'.repeat(49), tipo: '101101' })).toThrow('chave')
  })
})
