// Transporte mTLS para a API da Sefin Nacional e classificação da resposta.
// regra: T0.1 itens 1, 2, 3 e 10 (G0 Q1, Q2, Q6, Q7) · cerca: test/transporte.test.ts, test/transporte-r1.test.ts
import { Agent, request, type Dispatcher } from 'undici'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Ambiente } from './entrada.js'
import { idPedidoEvento } from './id.js'

export type Classe = 'autorizada' | 'rejeitada' | 'duplicidade' | 'transiente' | 'encontrada' | 'nao-encontrada'
  | 'evento-registrado' | 'evento-ja-registrado' | 'falha'

export type Resposta = {
  status: number
  classe: Classe
  codigos: string[]
  mensagens: string[]
  xml?: string
  chave?: string
  motivo?: string
}

// G0 Q1: a confirmar na T6.1
export const BASE: Record<Ambiente, string> = {
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
  'producao-restrita': 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
}

// hipótese G0 Q2 (open-nfse): a confirmar na T6.1
export const CAMPO_DPS = 'dpsXmlGZipB64'
// hipótese G0 Q2 (open-nfse): a confirmar na T6.1
export const CAMPO_EVENTO = 'pedidoRegistroEventoXmlGZipB64'
// hipótese G0 Q2 (open-nfse): campos da resposta de sucesso; a confirmar na T6.1
const CAMPO_NFSE_RESPOSTA = 'nfseXmlGZipB64'
const CAMPO_EVENTO_RESPOSTA = 'eventoXmlGZipB64'
const CAMPO_CHAVE_RESPOSTA = 'chaveAcesso'

// Raiz do XML que prova o estado final (hipótese, a confirmar na T6.1): NFS-e e evento.
const RAIZ_NFSE = /^\s*(?:<\?xml[^>]*\?>\s*)?<NFSe[\s>/]/
const RAIZ_EVENTO = /^\s*(?:<\?xml[^>]*\?>\s*)?<(?:evento|procEvento\w*)[\s>/]/

// T0.1 item 3 (E0014, firme) e Q6 (a): o transporte não decide se foi o mesmo evento.
const COD_DUPLICIDADE = 'E0014'
const COD_EVENTO_JA_REGISTRADO = new Set(['E0802', 'E0840', 'E0845'])
// T0.1 item 2 não acrescentou código; E1217 e E1206 vêm da open-nfse (R15).
const COD_TRANSIENTES = new Set(['E1217', 'E1206'])

const TIMEOUT_PADRAO_MS = 30_000
const TIMEOUT_MAX_MS = 2 ** 31 - 1
/** Teto de leitura do corpo e da saída do gunzip. */
const TETO_BYTES = 10 * 1024 * 1024

// Id da DPS: DPS + IBGE(7) + tpInsc(1) + inscrição(14) + série(5) + nDPS(15) = 45 (src/id.ts).
const ID_DPS_PRODUCAO = /^DPS\d{42}$/
// Na restrita o CNPJ (tpInsc 2) admite letra (G0 Q4 (a)).
const ID_DPS_RESTRITA = /^DPS\d{7}(?:1\d{14}|2[0-9A-Z]{14})\d{20}$/

export interface OpcoesTransporte {
  ambiente: Ambiente
  certPem: string
  keyPem: string
  /** Cadeia a confiar além da lista padrão do Node. Passada ao `Agent` só quando presente. */
  ca?: string
  /** Inteiro de 1 a 2^31-1. Padrão 30 000 ms. Fora disso, toda chamada devolve `falha`. */
  timeoutMs?: number
  /** Para teste: substitui o `Agent` mTLS. */
  dispatcher?: Dispatcher
  /**
   * SÓ PARA TESTE. Substitui `BASE[ambiente]` e é aceita apenas junto de `dispatcher` ou `ca`;
   * sem eles toda chamada devolve `classe: 'falha'` com `motivo`, sem lançar.
   */
  baseUrl?: string
}

/**
 * Nenhum método lança: toda exceção vira `Resposta`. Um estado final (`autorizada`,
 * `evento-registrado`, `rejeitada`) só sai com prova (XML esperado, ou código); na dúvida a
 * classe é `transiente` ou `falha`.
 *
 * `falha` ou `transiente` no `emitir` (inclusive `status: 0`) pode acontecer DEPOIS de a Sefin
 * ter aceitado a DPS: o chamador reconcilia por `existeDps`/`chaveDaDps` antes de reenviar.
 *
 * `mensagens` traz a `descricao` crua da Sefin e pode conter dado pessoal: registre em log só
 * `codigos`, `status` e `classe`.
 */
export interface Transporte {
  /** POST /nfse */
  emitir(dpsAssinada: string): Promise<Resposta>
  /** HEAD /dps/{id}: `encontrada` | `nao-encontrada` */
  existeDps(idDps: string): Promise<Resposta>
  /** GET /dps/{id}: a chave */
  chaveDaDps(idDps: string): Promise<Resposta>
  /** GET /nfse/{chave}: o xml */
  nfse(chave: string): Promise<Resposta>
  /** POST /nfse/{chave}/eventos */
  registrarEvento(chave: string, pedidoAssinado: string): Promise<Resposta>
  /** GET /nfse/{chave}/eventos */
  eventos(chave: string): Promise<Resposta & { eventosXml?: string[] }>
  /** Fecha o `Agent` que o transporte criou. Terminal: depois dele toda chamada dá `falha`. */
  fechar(): Promise<void>
}

/** Recusa por entrada ou configuração inválida: vira `falha` com a mensagem, sem request. */
class Recusa extends Error {}
/** Corpo ou saída do gunzip acima do teto. */
class Excedeu extends Error {}

const vazia = (status: number, classe: Classe, motivo?: string): Resposta => ({
  status, classe, codigos: [], mensagens: [], ...(motivo !== undefined ? { motivo } : {}),
})

const eObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function lerJson(texto: string): unknown {
  try { return JSON.parse(texto) } catch { return undefined }
}

/** Código de erro da Sefin: letra e 4 dígitos (todos os da T0.1 são E + 4 dígitos). */
const PADRAO_CODIGO = /^[A-Z]\d{4}$/
const normalizar = (c: unknown): string => String(c).trim().toUpperCase()

/** `erros` ou `erro`, em lista ou objeto, camelCase ou PascalCase; une sem duplicar (G0 Q2). */
function extrairErros(corpo: unknown): { codigos: string[]; mensagens: string[] } {
  const codigos: string[] = []
  const mensagens: string[] = []
  if (!eObjeto(corpo)) return { codigos, mensagens }
  for (const campo of ['erros', 'Erros', 'erro', 'Erro']) {
    const v = corpo[campo]
    const itens = Array.isArray(v) ? v : v === undefined ? [] : [v]
    for (const it of itens) {
      if (!eObjeto(it)) continue
      const bruto = [it.codigo, it.Codigo].find((c) => (typeof c === 'string' && c.trim() !== '') || typeof c === 'number')
      if (bruto === undefined) continue
      const cod = normalizar(bruto)
      if (!PADRAO_CODIGO.test(cod)) {
        mensagens.push(String(bruto)) // fora do padrão da Sefin: não classifica, só informa
        continue
      }
      if (!codigos.includes(cod)) {
        codigos.push(cod)
        const desc = it.descricao || it.Descricao
        if (typeof desc === 'string') mensagens.push(desc)
      }
    }
  }
  return { codigos, mensagens }
}

function descompactar(b64: string): string {
  try {
    return gunzipSync(Buffer.from(b64, 'base64'), { maxOutputLength: TETO_BYTES }).toString('utf8')
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE') throw new Excedeu('XML descomprimido acima do teto')
    throw e
  }
}
const gzipB64 = (texto: string): string => gzipSync(Buffer.from(texto, 'utf8')).toString('base64')

function chaveValida(chave: unknown, ambiente: Ambiente): chave is string {
  try {
    if (typeof chave !== 'string') return false
    idPedidoEvento({ chave, tipo: '000000' }, { chaveAlfanumerica: ambiente === 'producao-restrita' })
    return true
  } catch {
    return false
  }
}

/** As opções do `Agent` mTLS; exportada para a cerca afirmar cada valor fixado. */
export function opcoesDoAgent(o: Pick<OpcoesTransporte, 'certPem' | 'keyPem' | 'ca' | 'timeoutMs'>) {
  const timeoutMs = o.timeoutMs ?? TIMEOUT_PADRAO_MS
  return {
    allowH2: false,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connect: {
      cert: o.certPem,
      key: o.keyPem,
      ...(o.ca !== undefined ? { ca: o.ca } : {}),
      minVersion: 'TLSv1.2' as const,
      rejectUnauthorized: true,
    },
  }
}

export function criarTransporte(entrada: OpcoesTransporte): Transporte {
  const o = (typeof entrada === 'object' && entrada !== null ? entrada : {}) as Partial<OpcoesTransporte>
  let agentProprio: Agent | undefined
  let fechado = false
  const timeoutMs = o.timeoutMs ?? TIMEOUT_PADRAO_MS
  const ambiente = o.ambiente as Ambiente

  /** Motivo de a configuração não servir; vazio se serve. Checado em toda chamada. */
  const erroDeConfig = (): string | undefined => {
    if (typeof entrada !== 'object' || entrada === null) return 'opções do transporte ausentes ou inválidas'
    if (ambiente !== 'producao' && ambiente !== 'producao-restrita') return 'ambiente inválido'
    if (o.dispatcher === undefined && (typeof o.certPem !== 'string' || o.certPem === '' || typeof o.keyPem !== 'string' || o.keyPem === '')) {
      return 'certPem e keyPem são obrigatórios'
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MAX_MS) {
      return 'timeoutMs deve ser inteiro de 1 a 2147483647'
    }
    return undefined
  }

  /** Tira do texto qualquer trecho do certificado ou da chave (e qualquer bloco PEM). */
  const limpar = (texto: string): string => {
    let t = texto
    for (const segredo of [o.keyPem, o.certPem]) {
      if (typeof segredo !== 'string' || segredo.length < 8) continue
      t = t.split(segredo).join('[pem]')
      for (const linha of segredo.split(/\r?\n/)) if (linha.length >= 8) t = t.split(linha).join('[pem]')
    }
    t = t.replace(/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, '[pem]')
    return t.length > 300 ? `${t.slice(0, 300)}…` : t
  }

  const motivoDe = (e: unknown): string => {
    const err = e as { name?: string; code?: string; message?: string; cause?: { code?: string } }
    const codigo = err?.code ?? err?.cause?.code
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || (typeof codigo === 'string' && /TIMEOUT/.test(codigo))) {
      return `tempo esgotado (${timeoutMs} ms)`
    }
    const msg = typeof err?.message === 'string' ? err.message : String(e)
    return limpar(codigo ? `${codigo}: ${msg}` : msg)
  }

  function dispatcher(): Dispatcher {
    if (o.dispatcher) return o.dispatcher
    agentProprio ??= new Agent(opcoesDoAgent(o as OpcoesTransporte))
    return agentProprio
  }

  function base(): string {
    if (o.baseUrl === undefined) return BASE[ambiente]
    if (o.dispatcher === undefined && o.ca === undefined) {
      throw new Recusa('baseUrl só é aceita junto de dispatcher ou ca (é para teste)')
    }
    try {
      const u = new URL(o.baseUrl)
      return u.origin + u.pathname.replace(/\/+$/, '')
    } catch {
      throw new Recusa('baseUrl mal formada')
    }
  }

  function validarIdDps(id: unknown): string {
    const re = ambiente === 'producao' ? ID_DPS_PRODUCAO : ID_DPS_RESTRITA
    if (typeof id !== 'string' || !re.test(id)) throw new Recusa('idDps fora do formato (DPS + 42 caracteres)')
    return id
  }

  function validarChave(chave: unknown): string {
    if (!chaveValida(chave, ambiente)) throw new Recusa('chave fora do formato (50 caracteres)')
    return chave
  }

  /**
   * Status sem semântica própria, sem código legível: 3xx falha; 408/429 e 5xx transiente;
   * demais 4xx falha (rejeitada exige código).
   */
  function semCodigo(status: number, mensagens: string[] = []): Resposta {
    const classe: Classe = status >= 500 || status === 408 || status === 429 ? 'transiente' : 'falha'
    return { ...vazia(status, classe, `status HTTP ${status} sem código de erro legível`), mensagens }
  }

  /** Resposta não 2xx de GET/HEAD. */
  function porStatus(status: number, texto: string): Resposta {
    const { codigos, mensagens } = extrairErros(lerJson(texto))
    if (codigos.length === 0 || status < 400) return semCodigo(status, mensagens)
    const classe: Classe = status >= 500 || status === 408 || status === 429 ? 'transiente' : 'rejeitada'
    return { status, classe, codigos, mensagens }
  }

  /**
   * Erro de POST (status fora de 2xx). Prioridade quando o corpo traz vários códigos:
   * duplicidade (só emissão) > evento-ja-registrado (só evento) > rejeitada se algum código
   * não é transiente > transiente. Todos os códigos ficam em `codigos`.
   */
  function erroDePost(status: number, texto: string, tipo: 'emissao' | 'evento'): Resposta {
    if (status < 400) return semCodigo(status)
    const { codigos, mensagens } = extrairErros(lerJson(texto))
    // E0014 em qualquer lugar do texto (envelope que a extração não conhece) ainda é duplicidade.
    if (tipo === 'emissao' && codigos.length === 0 && /\bE0014\b/i.test(texto)) codigos.push(COD_DUPLICIDADE)
    let classe: Classe
    if (tipo === 'emissao' && codigos.includes(COD_DUPLICIDADE)) classe = 'duplicidade'
    else if (tipo === 'evento' && codigos.some((c) => COD_EVENTO_JA_REGISTRADO.has(c))) classe = 'evento-ja-registrado'
    else if (codigos.length > 0 && (status >= 500 || status === 408 || status === 429)) classe = 'transiente'
    else if (codigos.length > 0) classe = codigos.every((c) => COD_TRANSIENTES.has(c)) ? 'transiente' : 'rejeitada'
    else return semCodigo(status, mensagens)
    return { status, classe, codigos, mensagens }
  }

  /** 2xx que não prova o estado final: transiente, com os códigos que houver e um motivo. */
  function duvida(status: number, texto: string, motivo: string): Resposta {
    const { codigos, mensagens } = extrairErros(lerJson(texto))
    return { status, classe: 'transiente', codigos, mensagens, motivo }
  }

  /**
   * 2xx com XML: JSON com o XML em gzip+base64 (hipótese) ou o XML puro no corpo. O estado final
   * só sai se o XML tem a raiz esperada; senão `transiente`.
   */
  function comXml(status: number, texto: string, classe: Classe, campoXml: string, raiz: RegExp, nomeRaiz: string): Resposta {
    try {
      const corpo = lerJson(texto)
      let xml: string | undefined
      let chave: unknown
      if (eObjeto(corpo)) {
        const x = corpo[campoXml]
        if (typeof x === 'string') xml = descompactar(x)
        chave = corpo[CAMPO_CHAVE_RESPOSTA] ?? corpo.ChaveAcesso
      } else if (texto.trimStart().startsWith('<') || texto.startsWith('﻿')) {
        xml = texto
      }
      if (xml === undefined || !raiz.test(xml.replace(/^﻿/, ''))) return duvida(status, texto, `2xx sem o XML esperado (raiz ${nomeRaiz})`)
      if (chave !== undefined && !chaveValida(chave, ambiente)) return duvida(status, texto, 'chave de acesso da resposta fora do formato')
      return { ...vazia(status, classe), xml, ...(typeof chave === 'string' ? { chave } : {}) }
    } catch (e) {
      if (e instanceof Excedeu) return duvida(status, '', e.message)
      return vazia(status, 'falha', `corpo 2xx ilegível: ${motivoDe(e)}`)
    }
  }

  async function lerCorpo(res: Dispatcher.ResponseData): Promise<{ texto: string; excedeu: boolean }> {
    const partes: Buffer[] = []
    let total = 0
    for await (const parte of res.body) {
      const b = Buffer.isBuffer(parte) ? parte : Buffer.from(parte as Uint8Array)
      total += b.length
      if (total > TETO_BYTES) {
        res.body.destroy()
        return { texto: '', excedeu: true }
      }
      partes.push(b)
    }
    return { texto: Buffer.concat(partes).toString('utf8'), excedeu: false }
  }

  async function enviar(
    metodo: 'GET' | 'HEAD' | 'POST', caminho: string, corpo?: string,
  ): Promise<{ status: number; texto: string; excedeu: boolean }> {
    const res = await request(base() + caminho, {
      method: metodo,
      dispatcher: dispatcher(),
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(corpo !== undefined ? { body: corpo } : {}),
    })
    return { status: res.statusCode, ...(await lerCorpo(res)) }
  }

  /** Converte qualquer exceção em `Resposta`: o transporte nunca lança. */
  async function seguro<T extends Resposta>(f: () => Promise<T | Resposta>): Promise<T | Resposta> {
    try {
      if (fechado) return vazia(0, 'falha', 'transporte fechado')
      const erro = erroDeConfig()
      if (erro) return vazia(0, 'falha', erro)
      return await f()
    } catch (e) {
      return vazia(0, 'falha', e instanceof Recusa ? e.message : motivoDe(e))
    }
  }

  const ok = (status: number) => status >= 200 && status < 300
  const acimaDoTeto = (status: number) => vazia(status, 'transiente', 'corpo da resposta acima do teto de tamanho')

  return {
    emitir: (dpsAssinada) => seguro(async () => {
      if (typeof dpsAssinada !== 'string') throw new Recusa('dpsAssinada deve ser texto')
      const { status, texto, excedeu } = await enviar('POST', '/nfse', JSON.stringify({ [CAMPO_DPS]: gzipB64(dpsAssinada) }))
      if (ok(status)) return excedeu ? acimaDoTeto(status) : comXml(status, texto, 'autorizada', CAMPO_NFSE_RESPOSTA, RAIZ_NFSE, 'NFSe')
      return erroDePost(status, texto, 'emissao')
    }),

    existeDps: (idDps) => seguro(async () => {
      const { status, texto } = await enviar('HEAD', `/dps/${validarIdDps(idDps)}`)
      if (ok(status)) return vazia(status, 'encontrada')
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    chaveDaDps: (idDps) => seguro(async () => {
      const { status, texto, excedeu } = await enviar('GET', `/dps/${validarIdDps(idDps)}`)
      if (ok(status)) {
        if (excedeu) return acimaDoTeto(status)
        const corpo = lerJson(texto)
        const c = eObjeto(corpo) ? (corpo[CAMPO_CHAVE_RESPOSTA] ?? corpo.ChaveAcesso) : undefined
        return chaveValida(c, ambiente)
          ? { ...vazia(status, 'encontrada'), chave: c }
          : vazia(status, 'transiente', 'resposta sem chave de acesso válida')
      }
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    nfse: (chave) => seguro(async () => {
      const { status, texto, excedeu } = await enviar('GET', `/nfse/${validarChave(chave)}`)
      if (ok(status)) return excedeu ? acimaDoTeto(status) : comXml(status, texto, 'encontrada', CAMPO_NFSE_RESPOSTA, RAIZ_NFSE, 'NFSe')
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    registrarEvento: (chave, pedidoAssinado) => seguro(async () => {
      const c = validarChave(chave)
      if (typeof pedidoAssinado !== 'string') throw new Recusa('pedidoAssinado deve ser texto')
      const { status, texto, excedeu } = await enviar('POST', `/nfse/${c}/eventos`, JSON.stringify({ [CAMPO_EVENTO]: gzipB64(pedidoAssinado) }))
      if (ok(status)) {
        return excedeu ? acimaDoTeto(status) : comXml(status, texto, 'evento-registrado', CAMPO_EVENTO_RESPOSTA, RAIZ_EVENTO, 'evento')
      }
      return erroDePost(status, texto, 'evento')
    }),

    eventos: (chave) => seguro(async () => {
      const { status, texto, excedeu } = await enviar('GET', `/nfse/${validarChave(chave)}/eventos`)
      if (ok(status)) {
        if (excedeu) return acimaDoTeto(status)
        const corpo = lerJson(texto)
        if (!eObjeto(corpo) || !Array.isArray(corpo.eventos)) return vazia(status, 'transiente', 'resposta sem a lista de eventos')
        const eventosXml: string[] = []
        try {
          for (const ev of corpo.eventos) {
            const campo = eObjeto(ev) ? Object.entries(ev).find(([k, v]) => /XmlGZipB64$/i.test(k) && typeof v === 'string') : undefined
            const xml = campo ? descompactar(campo[1] as string) : undefined
            if (xml === undefined || !RAIZ_EVENTO.test(xml)) return vazia(status, 'transiente', 'item da lista sem XML de evento (raiz evento)')
            eventosXml.push(xml)
          }
        } catch (e) {
          if (e instanceof Excedeu) return vazia(status, 'transiente', e.message)
          throw e
        }
        return { ...vazia(status, 'encontrada'), eventosXml }
      }
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    fechar: async () => {
      fechado = true
      const a = agentProprio
      agentProprio = undefined
      try { await a?.close() } catch { /* nada a fechar */ }
    },
  }
}
