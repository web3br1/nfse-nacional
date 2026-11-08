// DPS v1.01 → XML, na ordem do XSD. Sem dependência de XML.
// Ordem dos elementos: Luminaris@519676ab TRANSCRICAO-…-2026-10-13.md:20-82 como atalho; vale a do XSD.
// regra: xsd/COMPARACAO.md · cerca: test/dps.test.ts
import type { Ambiente, EntradaDps, EnderecoNacional, Obra } from '../../entrada.js'
import { idDps } from '../../id.js'
import { VERSAO_PACOTE } from '../../versao.js'

export type ResultadoDps = { ok: true; xml: string; id: string } | { ok: false; motivos: string[] }

const NS = 'http://www.sped.fazenda.gov.br/nfse'

// Padrões copiados dos dois XSD (TSString, TSDateTimeUTC, TSData, TSChaveNFSe).
const TSSTRING = /^(?:[!-ÿ][ -ÿ]*[!-ÿ]|[!-ÿ])$/
const DH_EMI = /^20\d\d-\d\d-\d\dT(?:20|21|22|23|[01]\d):[0-5]\d:[0-5]\d(?:[+-](?:0\d|10|11):00|\+12:00)$/
const DATA = /^(20\d\d)-(\d\d)-(\d\d)$/
const CONTROLE_XML = /[\u0000-\u0008\u000B-\u001F￾￿]/
const CHAVE_POR_AMBIENTE: Record<Ambiente, RegExp> = {
  producao: /^\d{50}$/,
  'producao-restrita': /^\d{6}[0-9A-Z]{14}\d{30}$/,
}

const SERIE_MAX = 49999
const MAX_REAIS = 900_000_000_000_000

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const el = (nome: string, conteudo: string | undefined) => (conteudo === undefined ? '' : `<${nome}>${conteudo}</${nome}>`)

class Validacao {
  readonly motivos: string[] = []
  falha(campo: string, msg: string) {
    this.motivos.push(`${campo}: ${msg}`)
  }

  /** Texto escapado, ou undefined (com motivo, se obrigatório ou inválido). */
  texto(
    campo: string,
    v: unknown,
    o: { min?: number; max: number; obrigatorio?: boolean; tsString?: boolean; naoBranco?: boolean },
  ): string | undefined {
    if (v === undefined || v === null) {
      if (o.obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'string') {
      this.falha(campo, 'deve ser texto')
      return undefined
    }
    // isWellFormed é ES2024; Node >= 22.12 tem.
    if (!(v as unknown as { isWellFormed(): boolean }).isWellFormed()) {
      this.falha(campo, 'tem surrogate solto (UTF-16 malformado)')
      return undefined
    }
    const n = [...v].length
    if (n < (o.min ?? 1) || n > o.max) {
      this.falha(campo, `deve ter de ${o.min ?? 1} a ${o.max} caracteres`)
      return undefined
    }
    if (CONTROLE_XML.test(v)) {
      this.falha(campo, 'tem caractere de controle que o XML não admite (inclui CR)')
      return undefined
    }
    if (o.naoBranco && v.trim() === '') {
      this.falha(campo, 'não pode ser só espaços')
      return undefined
    }
    if (o.tsString && !TSSTRING.test(v)) {
      this.falha(campo, 'caractere fora de U+0021..U+00FF ou espaço no início ou no fim (TSString)')
      return undefined
    }
    return esc(v)
  }

  padrao(campo: string, v: unknown, re: RegExp, descricao: string, obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'string' || !re.test(v)) {
      this.falha(campo, `deve ser ${descricao}`)
      return undefined
    }
    return v
  }

  enumeracao(campo: string, v: unknown, validos: readonly (string | number)[], obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if ((typeof v !== 'string' && typeof v !== 'number') || !validos.some((x) => String(x) === String(v))) {
      this.falha(campo, `deve ser um de ${validos.join(', ')}`)
      return undefined
    }
    return String(v)
  }

  /** Decimal com duas casas (arredonda em centavos antes de formatar). `maximo` em unidades. */
  decimal(campo: string, v: unknown, maximo: number, obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      this.falha(campo, 'deve ser número finito maior ou igual a zero')
      return undefined
    }
    const centavos = Math.round(v * 100)
    // O pacote não arredonda dinheiro em silêncio: só o ruído binário (0.1 + 0.2) passa; 1.005 volta motivo.
    if (Math.abs(v * 100 - centavos) >= 1e-6) {
      this.falha(campo, 'tem fração de centavo; informe o valor já arredondado em centavos')
      return undefined
    }
    if (!Number.isSafeInteger(centavos) || centavos > Math.round(maximo * 100)) {
      this.falha(campo, `deve ser no máximo ${maximo}`)
      return undefined
    }
    return (centavos / 100).toFixed(2)
  }

  dataReal(campo: string, v: unknown): string | undefined {
    const m = typeof v === 'string' ? DATA.exec(v) : null
    if (!m) {
      this.falha(campo, 'deve ser AAAA-MM-DD')
      return undefined
    }
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const d = new Date(Date.UTC(ano, mes - 1, dia))
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
      this.falha(campo, 'data inexistente')
      return undefined
    }
    return v as string
  }
}

type Doc = { CNPJ?: unknown; CPF?: unknown }
type ParDoc = { nome: 'CNPJ' | 'CPF'; valor: string }

/** CNPJ ou CPF, exatamente um. Devolve o par elemento/valor, ou undefined com motivo. */
function documento(v: Validacao, campo: string, d: Doc, alfanumerico: boolean): ParDoc | undefined {
  const temCnpj = d.CNPJ !== undefined && d.CNPJ !== null
  const temCpf = d.CPF !== undefined && d.CPF !== null
  if (temCnpj === temCpf) {
    v.falha(campo, 'informe exatamente um de CNPJ ou CPF')
    return undefined
  }
  if (temCnpj) {
    const re = alfanumerico ? /^[0-9A-Z]{14}$/ : /^\d{14}$/
    const desc = alfanumerico ? '14 caracteres 0-9 e A-Z (produção restrita)' : '14 dígitos (a produção ainda não aceita letra)'
    const valor = v.padrao(`${campo}.CNPJ`, d.CNPJ, re, desc)
    return valor === undefined ? undefined : { nome: 'CNPJ', valor }
  }
  const valor = v.padrao(`${campo}.CPF`, d.CPF, /^\d{11}$/, '11 dígitos')
  return valor === undefined ? undefined : { nome: 'CPF', valor }
}

function enderecoNacional(v: Validacao, campo: string, e: EnderecoNacional): string {
  const cMun = v.padrao(`${campo}.cMun`, e?.cMun, /^\d{7}$/, '7 dígitos (IBGE)')
  const cep = v.padrao(`${campo}.CEP`, e?.CEP, /^\d{8}$/, '8 dígitos')
  const xLgr = v.texto(`${campo}.xLgr`, e?.xLgr, { max: 255, obrigatorio: true, tsString: true })
  const nro = v.texto(`${campo}.nro`, e?.nro, { max: 60, obrigatorio: true, tsString: true })
  const xCpl = v.texto(`${campo}.xCpl`, e?.xCpl, { max: 156, tsString: true })
  const xBairro = v.texto(`${campo}.xBairro`, e?.xBairro, { max: 60, obrigatorio: true, tsString: true })
  return `<end><endNac>${el('cMun', cMun)}${el('CEP', cep)}</endNac>${el('xLgr', xLgr)}${el('nro', nro)}${el('xCpl', xCpl)}${el('xBairro', xBairro)}</end>`
}

function obra(v: Validacao, campo: string, o: Obra): string {
  const escolhas = (['cObra', 'cCIB', 'end'] as const).filter((k) => o?.[k] !== undefined && o?.[k] !== null)
  const insc = v.texto(`${campo}.inscImobFisc`, o?.inscImobFisc, { max: 30 })
  if (escolhas.length !== 1) {
    v.falha(campo, 'informe exatamente um de cObra, cCIB ou end')
    return ''
  }
  let escolha = ''
  if (o.cObra !== undefined && o.cObra !== null) {
    escolha = el('cObra', v.texto(`${campo}.cObra`, o.cObra, { max: 30, obrigatorio: true }))
  } else if (o.cCIB !== undefined && o.cCIB !== null) {
    escolha = el('cCIB', v.texto(`${campo}.cCIB`, o.cCIB, { min: 8, max: 8, obrigatorio: true }))
  } else if (o.end) {
    const e = o.end
    const cep = v.padrao(`${campo}.end.CEP`, e.CEP, /^\d{8}$/, '8 dígitos')
    const xLgr = v.texto(`${campo}.end.xLgr`, e.xLgr, { max: 255, obrigatorio: true, tsString: true })
    const nro = v.texto(`${campo}.end.nro`, e.nro, { max: 60, obrigatorio: true, tsString: true })
    const xCpl = v.texto(`${campo}.end.xCpl`, e.xCpl, { max: 156, tsString: true })
    const xBairro = v.texto(`${campo}.end.xBairro`, e.xBairro, { max: 60, obrigatorio: true, tsString: true })
    escolha = `<end>${el('CEP', cep)}${el('xLgr', xLgr)}${el('nro', nro)}${el('xCpl', xCpl)}${el('xBairro', xBairro)}</end>`
  }
  return `<obra>${el('inscImobFisc', insc)}${escolha}</obra>`
}

export function montarDpsV101(entrada: EntradaDps, ambiente: Ambiente): ResultadoDps {
  const v = new Validacao()
  if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
    return { ok: false, motivos: [`ambiente: deve ser producao ou producao-restrita, veio ${String(ambiente)}`] }
  }
  const restrita = ambiente === 'producao-restrita'
  const e = entrada as Partial<EntradaDps> | null | undefined
  if (typeof e !== 'object' || e === null) return { ok: false, motivos: ['entrada: obrigatória'] }

  // T0.1 item 7 (F8 §2.4.3): produção = 1, produção restrita = 2.
  const tpAmb = v.enumeracao('tpAmb', e.tpAmb, [restrita ? 2 : 1])
  const dhEmi = typeof e.dhEmi === 'string' && DH_EMI.test(e.dhEmi) ? e.dhEmi : undefined
  if (dhEmi === undefined) v.falha('dhEmi', 'deve ser AAAA-MM-DDThh:mm:ss±hh:00 (sem Z)')
  else v.dataReal('dhEmi', dhEmi.slice(0, 10))
  const serieOk = Number.isInteger(e.serie) && (e.serie as number) >= 1 && (e.serie as number) <= SERIE_MAX
  if (!serieOk) v.falha('serie', `deve ser inteiro de 1 a ${SERIE_MAX} (E0010)`)
  const nDpsOk = Number.isSafeInteger(e.nDPS) && (e.nDPS as number) >= 1 && String(e.nDPS).length <= 15
  if (!nDpsOk) v.falha('nDPS', 'deve ser inteiro de 1 a 15 dígitos')
  const dCompet = v.dataReal('dCompet', e.dCompet)
  const cLocEmi = v.padrao('cLocEmi', e.cLocEmi, /^\d{7}$/, '7 dígitos (IBGE)')

  let subst = ''
  if (e.subst !== undefined && e.subst !== null) {
    const s = e.subst
    const desc = restrita ? '50 caracteres: 6 dígitos, 14 de 0-9A-Z, 30 dígitos' : '50 dígitos'
    const chave = v.padrao('subst.chSubstda', s.chSubstda, CHAVE_POR_AMBIENTE[ambiente], desc)
    const cMotivo = v.enumeracao('subst.cMotivo', s.cMotivo, ['01', '02', '03', '04', '05', '99'])
    const xMotivo = v.texto('subst.xMotivo', s.xMotivo, { min: 15, max: 255, tsString: true })
    subst = `<subst>${el('chSubstda', chave)}${el('cMotivo', cMotivo)}${el('xMotivo', xMotivo)}</subst>`
  }

  // Prestador: com tpEmit = 1 não leva xNome nem end (E0121, E0128).
  const p = e.prest
  let prest = ''
  let prestDoc: ParDoc | undefined
  if (typeof p !== 'object' || p === null) v.falha('prest', 'obrigatório')
  else {
    prestDoc = documento(v, 'prest', p, restrita)
    const livre = p as unknown as Record<string, unknown>
    for (const k of ['xNome', 'end']) {
      if (livre[k] !== undefined && livre[k] !== null) {
        v.falha(`prest.${k}`, 'não se informa com tpEmit = 1: o prestador é o emitente (E0121, E0128)')
      }
    }
    const im = v.texto('prest.IM', p.IM, { max: 15 })
    const rt = p.regTrib as unknown as Record<string, unknown> | undefined
    let regTrib = ''
    if (typeof rt !== 'object' || rt === null) v.falha('prest.regTrib', 'obrigatório')
    else {
      for (const k of Object.keys(rt)) {
        if (!['opSimpNac', 'regApTribSN', 'regEspTrib'].includes(k)) {
          v.falha(`prest.regTrib.${k}`, 'não existe em nenhum dos dois XSD (xsd/COMPARACAO.md, conferência 14)')
        }
      }
      const op = v.enumeracao('prest.regTrib.opSimpNac', rt.opSimpNac, [1, 2, 3])
      const temReg = rt.regApTribSN !== undefined && rt.regApTribSN !== null
      const reg = v.enumeracao('prest.regTrib.regApTribSN', rt.regApTribSN, [1, 2, 3], false)
      if (op === '3' && !temReg) v.falha('prest.regTrib.regApTribSN', 'obrigatório para ME/EPP, opSimpNac = 3 (E0166)')
      if ((op === '1' || op === '2') && temReg) {
        v.falha('prest.regTrib.regApTribSN', 'não se informa para não optante nem MEI, opSimpNac 1 ou 2 (E0162)')
      }
      const esp = v.enumeracao('prest.regTrib.regEspTrib', rt.regEspTrib, [0, 1, 2, 3, 4, 5, 6, 9])
      regTrib = `<regTrib>${el('opSimpNac', op)}${el('regApTribSN', reg)}${el('regEspTrib', esp)}</regTrib>`
    }
    prest = `<prest>${prestDoc ? el(prestDoc.nome, prestDoc.valor) : ''}${el('IM', im)}${regTrib}</prest>`
  }

  let toma = ''
  if (e.toma !== undefined && e.toma !== null) {
    const t = e.toma
    const doc = documento(v, 'toma', t, restrita)
    const xNome = v.texto('toma.xNome', t.xNome, { max: 300, obrigatorio: !restrita })
    const end = t.end === undefined || t.end === null ? '' : enderecoNacional(v, 'toma.end', t.end)
    toma = `<toma>${doc ? el(doc.nome, doc.valor) : ''}${el('xNome', xNome)}${end}</toma>`
  }

  let serv = ''
  const s = e.serv
  if (typeof s !== 'object' || s === null) v.falha('serv', 'obrigatório')
  else {
    const loc = v.padrao('serv.cLocPrestacao', s.cLocPrestacao, /^\d{7}$/, '7 dígitos (IBGE)')
    const cTribNac = v.padrao('serv.cTribNac', s.cTribNac, /^\d{6}$/, '6 dígitos')
    const cTribMun = v.padrao('serv.cTribMun', s.cTribMun, /^\d{3}$/, '3 dígitos', false)
    const xDesc = v.texto('serv.xDescServ', s.xDescServ, { max: 2000, obrigatorio: true, naoBranco: true })
    const cNBS = v.padrao('serv.cNBS', s.cNBS, /^\d{9}$/, '9 dígitos', false)
    const ob = s.obra === undefined || s.obra === null ? '' : obra(v, 'serv.obra', s.obra)
    // A ordem de cServ difere: produção cTribNac, cTribMun, xDescServ, cNBS; restrita cTribNac, cTribMun, cNBS, xDescServ.
    const dentroDeCServ = restrita
      ? `${el('cTribNac', cTribNac)}${el('cTribMun', cTribMun)}${el('cNBS', cNBS)}${el('xDescServ', xDesc)}`
      : `${el('cTribNac', cTribNac)}${el('cTribMun', cTribMun)}${el('xDescServ', xDesc)}${el('cNBS', cNBS)}`
    serv = `<serv><locPrest>${el('cLocPrestacao', loc)}</locPrest><cServ>${dentroDeCServ}</cServ>${ob}</serv>`
  }

  let valores = ''
  const va = e.valores
  if (typeof va !== 'object' || va === null) v.falha('valores', 'obrigatório')
  else {
    const vServ = v.decimal('valores.vServ', va.vServ, MAX_REAIS)
    let ded = ''
    if (va.vDedRed !== undefined && va.vDedRed !== null) {
      if (restrita) {
        v.falha(
          'valores.vDedRed',
          'a produção restrita troca vDedRed por vAjusteBC e a fonte oficial não escreve a correspondência entre tpDedRed e tpAjusteBC (xsd/COMPARACAO.md)',
        )
      } else {
        ded = el('vDedRed', el('vDR', v.decimal('valores.vDedRed.vDR', va.vDedRed.vDR, MAX_REAIS)))
      }
    }
    const tm = va.tribMun
    let tribMun = ''
    if (typeof tm !== 'object' || tm === null) v.falha('valores.tribMun', 'obrigatório')
    else {
      const tribISSQN = v.enumeracao('valores.tribMun.tribISSQN', tm.tribISSQN, [1, 2, 3, 4])
      const tpImun = v.enumeracao('valores.tribMun.tpImunidade', tm.tpImunidade, [0, 1, 2, 3, 4, 5], false)
      const tpRet = v.enumeracao('valores.tribMun.tpRetISSQN', tm.tpRetISSQN, [1, 2, 3])
      const pAliq = v.decimal('valores.tribMun.pAliq', tm.pAliq, 9.99, false)
      tribMun = `<tribMun>${el('tribISSQN', tribISSQN)}${el('tpImunidade', tpImun)}${el('tpRetISSQN', tpRet)}${el('pAliq', pAliq)}</tribMun>`
    }
    let tribFed = ''
    if (va.tribFed !== undefined && va.tribFed !== null) {
      const f = va.tribFed
      const cp = v.decimal('valores.tribFed.vRetCP', f.vRetCP, MAX_REAIS, false)
      const irrf = v.decimal('valores.tribFed.vRetIRRF', f.vRetIRRF, MAX_REAIS, false)
      const csll = v.decimal('valores.tribFed.vRetCSLL', f.vRetCSLL, MAX_REAIS, false)
      if (cp !== undefined || irrf !== undefined || csll !== undefined) {
        tribFed = `<tribFed>${el('vRetCP', cp)}${el('vRetIRRF', irrf)}${el('vRetCSLL', csll)}</tribFed>`
      }
    }
    let totTrib = ''
    const tt = va.totTrib as unknown as Record<string, unknown> | undefined
    if (typeof tt !== 'object' || tt === null) v.falha('valores.totTrib', 'obrigatório')
    else {
      const temInd = tt.indTotTrib !== undefined && tt.indTotTrib !== null
      const temSn = tt.pTotTribSN !== undefined && tt.pTotTribSN !== null
      if (temInd === temSn) v.falha('valores.totTrib', 'informe exatamente um de indTotTrib ou pTotTribSN')
      else if (temInd) totTrib = el('totTrib', el('indTotTrib', v.enumeracao('valores.totTrib.indTotTrib', tt.indTotTrib, [0])))
      else totTrib = el('totTrib', el('pTotTribSN', v.decimal('valores.totTrib.pTotTribSN', tt.pTotTribSN, 99.99)))
    }
    valores = `<valores><vServPrest>${el('vServ', vServ)}</vServPrest>${ded}<trib>${tribMun}${tribFed}${totTrib}</trib></valores>`
  }

  if (v.motivos.length > 0 || prestDoc === undefined || cLocEmi === undefined) {
    return { ok: false, motivos: v.motivos.length > 0 ? v.motivos : ['entrada: inválida'] }
  }

  // Sem motivos: os campos do Id já foram validados acima.
  let id: string
  try {
    id = idDps(
      {
        cMun: cLocEmi,
        tpInsc: prestDoc.nome === 'CNPJ' ? 2 : 1,
        inscricao: prestDoc.valor,
        serie: e.serie as number,
        nDPS: e.nDPS as number,
      },
      { cnpjAlfanumerico: restrita },
    )
  } catch (erro) {
    return { ok: false, motivos: [`Id: ${(erro as Error).message}`] }
  }

  const xml =
    `<DPS xmlns="${NS}" versao="1.01"><infDPS Id="${id}">` +
    `${el('tpAmb', tpAmb)}${el('dhEmi', dhEmi)}${el('verAplic', esc(VERSAO_PACOTE))}${el('serie', String(e.serie))}${el('nDPS', String(e.nDPS))}` +
    `${el('dCompet', dCompet)}<tpEmit>1</tpEmit>${restrita ? '<finNFSe>0</finNFSe>' : ''}${el('cLocEmi', cLocEmi)}` +
    `${subst}${prest}${toma}${serv}${valores}</infDPS></DPS>`
  return { ok: true, xml, id }
}
