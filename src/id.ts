// origem: Luminaris@519676ab FiscalDocumentEmissionService.ts:171-173
// regra: manual §1.4.1 (E0004, E0010) e E1235 · cerca: test/id.test.ts

export interface ParamsIdDps {
  cMun: string
  tpInsc: 1 | 2
  inscricao: string
  serie: number
  nDPS: number
}

export interface ParamsIdPedidoEvento {
  chave: string
  tipo: string
}

const SERIE_MAX = 49999

export interface OpcoesIdDps {
  /** CNPJ com letra (`[0-9A-Z]{14}`, só com tpInsc 2): perfil `producao-restrita` (G0 Q4 (a)). Padrão: só dígitos. */
  cnpjAlfanumerico?: boolean
}

/** Id da DPS: `DPS` + IBGE(7) + tpInsc(1) + inscrição(14) + série(5) + nDPS(15) = 45. */
export function idDps(p: ParamsIdDps, opcoes: OpcoesIdDps = {}): string {
  if (!/^\d{7}$/.test(p.cMun)) throw new RangeError('cMun deve ter 7 dígitos')
  if (p.tpInsc !== 1 && p.tpInsc !== 2) throw new RangeError('tpInsc deve ser 1 (CPF) ou 2 (CNPJ)')
  const tamanho = p.tpInsc === 1 ? 11 : 14
  const classe = p.tpInsc === 2 && opcoes.cnpjAlfanumerico ? '[0-9A-Z]' : '\\d'
  if (!new RegExp(`^${classe}{${tamanho}}$`).test(p.inscricao)) {
    throw new RangeError(`inscricao deve ter ${tamanho} dígitos para tpInsc ${p.tpInsc}`)
  }
  if (!Number.isInteger(p.serie) || p.serie < 1 || p.serie > SERIE_MAX) {
    throw new RangeError(`serie deve ser inteiro de 1 a ${SERIE_MAX}`)
  }
  if (!Number.isSafeInteger(p.nDPS) || p.nDPS < 1 || String(p.nDPS).length > 15) {
    throw new RangeError('nDPS deve ser inteiro de 1 a 15 dígitos')
  }
  return `DPS${p.cMun}${p.tpInsc}${p.inscricao.padStart(14, '0')}${String(p.serie).padStart(5, '0')}${String(p.nDPS).padStart(15, '0')}`
}

export interface OpcoesIdPedidoEvento {
  /** Chave com letra no CNPJ (perfil `producao-restrita`): admite o que o TSIdPedRegEvt da restrita admite. Padrão: só dígitos. */
  chaveAlfanumerica?: boolean
}

// TSIdPedRegEvt da restrita, sem o "PRE" e sem o tipo: 8 dígitos, tpInsc 1 + 14 dígitos ou tpInsc 2 + 14 de 0-9A-Z, 27 dígitos.
const CHAVE_ID_ALFANUMERICA = /^\d{8}(?:1\d{14}|2[0-9A-Z]{14})\d{27}$/

/** Id do pedido de evento:`PRE` + chave(50) + tipo(6) = 59. */
export function idPedidoEvento(p: ParamsIdPedidoEvento, opcoes: OpcoesIdPedidoEvento = {}): string {
  const chaveOk = opcoes.chaveAlfanumerica ? CHAVE_ID_ALFANUMERICA.test(p.chave) : /^\d{50}$/.test(p.chave)
  if (!chaveOk) {
    throw new RangeError(opcoes.chaveAlfanumerica ? 'chave deve ter 50 caracteres no padrão do Id da restrita' : 'chave deve ter 50 dígitos')
  }
  if (!/^\d{6}$/.test(p.tipo)) throw new RangeError('tipo deve ter 6 dígitos')
  return `PRE${p.chave}${p.tipo}`
}
