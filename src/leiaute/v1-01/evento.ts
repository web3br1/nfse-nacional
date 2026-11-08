// Pedido de registro de evento v1.01, evento e101101 (cancelamento de NFS-e), na ordem do XSD (TCPedRegEvt, TCInfPedReg, TE101101).
// regra: docs/auditoria/2026-11-07-nfse-nacional-t0.md#5 · cerca: test/evento.test.ts
import { idPedidoEvento } from '../../id.js'
import { VERSAO_PACOTE } from '../../versao.js'
import { DH_EMI, NS, Validacao, el, esc } from './validar.js'

export interface PedidoCancelamento {
  /** 1 produção · 2 homologação (restrita). Decide o perfil do CNPJ: só a restrita aceita letra (G0 Q4 (a)). */
  tpAmb: 1 | 2
  /** AAAA-MM-DDThh:mm:ss±hh:00, sem Z (TSDateTimeUTC). */
  dhEvento: string
  /** Autor do evento: exatamente um de cnpj ou cpf. */
  autor: { cnpj: string } | { cpf: string }
  /** Chave de acesso da NFS-e (50). */
  chave: string
  /** 1 erro na emissão · 2 serviço não prestado · 9 outros (TSCodJustCanc). */
  cMotivo: 1 | 2 | 9
  /** 15 a 255 caracteres (TSMotivo). */
  xMotivo: string
}

export type ResultadoEvento = { ok: true; xml: string; id: string } | { ok: false; motivos: string[] }

const TIPO_CANCELAMENTO = '101101'

// Os pares de padrões abaixo vêm de tiposSimples_v1.01.xsd (TSCNPJ, TSChaveNFSe, TSIdPedRegEvt) de cada conjunto.
// Produção: tudo dígitos. Restrita: TSCNPJ = [0-9A-Z]{14}; a chave precisa passar em DOIS padrões ao mesmo tempo,
//   TSChaveNFSe  [0-9]{6}[0-9A-Z]{14}[0-9]{30}                    (letra só nos índices 6..19)
//   TSIdPedRegEvt PRE[0-9]{8}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{33}  (índice 8 = tpInsc 1|2; letra só com 2, índices 9..22)
// Interseção: 8 dígitos, tpInsc 1 com 14 dígitos ou tpInsc 2 com 11 de 0-9A-Z e 3 dígitos, depois 27 dígitos.
const CNPJ_POR_PERFIL = { digitos: /^\d{14}$/, alfanumerico: /^[0-9A-Z]{14}$/ }
const CHAVE_POR_PERFIL = { digitos: /^\d{50}$/, alfanumerico: /^\d{8}(?:1\d{14}|2[0-9A-Z]{11}\d{3})\d{27}$/ }

export function montarPedidoCancelamentoV101(entrada: PedidoCancelamento): ResultadoEvento {
  const p = entrada as Partial<PedidoCancelamento> | null | undefined
  if (typeof p !== 'object' || p === null) return { ok: false, motivos: ['entrada: obrigatória'] }

  const v = new Validacao()

  // Só número: '2' não é tpAmb nem cMotivo, ao contrário do que o enumeracao() aceitaria por String().
  const numero = (campo: string, valor: unknown, validos: readonly number[]) => {
    if (valor !== undefined && valor !== null && typeof valor !== 'number') {
      v.falha(campo, 'deve ser número')
      return undefined
    }
    return v.enumeracao(campo, valor, validos)
  }

  const tpAmb = numero('tpAmb', p.tpAmb, [1, 2])
  // tpAmb fora de {1, 2} já voltou motivo; o perfil estrito (dígitos) é o padrão para o resto da conferência.
  const perfil = tpAmb === '2' ? 'alfanumerico' : 'digitos'
  const descCnpj = perfil === 'alfanumerico' ? '14 caracteres 0-9 e A-Z (produção restrita)' : '14 dígitos (a produção ainda não aceita letra)'
  const descChave =
    perfil === 'alfanumerico'
      ? '50 caracteres: 8 dígitos, tpInsc 1 com 14 dígitos ou tpInsc 2 com 11 de 0-9A-Z e 3 dígitos, 27 dígitos (TSChaveNFSe e TSIdPedRegEvt da restrita)'
      : '50 dígitos'

  let dhEvento: string | undefined
  if (typeof p.dhEvento === 'string' && DH_EMI.test(p.dhEvento)) {
    dhEvento = p.dhEvento
    v.dataReal('dhEvento', dhEvento.slice(0, 10))
  } else {
    v.falha('dhEvento', 'deve ser AAAA-MM-DDThh:mm:ss±hh:00 (sem Z)')
  }

  let autor: { nome: 'CNPJAutor' | 'CPFAutor'; valor: string } | undefined
  const a = p.autor as Record<string, unknown> | null | undefined
  if (typeof a !== 'object' || a === null) v.falha('autor', 'obrigatório')
  else {
    const temCnpj = a.cnpj !== undefined && a.cnpj !== null
    const temCpf = a.cpf !== undefined && a.cpf !== null
    if (temCnpj === temCpf) v.falha('autor', 'informe exatamente um de cnpj ou cpf')
    else if (temCnpj) {
      const valor = v.padrao('autor.cnpj', a.cnpj, CNPJ_POR_PERFIL[perfil], descCnpj)
      if (valor !== undefined) autor = { nome: 'CNPJAutor', valor }
    } else {
      const valor = v.padrao('autor.cpf', a.cpf, /^\d{11}$/, '11 dígitos')
      if (valor !== undefined) autor = { nome: 'CPFAutor', valor }
    }
  }

  const chave = v.padrao('chave', p.chave, CHAVE_POR_PERFIL[perfil], descChave)
  const cMotivo = numero('cMotivo', p.cMotivo, [1, 2, 9])
  const xMotivo = v.texto('xMotivo', p.xMotivo, { min: 15, max: 255, obrigatorio: true, tsString: true })

  if (v.motivos.length > 0 || tpAmb === undefined || dhEvento === undefined || autor === undefined || chave === undefined) {
    return { ok: false, motivos: v.motivos.length > 0 ? v.motivos : ['entrada: inválida'] }
  }

  // Sem motivos: a chave já passou no padrão do perfil, que é mais estreito que o do Id.
  let id: string
  try {
    id = idPedidoEvento({ chave, tipo: TIPO_CANCELAMENTO }, { chaveAlfanumerica: perfil === 'alfanumerico' })
  } catch (erro) {
    return { ok: false, motivos: [`Id: ${(erro as Error).message}`] }
  }

  const xml =
    `<pedRegEvento xmlns="${NS}" versao="1.01"><infPedReg Id="${id}">` +
    `${el('tpAmb', tpAmb)}${el('verAplic', esc(VERSAO_PACOTE))}${el('dhEvento', dhEvento)}${el(autor.nome, autor.valor)}${el('chNFSe', chave)}` +
    `<e101101>${el('xDesc', 'Cancelamento de NFS-e')}${el('cMotivo', cMotivo)}${el('xMotivo', xMotivo)}</e101101>` +
    `</infPedReg></pedRegEvento>`
  return { ok: true, xml, id }
}
