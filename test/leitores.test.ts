import { describe, it, expect } from 'vitest'
import { lerNfse } from '../src/ler-nfse.js'
import { lerEvento } from '../src/ler-evento.js'
import { CHAVE, nfseCom, eventoCom } from './xml-autorizado.js'

const recusa = { ok: false, motivo: expect.any(String) }
const FORJADA = '3'.repeat(50)
const infForjado = `<infNFSe Id="NFS${FORJADA}"><nNFSe>999</nNFSe><dhProc>2020-01-01T00:00:00-03:00</dhProc></infNFSe>`
const semDeclaracao = (xml: string) => xml.replace(/^<\?xml[^>]*\?>/, '')

describe('lerNfse', () => {
  it('22h de Brasília no último dia do mês fica no mesmo dia', () => {
    const r = lerNfse(nfseCom({ dhProc: '2026-11-30T22:00:00-03:00' })) as any
    expect(r.dataProc).toBe('2026-11-30')
  })
  it('23h59 de Brasília (já é o dia seguinte em UTC) não vira o dia', () => {
    expect(lerNfse(nfseCom({ dhProc: '2026-12-31T23:59:59-03:00' }))).toMatchObject({ dhProc: '2026-12-31T23:59:59-03:00', dataProc: '2026-12-31' })
  })
  it('lê chave de 50, número e dhProc', () => {
    expect(lerNfse(nfseCom({ chave: '3'.repeat(50), nNFSe: '17' }))).toEqual({
      ok: true, chave: '3'.repeat(50), numero: '17', dhProc: '2026-11-07T10:00:00-03:00', dataProc: '2026-11-07',
    })
  })
  it('chave com letra no CNPJ (Id da restrita, TSIdNFSe de PRODREST) é aceita', () => {
    const chave = '355030821' + '12ABC456780001'.padEnd(14, '5') + '0'.repeat(27)
    expect(lerNfse(nfseCom({ chave }))).toMatchObject({ ok: true, chave })
  })

  describe('nunca lança: tudo vira { ok: false, motivo }', () => {
    const casos: [string, unknown][] = [
      ['XML sem chave', '<NFSe/>'],
      ['vazio', ''],
      ['lixo', 'isto não é xml'],
      ['truncado', '<NFSe><infNFSe Id="x"'],
      ['DOCTYPE', '<!DOCTYPE a [<!ENTITY x "y">]>' + nfseCom()],
      ['referência numérica impossível', nfseCom({ dentro: '<x>&#xFFFFFFFF;</x>' })],
      ['null', null],
      ['undefined', undefined],
      ['número', 7],
      ['raiz errada', nfseCom({ raiz: 'outra' })],
      ['Id sem o prefixo NFS', nfseCom({ id: CHAVE })],
      ['Id com 49 dígitos', nfseCom({ id: `NFS${CHAVE.slice(1)}` })],
      ['Id com 51 dígitos', nfseCom({ id: `NFS${CHAVE}0` })],
      ['Id com letra fora do CNPJ', nfseCom({ id: `NFSA${CHAVE.slice(1)}` })],
      ['nNFSe ausente', nfseCom().replace(/<nNFSe>.*<\/nNFSe>/, '')],
      ['nNFSe zero', nfseCom({ nNFSe: '0' })],
      ['nNFSe com zero à esquerda', nfseCom({ nNFSe: '017' })],
      ['dhProc ausente', nfseCom().replace(/<dhProc>.*<\/dhProc>/, '')],
      ['dhProc sem fuso', nfseCom({ dhProc: '2026-11-07T10:00:00' })],
      ['dhProc com Z (o XSD não admite)', nfseCom({ dhProc: '2026-11-07T10:00:00Z' })],
      ['dhProc em data impossível', nfseCom({ dhProc: '2026-02-30T10:00:00-03:00' })],
      ['dhProc sem hora', nfseCom({ dhProc: '2026-11-07' })],
      ['namespace errado', nfseCom().replace('http://www.sped.fazenda.gov.br/nfse', 'http://outro')],
    ]
    for (const [nome, entrada] of casos) {
      it(nome, () => { expect(lerNfse(entrada as string)).toEqual(recusa) })
    }
  })

  describe('wrapping: o elemento é achado pelo caminho a partir da raiz', () => {
    it('infNFSe forjado ANTES do verdadeiro, como filho da raiz: recusa (dois infNFSe)', () => {
      expect(lerNfse(nfseCom({ antes: infForjado }))).toEqual(recusa)
    })
    it('infNFSe forjado DEPOIS do verdadeiro, como filho da raiz: recusa', () => {
      const xml = nfseCom().replace('<Signature', `${infForjado}<Signature`)
      expect(lerNfse(xml)).toEqual(recusa)
    })
    it('infNFSe forjado dentro de um elemento extra, antes do verdadeiro: lê o verdadeiro, nunca o forjado', () => {
      const r = lerNfse(nfseCom({ antes: `<extra>${infForjado}</extra>` }))
      expect(r).toMatchObject({ ok: true, chave: CHAVE, numero: '17' })
    })
    it('infNFSe forjado dentro do próprio infNFSe verdadeiro: lê o verdadeiro', () => {
      expect(lerNfse(nfseCom({ dentro: infForjado }))).toMatchObject({ ok: true, chave: CHAVE, numero: '17' })
    })
    it('NFSe inteira embrulhada em outro elemento: recusa (a raiz tem de ser NFSe)', () => {
      expect(lerNfse(`<envelope>${semDeclaracao(nfseCom())}</envelope>`)).toEqual(recusa)
    })
    it('NFSe forjada com a verdadeira aninhada: recusa (a raiz forjada não tem infNFSe)', () => {
      const interna = semDeclaracao(nfseCom())
      expect(lerNfse(`<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><x>${interna}</x></NFSe>`)).toEqual(recusa)
    })
  })
})

describe('lerEvento', () => {
  it('evento 105102 (substituição, gerado pela Sefin) é lido com o tipo', () => {
    expect(lerEvento(eventoCom({ tipo: '105102', dhEvento: '2026-12-31T23:30:00-03:00' }))).toMatchObject({ tipo: '105102', dataEvento: '2026-12-31' })
  })
  it('evento 101101 devolve tipo, chave e dhEvento como vieram', () => {
    expect(lerEvento(eventoCom({ tipo: '101101', chave: '4'.repeat(50) }))).toEqual({
      ok: true, tipo: '101101', chave: '4'.repeat(50), dhEvento: '2026-11-07T10:00:00-03:00', dataEvento: '2026-11-07',
    })
  })
  it('21h30 de Brasília no último dia do mês não vira o dia', () => {
    expect(lerEvento(eventoCom({ dhEvento: '2026-11-30T21:30:00-03:00' }))).toMatchObject({ dataEvento: '2026-11-30' })
  })

  describe('nunca lança: tudo vira { ok: false, motivo }', () => {
    const casos: [string, unknown][] = [
      ['vazio', ''],
      ['<evento/>', '<evento/>'],
      ['lixo', 'lixo'],
      ['truncado', '<evento><infEvento'],
      ['DOCTYPE', '<!DOCTYPE a [<!ENTITY x "y">]>' + eventoCom()],
      ['referência numérica impossível', eventoCom({ dentro: '<x>&#xFFFFFFFF;</x>' })],
      ['null', null],
      ['raiz errada', eventoCom().replace(/<(\/?)evento\b/g, '<$1outra')],
      ['namespace errado', eventoCom().replace('http://www.sped.fazenda.gov.br/nfse', 'http://outro')],
      ['chave com 49 dígitos', eventoCom({ chave: CHAVE.slice(1) })],
      ['chave com letra', eventoCom({ chave: `A${CHAVE.slice(1)}` })],
      ['dhEvento sem fuso', eventoCom({ dhEvento: '2026-11-07T10:00:00' })],
      ['dhEvento impossível', eventoCom({ dhEvento: '2026-13-07T10:00:00-03:00' })],
      ['dhEvento ausente', eventoCom().replace(/<dhEvento>.*<\/dhEvento>/, '')],
      ['chNFSe ausente', eventoCom().replace(/<chNFSe>.*<\/chNFSe>/, '')],
      ['sem grupo de evento', eventoCom({ grupos: '' })],
      ['tipo fora do XSD', eventoCom({ tipo: '999999' })],
      ['dois grupos de evento', eventoCom({ grupos: '<e101101/><e105102/>' })],
    ]
    for (const [nome, entrada] of casos) {
      it(nome, () => { expect(lerEvento(entrada as string)).toEqual(recusa) })
    }
  })

  describe('wrapping: o elemento é achado pelo caminho a partir da raiz', () => {
    const pedForjado = `<pedRegEvento versao="1.01"><infPedReg Id="PRE${FORJADA}101101"><dhEvento>2020-01-01T00:00:00-03:00</dhEvento>`
      + `<chNFSe>${FORJADA}</chNFSe><e101101/></infPedReg></pedRegEvento>`
    const infEventoForjado = `<infEvento Id="EVT${FORJADA}101101">${pedForjado}</infEvento>`
    it('infEvento forjado ANTES do verdadeiro, como filho da raiz: recusa', () => {
      expect(lerEvento(eventoCom({ antes: infEventoForjado }))).toEqual(recusa)
    })
    it('pedRegEvento forjado antes do verdadeiro, dentro do infEvento: recusa (dois pedRegEvento)', () => {
      expect(lerEvento(eventoCom({ dentro: pedForjado }))).toEqual(recusa)
    })
    it('infEvento forjado dentro de elemento extra: lê o verdadeiro, nunca o forjado', () => {
      expect(lerEvento(eventoCom({ antes: `<extra>${infEventoForjado}</extra>` }))).toMatchObject({ ok: true, chave: CHAVE, tipo: '101101' })
    })
    it('chNFSe forjado dentro do grupo do evento: lê o chNFSe de infPedReg', () => {
      const r = lerEvento(eventoCom({ grupos: `<e101101><chNFSe>${FORJADA}</chNFSe></e101101>` }))
      expect(r).toMatchObject({ ok: true, chave: CHAVE })
    })
    it('chNFSe duplicado em infPedReg: recusa', () => {
      expect(lerEvento(eventoCom({ grupos: `<chNFSe>${FORJADA}</chNFSe><e101101/>` }))).toEqual(recusa)
    })
  })
})
