import { describe, it, expect } from 'vitest'
import { lerNfse } from '../src/ler-nfse.js'
import { lerEvento } from '../src/ler-evento.js'
import { CHAVE, nfseCom, eventoCom } from './xml-autorizado.js'
import { readFileSync } from 'node:fs'
import { validarNoXsd, type ConjuntoXsd } from './xsd.js'

const CONJUNTOS: ConjuntoXsd[] = ['v1.01-20260209', 'PRODREST-v1.01-20261020']
const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse'

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

  // v0.1.1: o cancelamento por análise fiscal (105104 deferido, 105105 indeferido) vem da Sefin e fecha
  // ou não a nota; a v0.1.0 recusava os dois com "fora do XSD", e a nota cancelada seguia autorizada.
  describe.each(CONJUNTOS)('análise fiscal no XSD %s', (conjunto) => {
    it.each([
      ['105104', 'Cancelamento de NFS-e Deferido por Análise Fiscal'],
      ['105105', 'Cancelamento de NFS-e Indeferido por Análise Fiscal'],
    ])('evento %s válido no XSD é lido com o tipo', async (tipo, xDesc) => {
      const grupos = `<e${tipo}><xDesc>${xDesc}</xDesc><CPFAgTrib>12345678909</CPFAgTrib><cMotivo>1</cMotivo><xMotivo>Analise fiscal do municipio</xMotivo></e${tipo}>`
      const xml = eventoCom({ tipo, grupos })
      const ped = xml.slice(xml.indexOf('<pedRegEvento')).replace(/<\/infEvento>[\s\S]*$/, '').replace('<pedRegEvento ', `<pedRegEvento xmlns="${NS_NFSE}" `)
      expect(await validarNoXsd(ped, conjunto, 'pedRegEvento')).toEqual({ valido: true, erros: [] })
      expect(lerEvento(xml)).toEqual({ ok: true, tipo, chave: CHAVE, dhEvento: '2026-11-07T10:00:00-03:00', dataEvento: '2026-11-07' })
    })
  })

  // O xs:choice de TCInfPedReg inteiro, lido do próprio XSD: tipo novo no XSD sem o leitor acompanhar reprova.
  it.each(CONJUNTOS)('todo grupo do xs:choice de TCInfPedReg no XSD %s é aceito', (conjunto) => {
    const xsd = readFileSync(new URL(`../xsd/${conjunto}/tiposEventos_v1.01.xsd`, import.meta.url), 'utf8')
    const bloco = xsd.slice(xsd.indexOf('name="TCInfPedReg"'))
    const escolha = bloco.slice(bloco.lastIndexOf('<xs:choice>', bloco.indexOf('name="e101101"')), bloco.indexOf('</xs:choice>', bloco.indexOf('name="e101101"')))
    const tipos = [...escolha.matchAll(/<xs:element name="e(\d{6})"/g)].map((m) => m[1])
    expect(tipos).toHaveLength(16)
    const recusados = tipos.filter((tipo) => !lerEvento(eventoCom({ tipo })).ok)
    expect(recusados).toEqual([])
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
    it('grupo eNNNNNN em outro namespace, sozinho em infPedReg: recusa', () => {
      expect(lerEvento(eventoCom({ grupos: '<e105102 xmlns="urn:x"/>' }))).toEqual(recusa)
    })
    it('grupo eNNNNNN em outro namespace ao lado do verdadeiro: lê o verdadeiro', () => {
      expect(lerEvento(eventoCom({ grupos: '<e105102 xmlns="urn:x"/><e101101/>' }))).toMatchObject({ ok: true, tipo: '101101' })
    })
    it('chNFSe duplicado em infPedReg: recusa', () => {
      expect(lerEvento(eventoCom({ grupos: `<chNFSe>${FORJADA}</chNFSe><e101101/>` }))).toEqual(recusa)
    })
  })
})
