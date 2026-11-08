// Rodada 2 da revisão da T1.5. regra: estado final só com prova · cerca: este teste
import { describe, it, expect, beforeAll } from 'vitest'
import { gzipSync } from 'node:zlib'
import { MockAgent } from 'undici'
import { criarTransporte, BASE } from '../src/transporte.js'
import { gerarCertificado } from './certificado-de-teste.js'

const CHAVE_50 = '12345678' + '123456789012345' + '678901234567890123456789012'
const JSON_H = { headers: { 'content-type': 'application/json' } }
const XML_EVENTO = '<evento versao="1.01"><infEvento/></evento>'
const b64gz = (s: string) => gzipSync(Buffer.from(s)).toString('base64')
const rotaEvento = `/nfse/${CHAVE_50}/eventos`

let certPem = ''
let keyPem = ''
beforeAll(async () => { ({ certPem, keyPem } = await gerarCertificado({ hash: 'SHA-256' })) })

function mock() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  const url = new URL(BASE['producao-restrita'])
  const pool = agent.get(url.origin)
  const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, dispatcher: agent })
  return { pool, t, caminho: (c: string) => url.pathname + c }
}

describe('R2.1 POST com status não final e código conhecido → transiente, com os códigos', () => {
  it.each([[500, 'E0004'], [503, 'E9999'], [429, 'E0004'], [408, 'E0004']])('emitir %i com %s', async (status, codigo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(status, JSON.stringify({ erros: [{ codigo }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ status, classe: 'transiente', codigos: [codigo] })
  })

  it.each([[500, 'E0004'], [503, 'E9999'], [429, 'E0004'], [408, 'E0004']])('evento %i com %s', async (status, codigo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'POST' }).reply(status, JSON.stringify({ erro: { codigo } }), JSON_H)
    expect(await t.registrarEvento(CHAVE_50, '<p/>')).toMatchObject({ status, classe: 'transiente', codigos: [codigo] })
  })

  it('E0014 num 500 continua duplicidade, e E0840 num 500 de evento continua evento-ja-registrado', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho('/nfse'), method: 'POST' }).reply(500, JSON.stringify({ erros: [{ codigo: 'E0014' }] }), JSON_H)
    expect((await a.t.emitir('<DPS/>')).classe).toBe('duplicidade')
    const b = mock()
    b.pool.intercept({ path: b.caminho(rotaEvento), method: 'POST' }).reply(500, JSON.stringify({ erro: { codigo: 'E0840' } }), JSON_H)
    expect((await b.t.registrarEvento(CHAVE_50, '<p/>')).classe).toBe('evento-ja-registrado')
  })
})

describe('R2.2 só código no padrão da Sefin conta', () => {
  it.each([['14', 14], ['RATE_LIMIT', 'RATE_LIMIT'], ['E14', 'E14'], ['E00014', 'E00014']])('%s não vira código; 400 → falha com o bruto em mensagens', async (_n, bruto) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ erros: [{ codigo: bruto }] }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ classe: 'falha', codigos: [] })
    expect(r.mensagens).toContain(String(bruto))
    expect(r.motivo).toContain('400')
  })

  it('429 com código fora do padrão → transiente (regra de status sem código)', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(429, JSON.stringify({ erros: [{ codigo: 'RATE_LIMIT' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'transiente', codigos: [] })
  })
})

describe('R2.3 E0014 no texto só vale sem código válido', () => {
  it('descrição que cita E0014 com código E0004 → rejeitada com [E0004]', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ codigo: 'E0004', descricao: 'valor diferente de E0014' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'rejeitada', codigos: ['E0004'] })
  })

  it('envelope desconhecido com E0014 → duplicidade', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ x: { y: [{ codigo: 'E0014' }] } }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'duplicidade', codigos: ['E0014'] })
  })
})

describe('R2.4 eventos(): 2xx só é encontrada com lista legível', () => {
  it.each([
    ['corpo ilegível', 'nada'],
    ['JSON sem o campo da lista', '{}'],
    ['lista que não é array', JSON.stringify({ eventos: 'x' })],
    ['item sem raiz de evento', JSON.stringify({ eventos: [{ eventoXmlGZipB64: b64gz('<NFSe/>') }] })],
    ['item sem campo de XML', JSON.stringify({ eventos: [{ outro: 1 }] })],
  ])('%s → transiente com motivo', async (_n, corpo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'GET' }).reply(200, corpo, JSON_H)
    const r = await t.eventos(CHAVE_50)
    expect(r.classe).toBe('transiente')
    expect(r.motivo).toBeTruthy()
    expect(r.eventosXml).toBeUndefined()
  })

  it('lista vazia legítima → encontrada com []', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'GET' }).reply(200, JSON.stringify({ eventos: [] }), JSON_H)
    expect(await t.eventos(CHAVE_50)).toMatchObject({ classe: 'encontrada', eventosXml: [] })
  })

  it('lista com eventos válidos → encontrada com os XML', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rotaEvento), method: 'GET' })
      .reply(200, JSON.stringify({ eventos: [{ eventoXmlGZipB64: b64gz(XML_EVENTO) }] }), JSON_H)
    expect(await t.eventos(CHAVE_50)).toMatchObject({ classe: 'encontrada', eventosXml: [XML_EVENTO] })
  })
})
