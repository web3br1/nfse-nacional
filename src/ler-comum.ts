// Peças comuns dos leitores do XML autorizado (NFS-e e evento). Interno: não sai pelo index.
// regra: o elemento é achado pelo CAMINHO a partir da raiz, nunca por "o primeiro <x> que aparecer"
//        (restrição da revisão da T1.4: verificarAssinatura aceita wrapping) · cerca: test/leitores.test.ts
import { lerXml, type Elem } from './assinar.js'
import { NS } from './leiaute/v1-01/validar.js'

/** Recusa interna: vira `{ ok: false, motivo }` na borda de cada leitor. */
export class Recusa extends Error {}

export type Falha = { ok: false; motivo: string }

/** Roda o leitor e converte QUALQUER exceção (inclusive do parser) em `{ ok: false, motivo }`: leitor nunca lança. */
export function protegido<T>(leitor: () => T): T | Falha {
  try {
    return leitor()
  } catch (e) {
    return { ok: false, motivo: e instanceof Recusa ? e.message : 'XML ilegível' }
  }
}

const noNamespace = (el: Elem) => el.ns.get(el.prefixo) === NS

/** Lê o XML e exige que a RAIZ seja `<local>` no namespace da NFS-e. */
export function raizDe(xml: unknown, local: string): Elem {
  if (typeof xml !== 'string' || xml.trim() === '') throw new Recusa('XML vazio')
  const raiz = lerXml(xml)
  if (!raiz) throw new Recusa('XML malformado')
  if (raiz.local !== local || !noNamespace(raiz)) throw new Recusa(`raiz deve ser <${local}> no namespace da NFS-e`)
  return raiz
}

const filhosEl = (pai: Elem) => pai.filhos.filter((f): f is Elem => f.tipo === 'el')

/** O único filho DIRETO `<local>` do pai: zero ou mais de um recusa. Descendentes mais fundos nunca entram. */
export function filhoUnico(pai: Elem, local: string): Elem {
  const achados = filhosEl(pai).filter((f) => f.local === local && noNamespace(f))
  if (achados.length !== 1) throw new Recusa(`esperado exatamente 1 <${local}> em <${pai.local}>, achei ${achados.length}`)
  return achados[0]
}

/** Texto de um elemento folha (sem filhos elemento), sem os espaços das pontas. */
export function textoDe(el: Elem): string {
  if (filhosEl(el).length > 0) throw new Recusa(`<${el.local}> deveria ser um valor, não um grupo`)
  return el.filhos.map((f) => (f.tipo === 'tx' ? f.valor : '')).join('').trim()
}

export function valorDe(pai: Elem, local: string, padrao: RegExp, descricao: string): string {
  const v = textoDe(filhoUnico(pai, local))
  if (!padrao.test(v)) throw new Recusa(`${local} "${v.slice(0, 60)}" fora do formato (${descricao})`)
  return v
}

// TSDateTimeUTC (tiposSimples_v1.01.xsd, dos dois conjuntos): AAAA-MM-DDThh:mm:ss + fuso -11:00..+12:00, sem 'Z'.
const DATA_HORA = /^(20\d\d)-(\d\d)-(\d\d)T(?:20|21|22|23|[01]\d):[0-5]\d:[0-5]\d(?:[-+](?:0\d|10|11):00|\+12:00)$/

/**
 * Valida o TSDateTimeUTC e devolve o dia: os 10 primeiros caracteres COMO VIERAM, no fuso do XML.
 * regra: T1.6 "Regra do dia" · cerca: test/leitores.test.ts ("22h de Brasília…"). Nunca `new Date(...).toISOString()`.
 */
export function dataHoraDe(pai: Elem, local: string): { dh: string; dia: string } {
  const dh = textoDe(filhoUnico(pai, local))
  const m = DATA_HORA.exec(dh)
  if (!m) throw new Recusa(`${local} "${dh.slice(0, 40)}" fora do TSDateTimeUTC`)
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new Recusa(`${local} "${dh}" não é uma data real`)
  }
  return { dh, dia: dh.slice(0, 10) }
}

export { filhosEl }
