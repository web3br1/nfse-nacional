// Rodada 1 da revisão da T1.5. regra: princípio "estado final só com prova; na dúvida, não final"
// · cerca: este teste
import { describe, it, expect, beforeAll } from 'vitest'
import { gzipSync } from 'node:zlib'
import { MockAgent, type Dispatcher } from 'undici'
import { criarTransporte, opcoesDoAgent, BASE } from '../src/transporte.js'
import type { Ambiente } from '../src/entrada.js'
import { gerarCertificado } from './certificado-de-teste.js'

const ID_DPS = 'DPS355030821234567800019000001000000000000001'
const CHAVE_50 = '12345678' + '123456789012345' + '678901234567890123456789012'
const XML_NFSE = '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe/></NFSe>'
const XML_EVENTO = '<evento versao="1.01"><infEvento/></evento>'
const JSON_H = { headers: { 'content-type': 'application/json' } }
const MB11 = 11 * 1024 * 1024
// XML válido (raiz certa) engordado com espaços: sem o teto, viraria estado final.
const gordo = (raiz: string) => `<${raiz}>` + ' '.repeat(MB11) + `</${raiz}>`

let certPem = ''
let keyPem = ''
beforeAll(async () => { ({ certPem, keyPem } = await gerarCertificado({ hash: 'SHA-256' })) })

const b64gz = (s: string | Buffer) => gzipSync(Buffer.from(s)).toString('base64')

class Contador extends MockAgent {
  n = 0
  override dispatch(o: Dispatcher.DispatchOptions, h: Dispatcher.DispatchHandler): boolean {
    this.n++
    return super.dispatch(o, h)
  }
}

function mock(ambiente: Ambiente = 'producao-restrita') {
  const agent = new Contador()
  agent.disableNetConnect()
  const url = new URL(BASE[ambiente])
  const pool = agent.get(url.origin)
  const t = criarTransporte({ ambiente, certPem, keyPem, dispatcher: agent })
  return { agent, pool, t, caminho: (c: string) => url.pathname + c }
}

const ERRO_E0004 = { erros: [{ codigo: 'E0004', descricao: 'x' }] }
const ERRO_E0014 = { erros: [{ codigo: 'E0014', descricao: 'x' }] }
const rotaEvento = `/nfse/${CHAVE_50}/eventos`

describe('R1.1 emitir: 2xx só é autorizada com a NFS-e na mão', () => {
  it.each([
    ['200 {}', 200, '{}', []],
    ['201 com erros E0004', 201, JSON.stringify(ERRO_E0004), ['E0004']],
    ['200 com erros E0014', 200, JSON.stringify(ERRO_E0014), ['E0014']],
    ['200 html', 200, '<html><body>manutenção</body></html>', []],
    ['200 XML de outra raiz', 200, '<DPS><infDPS/></DPS>', []],
    ['200 JSON com campo que descomprime para outra raiz', 200, JSON.stringify({ nfseXmlGZipB64: b64gz('<outra/>') }), []],
    ['200 vazio', 200, '', []],
  ])('%s → transiente, com motivo e os códigos extraídos', async (_n, status, corpo, codigos) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(status, corpo, JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('transiente')
    expect(r.status).toBe(status)
    expect(r.codigos).toEqual(codigos)
    expect(r.motivo).toBeTruthy()
    expect(r.xml).toBeUndefined()
  })

  it('XML com BOM, espaços e declaração antes da raiz <NFSe → autorizada', async () => {
    const { pool, t, caminho } = mock()
    const xml = '﻿  <?xml version="1.0" encoding="UTF-8"?>\n<NFSe xmlns="x"><infNFSe/></NFSe>'
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(201, JSON.stringify({ nfseXmlGZipB64: b64gz(xml) }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'autorizada', xml })
  })
})

describe('R1.2 registrarEvento: 2xx só é evento-registrado com o XML do evento', () => {
  it.each([
    ['201 {}', 201, '{}', []],
    ['200 com erro E0840', 200, JSON.stringify({ erro: { codigo: 'E0840' } }), ['E0840']],
    ['200 com erros E0004', 200, JSON.stringify(ERRO_E0004), ['E0004']],
    ['200 html', 200, '<html/>', []],
    ['200 texto ilegível', 200, 'nada', []],
    ['200 vazio', 200, '', []],
    ['200 XML de outra raiz', 200, JSON.stringify({ eventoXmlGZipB64: b64gz('<NFSe/>') }), []],
  ])('%s → transiente, com motivo e os códigos extraídos', async (_n, status, corpo, codigos) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'POST' }).reply(status, corpo, JSON_H)
    const r = await t.registrarEvento(CHAVE_50, '<p/>')
    expect(r.classe).toBe('transiente')
    expect(r.codigos).toEqual(codigos)
    expect(r.motivo).toBeTruthy()
  })
})

describe('R1.3 E0014 não escapa', () => {
  it.each([
    ['minúsculo', { erros: [{ codigo: 'e0014' }] }],
    ['envelope aninhado', { resultado: { detalhe: { erros: [{ codigo: 'E0014' }] } } }],
    ['Codigo com codigo vazio ao lado', { erros: [{ Codigo: 'E0014', codigo: '' }] }],
    ['com espaços', { erros: [{ codigo: ' E0014 ' }] }],
  ])('%s → duplicidade com E0014 em codigos', async (_n, corpo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify(corpo), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('duplicidade')
    expect(r.codigos).toContain('E0014')
  })

  it('E0014 em texto fora de JSON, com status 422 → duplicidade', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(422, 'Erro E0014: DPS já existe')
    expect((await t.emitir('<DPS/>')).classe).toBe('duplicidade')
  })

  it('código numérico não derruba a extração: vira texto, e a classe é rejeitada', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ erros: [{ codigo: 14 }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'rejeitada', codigos: ['14'] })
  })

  it('código com minúscula é normalizado em evento também', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'POST' }).reply(400, JSON.stringify({ erro: { codigo: 'e0840' } }), JSON_H)
    expect(await t.registrarEvento(CHAVE_50, '<p/>')).toMatchObject({ classe: 'evento-ja-registrado', codigos: ['E0840'] })
  })
})

describe('R1.5 as opções do Agent são as fixadas', () => {
  it('allowH2 false, TLS 1.2 no mínimo, certificado verificado, ca só quando presente', () => {
    const sem = opcoesDoAgent({ certPem: 'C', keyPem: 'K' })
    expect(sem.allowH2).toBe(false)
    expect(sem.connect.minVersion).toBe('TLSv1.2')
    expect(sem.connect.rejectUnauthorized).toBe(true)
    expect(sem.connect.cert).toBe('C')
    expect(sem.connect.key).toBe('K')
    expect('ca' in sem.connect).toBe(false)
    expect(sem.headersTimeout).toBe(30_000)
    const com = opcoesDoAgent({ certPem: 'C', keyPem: 'K', ca: 'CA', timeoutMs: 1234 })
    expect(com.connect.ca).toBe('CA')
    expect(com.bodyTimeout).toBe(1234)
  })
})

describe('R1.6 fechar() é terminal', () => {
  it('depois de fechar, toda chamada dá falha "transporte fechado", sem request', async () => {
    const { agent, t } = mock()
    await t.fechar()
    const rs = [await t.emitir('<DPS/>'), await t.existeDps(ID_DPS), await t.chaveDaDps(ID_DPS), await t.nfse(CHAVE_50),
      await t.registrarEvento(CHAVE_50, '<p/>'), await t.eventos(CHAVE_50)]
    for (const r of rs) expect(r).toMatchObject({ status: 0, classe: 'falha', motivo: 'transporte fechado' })
    expect(agent.n).toBe(0)
  })
})

describe('R1.7 limpar só mascara segredo de 8 caracteres ou mais', () => {
  it('chave curta não destrói a mensagem', async () => {
    const dispatcher = { dispatch() { throw new Error('abc abc a') } } as unknown as Dispatcher
    const t = criarTransporte({ ambiente: 'producao', certPem: 'a', keyPem: 'abc', dispatcher })
    expect((await t.emitir('<DPS/>')).motivo).toContain('abc abc a')
  })
})

describe('R1.8 timeoutMs válido', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 31, '30' as unknown as number])('timeoutMs %j → falha com motivo, sem request', async (timeoutMs) => {
    const agent = new Contador()
    agent.disableNetConnect()
    const t = criarTransporte({ ambiente: 'producao', certPem, keyPem, dispatcher: agent, timeoutMs })
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toContain('timeoutMs')
    expect(agent.n).toBe(0)
  })
})

describe('R1.9 teto de tamanho', () => {
  it('corpo 2xx acima do teto → transiente em emitir e em registrarEvento', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho('/nfse'), method: 'POST' }).reply(200, gordo('NFSe'))
    expect(await a.t.emitir('<DPS/>')).toMatchObject({ status: 200, classe: 'transiente' })
    const b = mock()
    b.pool.intercept({ path: b.caminho(rotaEvento), method: 'POST' }).reply(200, gordo('evento'))
    expect(await b.t.registrarEvento(CHAVE_50, '<p/>')).toMatchObject({ status: 200, classe: 'transiente' })
  })

  it('zip bomb pequeno (11 MB descomprimidos) → transiente em emitir e em registrarEvento', async () => {
    const bombaNfse = b64gz(gordo('NFSe'))
    const bombaEvento = b64gz(gordo('evento'))
    expect(bombaNfse.length).toBeLessThan(100_000)
    const a = mock()
    a.pool.intercept({ path: a.caminho('/nfse'), method: 'POST' }).reply(201, JSON.stringify({ nfseXmlGZipB64: bombaNfse }), JSON_H)
    expect(await a.t.emitir('<DPS/>')).toMatchObject({ status: 201, classe: 'transiente' })
    const b = mock()
    b.pool.intercept({ path: b.caminho(rotaEvento), method: 'POST' }).reply(201, JSON.stringify({ eventoXmlGZipB64: bombaEvento }), JSON_H)
    expect(await b.t.registrarEvento(CHAVE_50, '<p/>')).toMatchObject({ status: 201, classe: 'transiente' })
  })

  it('corpo de erro acima do teto continua classificado pelo status', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(503, 'a'.repeat(MB11))
    expect(await t.emitir('<DPS/>')).toMatchObject({ status: 503, classe: 'transiente' })
  })
})

describe('R1.10 a chave que vem do servidor é validada', () => {
  it.each(['../../x', '123', `${CHAVE_50}?x`, 42])('chaveDaDps com chave %j → transiente, sem chave', async (c) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(`/dps/${ID_DPS}`), method: 'GET' }).reply(200, JSON.stringify({ chaveAcesso: c }), JSON_H)
    const r = await t.chaveDaDps(ID_DPS)
    expect(r.classe).toBe('transiente')
    expect(r.chave).toBeUndefined()
  })

  it('emitir com NFS-e boa e chave ruim → transiente, sem chave', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(201, JSON.stringify({ nfseXmlGZipB64: b64gz(XML_NFSE), chaveAcesso: '../../x' }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('transiente')
    expect(r.chave).toBeUndefined()
  })
})

describe('R1.13 criarTransporte com opções ausentes ou inválidas não lança', () => {
  it.each([undefined, null, 'x', 5, {}, { ambiente: 'staging', certPem: 'c', keyPem: 'k' }, { ambiente: 'producao' }])(
    'opções %j → chamadas dão falha com motivo', async (o) => {
      const t = criarTransporte(o as never)
      for (const r of [await t.emitir('<DPS/>'), await t.existeDps(ID_DPS), await t.nfse(CHAVE_50), await t.eventos(CHAVE_50)]) {
        expect(r).toMatchObject({ status: 0, classe: 'falha' })
        expect(r.motivo).toBeTruthy()
      }
      await expect(t.fechar()).resolves.toBeUndefined()
    })
})

describe('sanidade dos fixtures da rodada', () => {
  it('chaves e xmls', () => {
    expect(CHAVE_50).toHaveLength(50)
    expect(XML_EVENTO.startsWith('<evento')).toBe(true)
  })
})
