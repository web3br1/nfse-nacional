import { describe, it, expect, beforeAll } from 'vitest'
import { lerCertificado } from '../src/certificado.js'
import { gerarCertificado } from './certificado-de-teste.js'

const recusa = { ok: false, motivo: expect.any(String) }
let pj: string
let pf: string
let semId: string
let zerado: string
let ambos: string

beforeAll(async () => {
  pj = (await gerarCertificado({ cn: 'EMPRESA TESTE LTDA:12345678000195', cnpj: '12345678000195' })).certPem
  pf = (await gerarCertificado({ cn: 'PESSOA TESTE:12345678909', cpf: '12345678909' })).certPem
  semId = (await gerarCertificado({ cn: 'SEM DOCUMENTO' })).certPem
  zerado = (await gerarCertificado({ cnpj: '00000000000000', cpf: '00000000000' })).certPem
  ambos = (await gerarCertificado({ ip: '127.0.0.1', cnpj: '98765432000198', cpf: '12345678909' })).certPem
})

describe('lerCertificado', () => {
  it('lê o CNPJ do titular e a validade', () => {
    expect(lerCertificado(pj)).toMatchObject({ ok: true, cnpj: '12345678000195', cpf: null, vencido: false })
  })
  it('lê o CPF do titular (posições 9 a 19 do otherName 2.16.76.1.3.1)', () => {
    expect(lerCertificado(pf)).toMatchObject({ ok: true, cnpj: null, cpf: '12345678909' })
  })
  it('lê CNPJ e CPF juntos, com outro nome no SAN antes', () => {
    expect(lerCertificado(ambos)).toMatchObject({ ok: true, cnpj: '98765432000198', cpf: '12345678909' })
  })
  it('sem CNPJ nem CPF no certificado: ok com os dois nulos (quem chama decide)', () => {
    expect(lerCertificado(semId)).toMatchObject({ ok: true, cnpj: null, cpf: null })
  })
  it('número todo zero é ausência, não um documento', () => {
    expect(lerCertificado(zerado)).toMatchObject({ ok: true, cnpj: null, cpf: null })
  })
  it('devolve a validade em ISO UTC', () => {
    expect(lerCertificado(pj)).toMatchObject({ validoDe: '2026-01-01T00:00:00.000Z', validoAte: '2036-01-01T00:00:00.000Z' })
  })
  it('vencido em relação ao agora informado', () => {
    expect(lerCertificado(pj, new Date('2099-01-01'))).toMatchObject({ vencido: true })
  })
  it('borda: no instante exato do validoAte ainda vale; 1 ms depois venceu', () => {
    const ate = new Date('2036-01-01T00:00:00.000Z')
    expect(lerCertificado(pj, ate)).toMatchObject({ vencido: false })
    expect(lerCertificado(pj, new Date(ate.getTime() + 1))).toMatchObject({ vencido: true })
    expect(lerCertificado(pj, new Date(ate.getTime() - 1))).toMatchObject({ vencido: false })
  })
  it('sem agora informado usa o relógio (certificado de 2026 a 2036 não está vencido)', () => {
    expect(lerCertificado(pj)).toMatchObject({ vencido: false })
  })

  describe('nunca lança: tudo vira { ok: false, motivo }', () => {
    const casos: [string, unknown][] = [
      ['vazio', ''],
      ['lixo', 'isto não é um certificado'],
      ['null', null],
      ['undefined', undefined],
      ['número', 3],
      ['cabeçalho PEM com corpo lixo', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n'],
      ['chave privada no lugar do certificado', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'],
    ]
    for (const [nome, entrada] of casos) {
      it(nome, () => { expect(lerCertificado(entrada as string)).toEqual(recusa) })
    }
    it('certificado truncado', () => {
      expect(lerCertificado(pj.slice(0, pj.length / 2))).toEqual(recusa)
    })
    it('agora inválido', () => {
      expect(lerCertificado(pj, new Date('lixo'))).toEqual(recusa)
    })
  })
})
