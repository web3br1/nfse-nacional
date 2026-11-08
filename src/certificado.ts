// Inspirado em Luminaris@519676ab server/src/lib/nfeSignature.ts: readTlv/children (:66-90), OIDs e OTHERNAME_TAGS
// (:92-96), icpNumber (:119-121) e readCertFacts (:123-156). Adaptações: lança → { ok: false, motivo };
// validade pelo X509Certificate do node:crypto em vez de reslice do DER (data e hora, não só o dia); sem a
// conferência titular × emitente e sem cadeia ICP-Brasil (nem o Luminaris monta a cadeia): só LÊ o certificado.
// regra: DOC-ICP-04 7.1.2.2 (otherName 2.16.76.1.3.3 = CNPJ, 2.16.76.1.3.1 = CPF) · cerca: test/certificado.test.ts
import { X509Certificate } from 'node:crypto'

export type ResultadoCertificado =
  | { ok: true; cnpj: string | null; cpf: string | null; validoDe: string; validoAte: string; vencido: boolean }
  | { ok: false; motivo: string }

class Ilegivel extends Error {}

interface Tlv { tag: number; start: number; end: number }

function lerTlv(buf: Buffer, off: number, limite: number): Tlv {
  if (off + 2 > limite) throw new Ilegivel('DER truncado')
  const tag = buf[off]
  let len = buf[off + 1]
  let start = off + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n < 1 || n > 3 || start + n > limite) throw new Ilegivel('comprimento DER')
    len = 0
    for (let i = 0; i < n; i++) len = (len << 8) | buf[start + i]
    start += n
  }
  if (start + len > limite) throw new Ilegivel('DER truncado')
  return { tag, start, end: start + len }
}

function filhos(buf: Buffer, pai: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let off = pai.start; off < pai.end; ) {
    const t = lerTlv(buf, off, pai.end)
    out.push(t)
    off = t.end
  }
  return out
}

const OID_SAN = '551d11' // 2.5.29.17
const OID_ICP_CPF = '604c010301' // 2.16.76.1.3.1
const OID_ICP_CNPJ = '604c010303' // 2.16.76.1.3.3
const OTHERNAME_TAGS = new Set([0x04, 0x13]) // OCTET STRING ou PrintableString, nenhum outro

// DOC-ICP-04 7.1.2.2 (b): número indisponível vem preenchido com zero; todo-zero é ausência, não um documento.
const numeroIcp = (cru: string, padrao: RegExp): string | null => (padrao.test(cru) && !/^0+$/.test(cru) ? cru : null)

function documentosDoSan(der: Buffer): { cnpj: string | null; cpf: string | null } {
  let cnpj: string | null = null
  let cpf: string | null = null
  const cert = lerTlv(der, 0, der.length)
  const tbs = filhos(der, cert)[0]
  if (!tbs) throw new Ilegivel('certificado sem tbsCertificate')
  const extEnvoltorio = filhos(der, tbs).find((f) => f.tag === 0xa3)
  const extensoes = extEnvoltorio ? filhos(der, filhos(der, extEnvoltorio)[0]) : []
  for (const ext of extensoes) {
    const partes = filhos(der, ext)
    if (der.toString('hex', partes[0].start, partes[0].end) !== OID_SAN) continue
    const octeto = partes[partes.length - 1]
    for (const nome of filhos(der, lerTlv(der, octeto.start, octeto.end))) {
      if (nome.tag !== 0xa0) continue // só otherName
      const [tipo, embrulho] = filhos(der, nome)
      if (!tipo || !embrulho) continue
      const valor = filhos(der, embrulho)[0]
      if (!valor || !OTHERNAME_TAGS.has(valor.tag)) continue
      const cru = der.toString('latin1', valor.start, valor.end)
      const oid = der.toString('hex', tipo.start, tipo.end)
      if (oid === OID_ICP_CNPJ) cnpj = numeroIcp(cru, /^[A-Z0-9]{14}$/)
      // 2.16.76.1.3.1 = nascimento (ddmmaaaa, 8) + CPF (11) + NIS + RG...; o CPF do responsável (2.16.76.1.3.4) NÃO é lido.
      if (oid === OID_ICP_CPF) cpf = /^[A-Z0-9]+$/.test(cru) ? numeroIcp(cru.slice(8, 19), /^\d{11}$/) : null
    }
  }
  return { cnpj, cpf }
}

/**
 * Lê CNPJ/CPF do titular (otherName ICP-Brasil no SAN) e a validade. Nunca lança.
 * `vencido` = `agora` depois do instante exato de `validoAte` (no próprio instante ainda vale). Não confere cadeia.
 */
export function lerCertificado(certPem: string, agora: Date = new Date()): ResultadoCertificado {
  try {
    if (typeof certPem !== 'string' || certPem.trim() === '') return { ok: false, motivo: 'certificado vazio' }
    if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) return { ok: false, motivo: 'data de referência inválida' }
    const cert = new X509Certificate(certPem)
    const { cnpj, cpf } = documentosDoSan(cert.raw)
    return {
      ok: true, cnpj, cpf,
      validoDe: cert.validFromDate.toISOString(),
      validoAte: cert.validToDate.toISOString(),
      vencido: agora.getTime() > cert.validToDate.getTime(),
    }
  } catch (e) {
    return { ok: false, motivo: e instanceof Ilegivel ? `certificado ilegível (${e.message})` : 'certificado ilegível' }
  }
}
