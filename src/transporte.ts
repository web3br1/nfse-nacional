// Transporte mTLS para a API da Sefin Nacional e classificação da resposta.
// regra: T0.1 itens 1, 2, 3 e 10 (G0 Q1, Q2, Q6, Q7) · cerca: test/transporte.test.ts
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
const CAMPO_CHAVE_RESPOSTA = 'chaveAcesso'

// T0.1 item 3 (E0014, firme) e Q6 (a): o transporte não decide se foi o mesmo evento.
const COD_DUPLICIDADE = 'E0014'
const COD_EVENTO_JA_REGISTRADO = new Set(['E0802', 'E0840', 'E0845'])
// T0.1 item 2 não acrescentou código; E1217 e E1206 vêm da open-nfse (R15).
const COD_TRANSIENTES = new Set(['E1217', 'E1206'])

const TIMEOUT_PADRAO_MS = 30_000

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
  /** Padrão 30 000 ms. */
  timeoutMs?: number
  /** Para teste: substitui o `Agent` mTLS. */
  dispatcher?: Dispatcher
  /**
   * SÓ PARA TESTE. Substitui `BASE[ambiente]` e é aceita apenas junto de `dispatcher` ou `ca`;
   * sem eles toda chamada devolve `classe: 'falha'` com `motivo`, sem lançar.
   */
  baseUrl?: string
}

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
  /** Fecha o `Agent` que o transporte criou (não toca num `dispatcher` recebido). */
  fechar(): Promise<void>
}

/** Recusa por entrada ou configuração inválida: vira `falha` com a mensagem, sem request. */
class Recusa extends Error {}

const vazia = (status: number, classe: Classe, motivo?: string): Resposta => ({
  status, classe, codigos: [], mensagens: [], ...(motivo !== undefined ? { motivo } : {}),
})

const eObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function lerJson(texto: string): unknown {
  try { return JSON.parse(texto) } catch { return undefined }
}

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
      const cod = it.codigo ?? it.Codigo
      const desc = it.descricao ?? it.Descricao
      if (typeof cod === 'string' && cod.trim() !== '' && !codigos.includes(cod.trim())) {
        codigos.push(cod.trim())
        if (typeof desc === 'string') mensagens.push(desc)
      }
    }
  }
  return { codigos, mensagens }
}

const descompactar = (b64: string): string => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')
const gzipB64 = (texto: string): string => gzipSync(Buffer.from(texto, 'utf8')).toString('base64')

export function criarTransporte(o: OpcoesTransporte): Transporte {
  let agentProprio: Agent | undefined
  const timeoutMs = o.timeoutMs ?? TIMEOUT_PADRAO_MS

  /** Tira do texto qualquer trecho do certificado ou da chave (e qualquer bloco PEM). */
  const limpar = (texto: string): string => {
    let t = texto
    for (const segredo of [o.keyPem, o.certPem]) {
      if (typeof segredo !== 'string' || segredo.length === 0) continue
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
    agentProprio ??= new Agent({
      allowH2: false,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connect: {
        cert: o.certPem,
        key: o.keyPem,
        ...(o.ca !== undefined ? { ca: o.ca } : {}),
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    })
    return agentProprio
  }

  function base(): string {
    if (o.baseUrl === undefined) return BASE[o.ambiente]
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
    const re = o.ambiente === 'producao' ? ID_DPS_PRODUCAO : ID_DPS_RESTRITA
    if (typeof id !== 'string' || !re.test(id)) throw new Recusa('idDps fora do formato (DPS + 42 caracteres)')
    return id
  }

  function validarChave(chave: unknown): string {
    try {
      if (typeof chave !== 'string') throw new RangeError('chave')
      idPedidoEvento({ chave, tipo: '000000' }, { chaveAlfanumerica: o.ambiente === 'producao-restrita' })
    } catch {
      throw new Recusa('chave fora do formato (50 caracteres)')
    }
    return chave as string
  }

  /** Status que não é sucesso, sem semântica própria: 3xx falha, 4xx rejeitada, 5xx transiente. */
  function porStatus(status: number, texto: string): Resposta {
    const { codigos, mensagens } = extrairErros(lerJson(texto))
    const classe: Classe = status >= 500 ? 'transiente' : status >= 400 ? 'rejeitada' : 'falha'
    const r: Resposta = { status, classe, codigos, mensagens }
    if (codigos.length === 0 || classe === 'falha') r.motivo = `status HTTP ${status} sem tratamento específico`
    return r
  }

  /**
   * Erro de POST (status fora de 2xx). Prioridade quando o corpo traz vários códigos:
   * duplicidade (só emissão) > evento-ja-registrado (só evento) > rejeitada se algum código
   * não é transiente > transiente. Todos os códigos ficam em `codigos`.
   */
  function erroDePost(status: number, texto: string, tipo: 'emissao' | 'evento'): Resposta {
    if (status < 400) return porStatus(status, texto)
    const { codigos, mensagens } = extrairErros(lerJson(texto))
    let classe: Classe
    if (tipo === 'emissao' && codigos.includes(COD_DUPLICIDADE)) classe = 'duplicidade'
    else if (tipo === 'evento' && codigos.some((c) => COD_EVENTO_JA_REGISTRADO.has(c))) classe = 'evento-ja-registrado'
    else if (codigos.length > 0) classe = codigos.every((c) => COD_TRANSIENTES.has(c)) ? 'transiente' : 'rejeitada'
    else classe = status >= 500 ? 'transiente' : 'rejeitada'
    const r: Resposta = { status, classe, codigos, mensagens }
    if (codigos.length === 0) r.motivo = `status HTTP ${status} sem código de erro legível`
    return r
  }

  /** Sucesso com XML: JSON com o XML em gzip+base64 (hipótese) ou o XML puro no corpo. */
  function comXml(status: number, texto: string, classe: Classe): Resposta {
    const corpo = lerJson(texto)
    try {
      if (eObjeto(corpo)) {
        const r = vazia(status, classe)
        const x = corpo[CAMPO_NFSE_RESPOSTA]
        if (typeof x === 'string') r.xml = descompactar(x)
        const c = corpo[CAMPO_CHAVE_RESPOSTA] ?? corpo.ChaveAcesso
        if (typeof c === 'string') r.chave = c
        return r
      }
    } catch (e) {
      return vazia(status, 'falha', `corpo 2xx ilegível: ${motivoDe(e)}`)
    }
    if (texto.trimStart().startsWith('<')) return { ...vazia(status, classe), xml: texto }
    // 2xx ilegível: a nota pode existir; transiente manda o chamador reconciliar por existeDps.
    return vazia(status, 'transiente', 'corpo da resposta não é JSON nem XML')
  }

  async function enviar(
    metodo: 'GET' | 'HEAD' | 'POST', caminho: string, corpo?: string,
  ): Promise<{ status: number; texto: string }> {
    const res = await request(base() + caminho, {
      method: metodo,
      dispatcher: dispatcher(),
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(corpo !== undefined ? { body: corpo } : {}),
    })
    return { status: res.statusCode, texto: await res.body.text() }
  }

  /** Converte qualquer exceção em `Resposta`: o transporte nunca lança. */
  async function seguro<T extends Resposta>(f: () => Promise<T | Resposta>): Promise<T | Resposta> {
    try {
      return await f()
    } catch (e) {
      return vazia(0, 'falha', e instanceof Recusa ? e.message : motivoDe(e))
    }
  }

  const ok = (status: number) => status >= 200 && status < 300

  return {
    emitir: (dpsAssinada) => seguro(async () => {
      if (typeof dpsAssinada !== 'string') throw new Recusa('dpsAssinada deve ser texto')
      const { status, texto } = await enviar('POST', '/nfse', JSON.stringify({ [CAMPO_DPS]: gzipB64(dpsAssinada) }))
      return ok(status) ? comXml(status, texto, 'autorizada') : erroDePost(status, texto, 'emissao')
    }),

    existeDps: (idDps) => seguro(async () => {
      const { status, texto } = await enviar('HEAD', `/dps/${validarIdDps(idDps)}`)
      if (ok(status)) return vazia(status, 'encontrada')
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    chaveDaDps: (idDps) => seguro(async () => {
      const { status, texto } = await enviar('GET', `/dps/${validarIdDps(idDps)}`)
      if (ok(status)) {
        const corpo = lerJson(texto)
        const c = eObjeto(corpo) ? (corpo[CAMPO_CHAVE_RESPOSTA] ?? corpo.ChaveAcesso) : undefined
        return typeof c === 'string'
          ? { ...vazia(status, 'encontrada'), chave: c }
          : vazia(status, 'transiente', 'resposta sem chave de acesso legível')
      }
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    nfse: (chave) => seguro(async () => {
      const { status, texto } = await enviar('GET', `/nfse/${validarChave(chave)}`)
      if (ok(status)) {
        const r = comXml(status, texto, 'encontrada')
        return r.classe === 'encontrada' && r.xml === undefined ? vazia(status, 'transiente', 'resposta sem XML da NFS-e') : r
      }
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    registrarEvento: (chave, pedidoAssinado) => seguro(async () => {
      const c = validarChave(chave)
      if (typeof pedidoAssinado !== 'string') throw new Recusa('pedidoAssinado deve ser texto')
      const { status, texto } = await enviar('POST', `/nfse/${c}/eventos`, JSON.stringify({ [CAMPO_EVENTO]: gzipB64(pedidoAssinado) }))
      return ok(status) ? vazia(status, 'evento-registrado') : erroDePost(status, texto, 'evento')
    }),

    eventos: (chave) => seguro(async () => {
      const { status, texto } = await enviar('GET', `/nfse/${validarChave(chave)}/eventos`)
      if (ok(status)) {
        const corpo = lerJson(texto)
        const lista = eObjeto(corpo) && Array.isArray(corpo.eventos) ? corpo.eventos : []
        const eventosXml: string[] = []
        for (const ev of lista) {
          const campo = eObjeto(ev) ? Object.entries(ev).find(([k, v]) => /XmlGZipB64$/i.test(k) && typeof v === 'string') : undefined
          if (campo) eventosXml.push(descompactar(campo[1] as string))
        }
        return { ...vazia(status, 'encontrada'), eventosXml }
      }
      return status === 404 ? vazia(status, 'nao-encontrada') : porStatus(status, texto)
    }),

    fechar: async () => {
      const a = agentProprio
      agentProprio = undefined
      try { await a?.close() } catch { /* nada a fechar */ }
    },
  }
}
