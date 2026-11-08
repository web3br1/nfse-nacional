// regra: manual §1.3-1.5, T0.1 itens 2, 3 e 10 (G0 Q1, Q2, Q6) · cerca: este teste
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer as criarServidorHttps, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'
import type { AddressInfo } from 'node:net'
import { gunzipSync, gzipSync } from 'node:zlib'
import { MockAgent, type Dispatcher } from 'undici'
import { criarTransporte, BASE, CAMPO_DPS, CAMPO_EVENTO } from '../src/transporte.js'
import type { Ambiente } from '../src/entrada.js'
import { gerarCertificado } from './certificado-de-teste.js'

const ID_DPS = 'DPS355030821234567800019000001000000000000001' // 45 caracteres
const ID_DPS_LETRA = 'DPS3550308212ABC34500019500001000000000000001' // CNPJ com letra, tpInsc 2
const CHAVE_50 = '12345678' + '123456789012345' + '678901234567890123456789012' // tpInsc 1 na posição 9
const XML_NFSE = '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe/></NFSe>'
const JSON_H = { headers: { 'content-type': 'application/json' } }

let certPem = ''
let keyPem = ''
beforeAll(async () => { ({ certPem, keyPem } = await gerarCertificado({ hash: 'SHA-256' })) })

const b64gz = (s: string) => gzipSync(Buffer.from(s, 'utf8')).toString('base64')

/** Dispatcher que conta quantas requisições tentaram sair. */
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
  const caminho = (c: string) => url.pathname + c
  return { agent, pool, t, caminho }
}

describe('ids de teste têm o tamanho certo', () => {
  it('45 e 50 caracteres', () => {
    expect(ID_DPS).toHaveLength(45)
    expect(ID_DPS_LETRA).toHaveLength(45)
    expect(CHAVE_50).toHaveLength(50)
  })
})

describe('classificação do POST /nfse', () => {
  it('201 com a NFS-e (JSON com o XML em gzip+base64) → autorizada com xml e chave', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(201, JSON.stringify({ nfseXmlGZipB64: b64gz(XML_NFSE), chaveAcesso: CHAVE_50 }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ status: 201, classe: 'autorizada', xml: XML_NFSE, chave: CHAVE_50 })
  })

  it('201 com o XML puro no corpo → autorizada com xml', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(201, XML_NFSE)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'autorizada', xml: XML_NFSE })
  })

  it('201 com gzip inválido no campo do XML → falha com motivo, sem lançar', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(201, JSON.stringify({ nfseXmlGZipB64: Buffer.from('não é gzip').toString('base64') }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('falha')
    expect(r.motivo).toBeTruthy()
  })

  it('400 com erros em lista → rejeitada com codigos e mensagens', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ codigo: 'E0004', descricao: 'tipo de inscrição' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({
      status: 400, classe: 'rejeitada', codigos: ['E0004'], mensagens: ['tipo de inscrição'],
    })
  })

  const item = { codigo: 'E0004', descricao: 'tipo de inscrição' }
  it.each([
    ['erros: lista', { erros: [item] }],
    ['erros: objeto', { erros: item }],
    ['erro: lista', { erro: [item] }],
    ['erro: objeto', { erro: item }],
    ['Erros/Codigo (PascalCase)', { Erros: [{ Codigo: 'E0004', Descricao: 'tipo de inscrição' }] }],
  ])('as formas dão os mesmos codigos: %s', async (_nome, corpo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify(corpo), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'rejeitada', codigos: ['E0004'], mensagens: ['tipo de inscrição'] })
  })

  it('erros e erro no mesmo corpo: une os códigos sem duplicar, na ordem de aparição', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({
      erros: [{ codigo: 'E0004', descricao: 'a' }, { codigo: 'E0010', descricao: 'b' }],
      erro: { codigo: 'E0004', descricao: 'a' },
    }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('rejeitada')
    expect(r.codigos).toEqual(['E0004', 'E0010'])
  })

  it('E0014 → duplicidade, nunca rejeitada', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ codigo: 'E0014', descricao: 'DPS já existe' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'duplicidade', codigos: ['E0014'] })
  })

  it('regra de mistura: E0014 junto de outro código de rejeição → duplicidade, com os dois códigos', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ codigo: 'E0004' }, { codigo: 'E0014' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'duplicidade', codigos: ['E0004', 'E0014'] })
  })

  it.each(['E1217', 'E1206'])('%s → transiente', async (codigo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ erros: [{ codigo }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'transiente', codigos: [codigo] })
  })

  it('regra de mistura: transiente junto de rejeição definitiva → rejeitada (repetir não resolve)', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ codigo: 'E1217' }, { codigo: 'E0004' }] }), JSON_H)
    expect(await t.emitir('<DPS/>')).toMatchObject({ classe: 'rejeitada', codigos: ['E1217', 'E0004'] })
  })

  it('código desconhecido (E9999) → rejeitada, nunca transiente nem duplicidade', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ erros: [{ codigo: 'E9999' }] }), JSON_H)
    expect((await t.emitir('<DPS/>')).classe).toBe('rejeitada')
  })

  it('503 sem corpo → transiente', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(503, '')
    expect(await t.emitir('<DPS/>')).toMatchObject({ status: 503, classe: 'transiente' })
  })

  it('2xx com corpo que não é JSON nem XML → transiente com motivo', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(200, 'isto não é json')
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('transiente')
    expect(r.motivo).toBeTruthy()
  })

  it.each([
    [301, 'falha'], [302, 'falha'], [307, 'falha'],
    [400, 'rejeitada'], [401, 'rejeitada'], [403, 'rejeitada'], [404, 'rejeitada'], [413, 'rejeitada'], [422, 'rejeitada'],
    [500, 'transiente'], [502, 'transiente'], [504, 'transiente'],
  ])('status %i sem código legível (corpo não JSON) → %s, com o status no motivo', async (status, classe) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(status, '<html>erro</html>')
    const r = await t.emitir('<DPS/>')
    expect(r.status).toBe(status)
    expect(r.classe).toBe(classe)
    expect(r.motivo).toContain(String(status))
  })

  it('400 com JSON sem nenhum código → rejeitada com o status no motivo', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' })
      .reply(400, JSON.stringify({ erros: [{ descricao: 'sem código' }] }), JSON_H)
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ classe: 'rejeitada', codigos: [] })
    expect(r.motivo).toContain('400')
  })

  it('o corpo é JSON com o campo CAMPO_DPS = gzip + base64 da DPS', async () => {
    const { pool, t, caminho } = mock()
    let corpo = ''
    pool.intercept({
      path: caminho('/nfse'), method: 'POST',
      body: (b) => { corpo = String(b); return true },
    }).reply(201, XML_NFSE)
    const dps = '<DPS><infDPS Id="x">ação ✓</infDPS></DPS>'
    await t.emitir(dps)
    const json = JSON.parse(corpo) as Record<string, string>
    expect(Object.keys(json)).toEqual([CAMPO_DPS])
    expect(CAMPO_DPS).toBe('dpsXmlGZipB64')
    expect(gunzipSync(Buffer.from(json[CAMPO_DPS]!, 'base64')).toString('utf8')).toBe(dps)
  })

  it.each(['producao', 'producao-restrita'] as const)('o POST vai para BASE[%s] + /nfse', async (ambiente) => {
    const { pool, t, caminho } = mock(ambiente)
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).reply(201, XML_NFSE)
    expect((await t.emitir('<DPS/>')).classe).toBe('autorizada')
  })

  it('as bases são as de G0 Q1', () => {
    expect(BASE).toEqual({
      producao: 'https://sefin.nfse.gov.br/SefinNacional',
      'producao-restrita': 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
    })
  })
})

describe('eventos', () => {
  const rota = `/nfse/${CHAVE_50}/eventos`

  it('201 → evento-registrado; o corpo carrega CAMPO_EVENTO em gzip + base64', async () => {
    const { pool, t, caminho } = mock()
    let corpo = ''
    pool.intercept({ path: caminho(rota), method: 'POST', body: (b) => { corpo = String(b); return true } }).reply(201, '{}', JSON_H)
    const r = await t.registrarEvento(CHAVE_50, '<pedRegEvento/>')
    expect(r).toMatchObject({ status: 201, classe: 'evento-registrado' })
    const json = JSON.parse(corpo) as Record<string, string>
    expect(Object.keys(json)).toEqual([CAMPO_EVENTO])
    expect(gunzipSync(Buffer.from(json[CAMPO_EVENTO]!, 'base64')).toString('utf8')).toBe('<pedRegEvento/>')
  })

  it.each(['E0802', 'E0840', 'E0845'])('%s → evento-ja-registrado', async (codigo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rota), method: 'POST' })
      .reply(400, JSON.stringify({ erro: { codigo, descricao: 'já vinculado' } }), JSON_H)
    expect(await t.registrarEvento(CHAVE_50, '<pedRegEvento/>')).toMatchObject({ classe: 'evento-ja-registrado', codigos: [codigo] })
  })

  it.each([
    ['objeto', { erro: { codigo: 'E0840', descricao: 'x' } }],
    ['lista', { erro: [{ codigo: 'E0840', descricao: 'x' }] }],
  ])('erro de evento como %s → mesmos codigos', async (_n, corpo) => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rota), method: 'POST' }).reply(400, JSON.stringify(corpo), JSON_H)
    expect((await t.registrarEvento(CHAVE_50, '<p/>')).codigos).toEqual(['E0840'])
  })

  it('regra de mistura: código de evento já registrado junto de outro → evento-ja-registrado, com os dois', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(rota), method: 'POST' })
      .reply(400, JSON.stringify({ erro: [{ codigo: 'E0010' }, { codigo: 'E0840' }] }), JSON_H)
    expect(await t.registrarEvento(CHAVE_50, '<p/>')).toMatchObject({ classe: 'evento-ja-registrado', codigos: ['E0010', 'E0840'] })
  })

  it('E0014 num evento não vira duplicidade, e E0840 na emissão não vira evento-ja-registrado', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(rota), method: 'POST' }).reply(400, JSON.stringify({ erro: { codigo: 'E0014' } }), JSON_H)
    expect((await a.t.registrarEvento(CHAVE_50, '<p/>')).classe).toBe('rejeitada')
    const b = mock()
    b.pool.intercept({ path: b.caminho('/nfse'), method: 'POST' }).reply(400, JSON.stringify({ erros: [{ codigo: 'E0840' }] }), JSON_H)
    expect((await b.t.emitir('<DPS/>')).classe).toBe('rejeitada')
  })

  it('E1217 num evento → transiente; 503 → transiente', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(rota), method: 'POST' }).reply(400, JSON.stringify({ erro: { codigo: 'E1217' } }), JSON_H)
    expect((await a.t.registrarEvento(CHAVE_50, '<p/>')).classe).toBe('transiente')
    const b = mock()
    b.pool.intercept({ path: b.caminho(rota), method: 'POST' }).reply(503, '')
    expect((await b.t.registrarEvento(CHAVE_50, '<p/>')).classe).toBe('transiente')
  })

  it('GET eventos → encontrada com eventosXml decodificados; 404 → nao-encontrada', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(rota), method: 'GET' }).reply(200, JSON.stringify({
      eventos: [{ eventoXmlGZipB64: b64gz('<evento n="1"/>') }, { eventoXmlGZipB64: b64gz('<evento n="2"/>') }],
    }), JSON_H)
    expect(await a.t.eventos(CHAVE_50)).toMatchObject({ classe: 'encontrada', eventosXml: ['<evento n="1"/>', '<evento n="2"/>'] })
    const b = mock()
    b.pool.intercept({ path: b.caminho(rota), method: 'GET' }).reply(404, '')
    expect((await b.t.eventos(CHAVE_50)).classe).toBe('nao-encontrada')
  })
})

describe('consultas', () => {
  it('HEAD /dps/{id}: 200 → encontrada, 404 → nao-encontrada', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(`/dps/${ID_DPS}`), method: 'HEAD' }).reply(200, '')
    expect(await a.t.existeDps(ID_DPS)).toMatchObject({ status: 200, classe: 'encontrada' })
    const b = mock()
    b.pool.intercept({ path: b.caminho(`/dps/${ID_DPS}`), method: 'HEAD' }).reply(404, '')
    expect(await b.t.existeDps(ID_DPS)).toMatchObject({ status: 404, classe: 'nao-encontrada' })
  })

  it('GET /dps/{id} → chave; 404 → nao-encontrada', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(`/dps/${ID_DPS}`), method: 'GET' }).reply(200, JSON.stringify({ chaveAcesso: CHAVE_50 }), JSON_H)
    expect(await a.t.chaveDaDps(ID_DPS)).toMatchObject({ classe: 'encontrada', chave: CHAVE_50 })
    const b = mock()
    b.pool.intercept({ path: b.caminho(`/dps/${ID_DPS}`), method: 'GET' }).reply(404, '')
    expect((await b.t.chaveDaDps(ID_DPS)).classe).toBe('nao-encontrada')
  })

  it('GET /nfse/{chave} → xml', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho(`/nfse/${CHAVE_50}`), method: 'GET' })
      .reply(200, JSON.stringify({ nfseXmlGZipB64: b64gz(XML_NFSE) }), JSON_H)
    expect(await t.nfse(CHAVE_50)).toMatchObject({ classe: 'encontrada', xml: XML_NFSE })
  })

  it('HEAD com 503 → transiente; com 403 → rejeitada', async () => {
    const a = mock()
    a.pool.intercept({ path: a.caminho(`/dps/${ID_DPS}`), method: 'HEAD' }).reply(503, '')
    expect((await a.t.existeDps(ID_DPS)).classe).toBe('transiente')
    const b = mock()
    b.pool.intercept({ path: b.caminho(`/dps/${ID_DPS}`), method: 'HEAD' }).reply(403, '')
    expect((await b.t.existeDps(ID_DPS)).classe).toBe('rejeitada')
  })
})

describe('nunca lança', () => {
  it('erro de rede do dispatcher → status 0, falha, com motivo', async () => {
    const { pool, t, caminho } = mock()
    pool.intercept({ path: caminho('/nfse'), method: 'POST' }).replyWithError(new Error('conexão caiu'))
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toContain('conexão caiu')
  })

  it('dispatcher que lança de forma síncrona → falha, sem lançar', async () => {
    const dispatcher = { dispatch() { throw new Error('quebrou') } } as unknown as Dispatcher
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, dispatcher })
    expect(await t.emitir('<DPS/>')).toMatchObject({ status: 0, classe: 'falha' })
    expect(await t.nfse(CHAVE_50)).toMatchObject({ status: 0, classe: 'falha' })
  })

  it('entrada que não é string → falha, sem lançar', async () => {
    const { t } = mock()
    expect((await t.emitir(undefined as unknown as string)).classe).toBe('falha')
  })
})

describe('baseUrl é só para teste', () => {
  it('sem dispatcher nem ca → falha com motivo, sem lançar', async () => {
    const t = criarTransporte({ ambiente: 'producao', certPem, keyPem, baseUrl: 'https://127.0.0.1:1' })
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toContain('baseUrl')
    expect((await t.existeDps(ID_DPS)).motivo).toContain('baseUrl')
  })

  it('baseUrl mal formada, mesmo com dispatcher → falha com motivo', async () => {
    const t = criarTransporte({ ambiente: 'producao', certPem, keyPem, dispatcher: new Contador(), baseUrl: 'isto não é url' })
    const r = await t.emitir('<DPS/>')
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toContain('baseUrl')
  })
})

describe('idDps e chave não chegam à URL sem validar', () => {
  const ruins = [
    'DPS/../../nfse', `${ID_DPS}/../x`, `${ID_DPS}?x=1`, `${ID_DPS}#`, `${ID_DPS}%2F`, ID_DPS.slice(0, 44), `${ID_DPS}0`,
    ID_DPS.toLowerCase(), '', ' ',
  ]
  it.each(ruins)('existeDps e chaveDaDps recusam %j sem enviar request', async (id) => {
    const { agent, t } = mock()
    expect(await t.existeDps(id)).toMatchObject({ status: 0, classe: 'falha' })
    expect((await t.chaveDaDps(id)).motivo).toBeTruthy()
    expect(agent.n).toBe(0)
  })

  const chavesRuins = [
    `${CHAVE_50}/../x`, `${CHAVE_50}?x`, CHAVE_50.slice(1), `${CHAVE_50}0`, '..', '', `A${CHAVE_50.slice(1)}`, '../'.padEnd(50, '1'),
  ]
  it.each(chavesRuins)('nfse, eventos e registrarEvento recusam %j sem enviar request', async (chave) => {
    const { agent, t } = mock('producao')
    expect((await t.nfse(chave)).classe).toBe('falha')
    expect((await t.eventos(chave)).classe).toBe('falha')
    expect((await t.registrarEvento(chave, '<p/>')).classe).toBe('falha')
    expect(agent.n).toBe(0)
  })

  it('alfanumérico só na restrita: o CNPJ com letra passa lá e é recusado na produção', async () => {
    const r = mock('producao-restrita')
    r.pool.intercept({ path: r.caminho(`/dps/${ID_DPS_LETRA}`), method: 'HEAD' }).reply(200, '')
    expect((await r.t.existeDps(ID_DPS_LETRA)).classe).toBe('encontrada')
    const p = mock('producao')
    expect((await p.t.existeDps(ID_DPS_LETRA)).classe).toBe('falha')
    expect(p.agent.n).toBe(0)
  })
})

describe('segredo não vaza no motivo', () => {
  it('erro do dispatcher cuja mensagem contém o PEM → motivo sem keyPem nem certPem', async () => {
    const dispatcher = { dispatch() { throw new Error(`falhou com ${keyPem} e ${certPem}`) } } as unknown as Dispatcher
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, dispatcher })
    const r = await t.emitir('<DPS/>')
    expect(r.classe).toBe('falha')
    const corpoChave = keyPem.split('\n').filter((l) => l && !l.startsWith('-----'))[0]!
    const corpoCert = certPem.split('\n').filter((l) => l && !l.startsWith('-----'))[0]!
    for (const s of [keyPem, certPem, corpoChave, corpoCert, 'PRIVATE KEY']) expect(r.motivo).not.toContain(s)
  })
})

// ---------- TLS contra servidor local de verdade (porta 0) ----------
describe('TLS', () => {
  const abertos: Server[] = []
  let servidorCert = ''
  let servidorKey = ''
  let outroCert = ''
  beforeAll(async () => {
    ;({ certPem: servidorCert, keyPem: servidorKey } = await gerarCertificado({ cn: 'localhost-teste', hash: 'SHA-256', ip: '127.0.0.1' }))
    ;({ certPem: outroCert } = await gerarCertificado({ cn: 'outra-ac', hash: 'SHA-256', ip: '127.0.0.1' }))
  })
  afterAll(async () => {
    await Promise.all(abertos.map((s) => new Promise<void>((ok) => { s.closeAllConnections(); s.close(() => ok()) })))
  })

  async function servidor(
    opcoes: Record<string, unknown>,
    tratar: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    const alpn: (string | false)[] = []
    const s = criarServidorHttps({ cert: servidorCert, key: servidorKey, ...opcoes }, tratar)
    s.on('secureConnection', (sock: TLSSocket) => alpn.push(sock.alpnProtocol))
    abertos.push(s)
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok))
    return { baseUrl: `https://127.0.0.1:${(s.address() as AddressInfo).port}`, alpn }
  }
  const responder201 = (_q: IncomingMessage, res: ServerResponse) => {
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end('{"chaveAcesso":"x"}')
  }

  it('ALPN: mesmo anunciando h2, o servidor vê http/1.1', async () => {
    const s = await servidor({ ALPNProtocols: ['h2', 'http/1.1'] }, responder201)
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, ca: servidorCert, baseUrl: s.baseUrl })
    const r = await t.emitir('<DPS/>')
    await t.fechar()
    expect(s.alpn).toEqual(['http/1.1'])
    expect(r).toMatchObject({ status: 201, classe: 'autorizada' })
  })

  it('servidor que só fala TLS 1.1 → status 0, falha', async () => {
    const s = await servidor({ minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT:@SECLEVEL=0' }, responder201)
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, ca: servidorCert, baseUrl: s.baseUrl })
    const r = await t.emitir('<DPS/>')
    await t.fechar()
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
  })

  it('servidor autoassinado fora do ca → status 0; com ca = o certificado dele → 2xx', async () => {
    const s = await servidor({}, responder201)
    const sem = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, ca: outroCert, baseUrl: s.baseUrl })
    expect(await sem.emitir('<DPS/>')).toMatchObject({ status: 0, classe: 'falha' })
    await sem.fechar()
    const com = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, ca: servidorCert, baseUrl: s.baseUrl })
    const r = await com.emitir('<DPS/>')
    await com.fechar()
    expect(r.status).toBe(201)
  })

  it('servidor que não responde dentro de timeoutMs → status 0 com motivo de tempo', async () => {
    const s = await servidor({}, () => { /* nunca responde */ })
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem, ca: servidorCert, baseUrl: s.baseUrl, timeoutMs: 200 })
    const inicio = Date.now()
    const r = await t.emitir('<DPS/>')
    await t.fechar()
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toMatch(/tempo/i)
    expect(Date.now() - inicio).toBeLessThan(5000)
  })

  it('chave privada inválida no transporte → status 0 e o PEM não aparece no motivo', async () => {
    const s = await servidor({}, responder201)
    const chaveRuim = '-----BEGIN PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\n-----END PRIVATE KEY-----\n'
    const t = criarTransporte({ ambiente: 'producao-restrita', certPem, keyPem: chaveRuim, ca: servidorCert, baseUrl: s.baseUrl })
    const r = await t.emitir('<DPS/>')
    await t.fechar()
    expect(r).toMatchObject({ status: 0, classe: 'falha' })
    expect(r.motivo).toBeTruthy()
    for (const s2 of [chaveRuim, 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo', 'BEGIN PRIVATE KEY', certPem.split('\n')[1]!]) {
      expect(r.motivo).not.toContain(s2)
    }
  })
})
