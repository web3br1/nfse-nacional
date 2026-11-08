import { describe, expect, it } from 'vitest'
import { idDps, type EntradaDps } from '../src/index.js'
import { montarDps, XSD_DO_AMBIENTE } from '../src/leiaute/atual.js'
import { validarNoXsd, type ConjuntoXsd } from './xsd.js'

const P = { ambiente: 'producao' } as const
const R = { ambiente: 'producao-restrita' } as const

// Fixture sintética: nenhum dado real.
const entradaBase: EntradaDps = {
  tpAmb: 2,
  dhEmi: '2026-11-07T10:00:00-03:00',
  serie: 1,
  nDPS: 1,
  dCompet: '2026-11-07',
  cLocEmi: '3550308',
  prest: { CNPJ: '12345678000195', IM: '12345', regTrib: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 } },
  toma: {
    CPF: '12345678909',
    xNome: 'Cliente Sintetico',
    end: { cMun: '3550308', CEP: '01001000', xLgr: 'Rua Exemplo', nro: '100', xBairro: 'Centro' },
  },
  serv: { cLocPrestacao: '3550308', cTribNac: '070201', xDescServ: 'Manutencao de piscina' },
  valores: {
    vServ: 150,
    tribMun: { tribISSQN: 1, tpRetISSQN: 1 },
    totTrib: { pTotTribSN: 4.5 },
  },
}

/** Valida e, como controle negativo, derruba um elemento obrigatório e exige `valido: false`. */
async function validaEControle(xml: string, c: ConjuntoXsd) {
  expect(await validarNoXsd(xml, c, 'DPS')).toEqual({ valido: true, erros: [] })
  const quebrado = xml.replace(/<dCompet>[^<]*<\/dCompet>/, '')
  expect(quebrado).not.toBe(xml)
  const r = await validarNoXsd(quebrado, c, 'DPS')
  expect(r.valido).toBe(false)
  expect(r.erros.join(' ')).toContain('dCompet')
}

const xmlDe = (e: EntradaDps, o: typeof P | typeof R) => {
  const r = montarDps(e, o)
  if (!r.ok) throw new Error(`montarDps recusou: ${r.motivos.join('; ')}`)
  return r.xml
}

describe('perfis por ambiente (G0 Q5 (a))', () => {
  it.each([
    ['producao', 'v1.01-20260209'],
    ['producao-restrita', 'PRODREST-v1.01-20261020'],
  ] as const)('a DPS base do perfil %s valida no XSD %s', async (ambiente, c) => {
    const r = montarDps(entradaBase, { ambiente })
    expect(r.ok).toBe(true)
    expect(XSD_DO_AMBIENTE[ambiente]).toBe(c)
    await validaEControle((r as any).xml, c)
  })

  it('a DPS do perfil de produção é recusada pelo XSD da restrita (os perfis diferem de fato)', async () => {
    const r = montarDps(entradaBase, P) as any
    const v = await validarNoXsd(r.xml, 'PRODREST-v1.01-20261020', 'DPS')
    expect(v.valido).toBe(false)
    expect(v.erros.join(' ')).toContain('finNFSe')
  })

  it('a DPS do perfil da restrita é recusada pelo XSD de produção (finNFSe não existe lá)', async () => {
    const r = montarDps(entradaBase, R) as any
    expect(r.xml).toContain('<finNFSe>0</finNFSe>')
    expect((await validarNoXsd(r.xml, 'v1.01-20260209', 'DPS')).valido).toBe(false)
  })

  it('finNFSe vem logo após tpEmit na restrita e não existe na produção', () => {
    expect((montarDps(entradaBase, R) as any).xml).toMatch(/<tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>/)
    expect((montarDps(entradaBase, P) as any).xml).not.toContain('finNFSe')
  })

  it('CNPJ do tomador com letra: recusado no perfil de produção, válido no da restrita (G0 Q4)', async () => {
    const e = { ...entradaBase, toma: { ...entradaBase.toma, CNPJ: '12ABC34500019X', CPF: undefined } } as EntradaDps
    expect(montarDps(e, P)).toEqual({ ok: false, motivos: [expect.stringContaining('CNPJ')] })
    await validaEControle((montarDps(e, R) as any).xml, 'PRODREST-v1.01-20261020')
  })

  it('CNPJ do prestador com letra: o Id leva a letra na restrita e a produção recusa', async () => {
    const e = { ...entradaBase, prest: { ...entradaBase.prest, CNPJ: '12ABC34500019X' } } as EntradaDps
    expect(montarDps(e, P)).toEqual({ ok: false, motivos: [expect.stringContaining('prest.CNPJ')] })
    const r = montarDps(e, R) as any
    expect(r.id).toBe('DPS35503082' + '12ABC34500019X' + '00001' + '000000000000001')
    await validaEControle(r.xml, 'PRODREST-v1.01-20261020')
  })

  it('idDps da T1.1 segue recusando letra por padrão', () => {
    const p = { cMun: '3550308', tpInsc: 2 as const, inscricao: '12ABC34500019X', serie: 1, nDPS: 1 }
    expect(() => idDps(p)).toThrow(RangeError)
    expect(idDps(p, { cnpjAlfanumerico: true })).toHaveLength(45)
    expect(() => idDps({ ...p, tpInsc: 1, inscricao: '1234567890A' }, { cnpjAlfanumerico: true })).toThrow(RangeError)
  })

  it('tomador sem xNome: motivo na produção, válido na restrita', async () => {
    const e = { ...entradaBase, toma: { ...entradaBase.toma, xNome: undefined } } as EntradaDps
    expect(montarDps(e, P)).toEqual({ ok: false, motivos: [expect.stringContaining('xNome')] })
    await validaEControle((montarDps(e, R) as any).xml, 'PRODREST-v1.01-20261020')
  })

  it('DPS sem tomador valida nos dois perfis', async () => {
    const { toma: _t, ...semToma } = entradaBase
    await validaEControle(xmlDe(semToma as EntradaDps, P), 'v1.01-20260209')
    await validaEControle(xmlDe(semToma as EntradaDps, R), 'PRODREST-v1.01-20261020')
  })
})

describe('Id, formato e escape', () => {
  it('o Id do infDPS é o idDps e o nDPS sai sem zero à esquerda', () => {
    const r = montarDps({ ...entradaBase, serie: 1, nDPS: 42 }, P) as any
    expect(r.id).toBe('DPS355030821234567800019500001000000000000042')
    expect(r.xml).toContain(`<infDPS Id="${r.id}"`)
    expect(r.xml).toContain('<nDPS>42</nDPS>')
  })

  it('série fora de 1..49999 volta motivo, não lança (E0010)', () => {
    expect(montarDps({ ...entradaBase, serie: 50000 }, P)).toEqual({ ok: false, motivos: [expect.stringContaining('serie')] })
    expect(montarDps({ ...entradaBase, serie: 0 }, R)).toEqual({ ok: false, motivos: [expect.stringContaining('serie')] })
  })

  it('valor em ponto flutuante sai com duas casas', () => {
    const r = montarDps({ ...entradaBase, valores: { ...entradaBase.valores, vServ: 0.1 + 0.2 } }, P) as any
    expect(r.xml).toContain('<vServ>0.30</vServ>')
  })

  it('descrição com & < > e acento escapa e valida', async () => {
    const e = { ...entradaBase, serv: { ...entradaBase.serv, xDescServ: 'Limpeza & cloro <5 kg> — piscina' } }
    const r = montarDps(e, P) as any
    expect(r.xml).toContain('Limpeza &amp; cloro &lt;5 kg&gt; — piscina')
    await validaEControle(r.xml, 'v1.01-20260209')
    await validaEControle(xmlDe(e, R), 'PRODREST-v1.01-20261020')
  })

  it('aspas e apóstrofo escapam; caractere de controle XML volta motivo', () => {
    const r = montarDps({ ...entradaBase, serv: { ...entradaBase.serv, xDescServ: 'a"b\'c' } }, P) as any
    expect(r.xml).toContain('a&quot;b&apos;c')
    expect(montarDps({ ...entradaBase, serv: { ...entradaBase.serv, xDescServ: 'a\u0001b' } }, P)).toEqual({
      ok: false,
      motivos: [expect.stringContaining('serv.xDescServ')],
    })
  })

  it('dhEmi com Z, data impossível ou valor negativo voltam motivo, um por campo', () => {
    expect(montarDps({ ...entradaBase, dhEmi: '2026-11-07T10:00:00Z' }, P)).toEqual({ ok: false, motivos: [expect.stringContaining('dhEmi')] })
    expect(montarDps({ ...entradaBase, dCompet: '2026-02-30' }, P)).toEqual({ ok: false, motivos: [expect.stringContaining('dCompet')] })
    expect(montarDps({ ...entradaBase, valores: { ...entradaBase.valores, vServ: -1 } }, P)).toEqual({
      ok: false,
      motivos: [expect.stringContaining('valores.vServ')],
    })
  })
})

describe('substituição', () => {
  it('leva subst com chSubstda e cMotivo, e valida', async () => {
    const r = montarDps({ ...entradaBase, subst: { chSubstda: '3'.repeat(50), cMotivo: '01', xMotivo: 'Correção do tomador' } }, R) as any
    expect(r.xml).toMatch(/<subst><chSubstda>3{50}<\/chSubstda><cMotivo>01<\/cMotivo>/)
    await validaEControle(r.xml, 'PRODREST-v1.01-20261020')
  })

  it('xMotivo curto volta motivo; com 15 caracteres valida na produção', async () => {
    const e = { ...entradaBase, subst: { chSubstda: '3'.repeat(50), cMotivo: '99' as const, xMotivo: 'curto' } }
    expect(montarDps(e, P)).toEqual({ ok: false, motivos: [expect.stringContaining('subst.xMotivo')] })
    await validaEControle(xmlDe({ ...e, subst: { ...e.subst, xMotivo: 'Motivo com mais de quinze' } }, P), 'v1.01-20260209')
  })
})

describe('regras do item 6 da T0.1 (firmes)', () => {
  it('tpEmit = 1 com xNome ou endereço do prestador: motivo (E0121, E0128)', () => {
    for (const extra of [{ xNome: 'Prestador' }, { end: { cMun: '3550308' } }]) {
      const e = { ...entradaBase, prest: { ...entradaBase.prest, ...extra } } as EntradaDps
      const campo = Object.keys(extra)[0]
      for (const o of [P, R]) {
        expect(montarDps(e, o)).toEqual({ ok: false, motivos: [expect.stringContaining(`prest.${campo}`)] })
      }
    }
  })

  it('ME/EPP sem regApTribSN: motivo (E0166); MEI e não optante com regApTribSN: motivo (E0162)', () => {
    const sem = { ...entradaBase, prest: { ...entradaBase.prest, regTrib: { opSimpNac: 3, regEspTrib: 0 } } } as EntradaDps
    expect(montarDps(sem, P)).toEqual({ ok: false, motivos: [expect.stringContaining('regApTribSN')] })
    expect(montarDps(sem, R)).toEqual({ ok: false, motivos: [expect.stringContaining('regApTribSN')] })
    for (const op of [1, 2]) {
      const com = { ...entradaBase, prest: { ...entradaBase.prest, regTrib: { opSimpNac: op, regApTribSN: 1, regEspTrib: 0 } } } as EntradaDps
      expect(montarDps(com, P)).toEqual({ ok: false, motivos: [expect.stringContaining('regApTribSN')] })
    }
  })

  it('MEI sem regApTribSN valida nos dois perfis', async () => {
    const mei = { ...entradaBase, prest: { ...entradaBase.prest, regTrib: { opSimpNac: 2, regEspTrib: 0 } } } as EntradaDps
    await validaEControle(xmlDe(mei, P), 'v1.01-20260209')
    await validaEControle(xmlDe(mei, R), 'PRODREST-v1.01-20261020')
  })
})

describe('conferência 14: opSimpNac, regApIBSCBSSN, cAtvSN', () => {
  it('opSimpNac = 4 volta motivo nos dois perfis (a enumeração dos dois XSD é 1 a 3)', () => {
    const e = { ...entradaBase, prest: { ...entradaBase.prest, regTrib: { opSimpNac: 4, regApTribSN: 1, regEspTrib: 0 } } } as any
    for (const o of [P, R]) expect(montarDps(e, o)).toEqual({ ok: false, motivos: [expect.stringContaining('opSimpNac')] })
  })

  it.each(['regApIBSCBSSN', 'cAtvSN'])('%s não existe em nenhum dos dois XSD: volta motivo nomeando o elemento', (campo) => {
    const e = { ...entradaBase, prest: { ...entradaBase.prest, regTrib: { ...entradaBase.prest.regTrib, [campo]: '1' } } } as any
    for (const o of [P, R]) expect(montarDps(e, o)).toEqual({ ok: false, motivos: [expect.stringContaining(campo)] })
  })

  it('a DPS nunca leva o grupo IBSCBS (G0-A2 (a))', () => {
    for (const o of [P, R]) expect((montarDps(entradaBase, o) as any).xml).not.toContain('IBSCBS')
  })
})

describe('dedução (Step 1b (ii))', () => {
  const comDeducao = { ...entradaBase, valores: { ...entradaBase.valores, vDedRed: { vDR: 20 } } }

  it('perfil produção leva vDedRed/vDR e valida', async () => {
    const xml = xmlDe(comDeducao, P)
    expect(xml).toContain('<vDedRed><vDR>20.00</vDR></vDedRed>')
    await validaEControle(xml, 'v1.01-20260209')
  })

  it('perfil restrita recusa a dedução nomeando valores.vDedRed (sem correspondência escrita com vAjusteBC)', () => {
    expect(montarDps(comDeducao, R)).toEqual({ ok: false, motivos: [expect.stringContaining('valores.vDedRed')] })
  })
})

describe('demais grupos', () => {
  it('obra (cObra), cTribMun, cNBS, retenções federais e ISS retido validam nos dois perfis', async () => {
    const e: EntradaDps = {
      ...entradaBase,
      serv: { ...entradaBase.serv, cTribMun: '001', cNBS: '115021000', obra: { inscImobFisc: '123', cObra: 'OBRA-1' } },
      valores: {
        ...entradaBase.valores,
        tribMun: { tribISSQN: 1, tpRetISSQN: 2, pAliq: 5 },
        tribFed: { vRetCP: 1.5, vRetIRRF: 2, vRetCSLL: 0.1 + 0.2 },
        totTrib: { indTotTrib: 0 },
      },
    }
    const p = xmlDe(e, P)
    expect(p).toContain('<pAliq>5.00</pAliq>')
    expect(p).toContain('<vRetCSLL>0.30</vRetCSLL>')
    await validaEControle(p, 'v1.01-20260209')
    await validaEControle(xmlDe(e, R), 'PRODREST-v1.01-20261020')
  })

  it('obra com mais de uma escolha volta motivo', () => {
    const e = { ...entradaBase, serv: { ...entradaBase.serv, obra: { cObra: 'X', cCIB: '12345678' } } }
    expect(montarDps(e, P)).toEqual({ ok: false, motivos: [expect.stringContaining('serv.obra')] })
  })
})

describe('validarNoXsd', () => {
  it.each(['v1.01-20260209', 'PRODREST-v1.01-20261020'] as const)(
    'carrega a raiz pedRegEvento em %s e recusa o vazio por elemento ausente, não por schema ilegível',
    async (c) => {
      const r = await validarNoXsd('<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"/>', c, 'pedRegEvento')
      expect(r.valido).toBe(false)
      expect(r.erros.join(' ')).toContain('infPedReg')
    },
  )
})

describe('defeito do XSD de produção em TSSerieDPS', () => {
  it('lido ao pé da letra (^ e $ literais), o XSD de produção recusa qualquer série; o ajuste de test/xsd.ts só tira as âncoras', async () => {
    const xml = xmlDe(entradaBase, P)
    const cru = await validarNoXsd(xml, 'v1.01-20260209', 'DPS', { ajustar: false })
    expect(cru.valido).toBe(false)
    expect(cru.erros).toHaveLength(1)
    expect(cru.erros[0]).toContain('serie')
    expect(await validarNoXsd(xml, 'v1.01-20260209', 'DPS')).toEqual({ valido: true, erros: [] })
  })
})

describe('ordem de cServ difere entre os XSD (quinto ponto, fora do item 8 da T0.1)', () => {
  const e: EntradaDps = { ...entradaBase, serv: { ...entradaBase.serv, cNBS: '115021000' } }

  it('produção: xDescServ antes de cNBS; restrita: cNBS antes de xDescServ', () => {
    expect(xmlDe(e, P)).toMatch(/<xDescServ>[^<]*<\/xDescServ><cNBS>/)
    expect(xmlDe(e, R)).toMatch(/<cNBS>115021000<\/cNBS><xDescServ>/)
  })

  it('controle negativo: a ordem de um perfil no XSD do outro é recusada', async () => {
    // DPS de produção + finNFSe: só a ordem de cServ a separa da válida na restrita.
    const daProducaoComFin = xmlDe(e, P).replace('<tpEmit>1</tpEmit>', '<tpEmit>1</tpEmit><finNFSe>0</finNFSe>')
    const naRestrita = await validarNoXsd(daProducaoComFin, 'PRODREST-v1.01-20261020', 'DPS')
    expect(naRestrita.valido).toBe(false)
    expect(naRestrita.erros.join(' ')).toMatch(/xDescServ|cNBS/)
    // E a da restrita sem finNFSe e com a ordem da produção valida na produção.
    const daRestritaNaOrdemDaProducao = xmlDe(e, R)
      .replace('<finNFSe>0</finNFSe>', '')
      .replace(/<cNBS>115021000<\/cNBS>(<xDescServ>[^<]*<\/xDescServ>)/, '$1<cNBS>115021000</cNBS>')
    expect(await validarNoXsd(daRestritaNaOrdemDaProducao, 'v1.01-20260209', 'DPS')).toEqual({ valido: true, erros: [] })
  })
})

describe('arredondamento em centavos', () => {
  it.each([[0.29, '0.29'], [19.99, '19.99'], [1.005 + 0.001, '1.01'], [150, '150.00'], [0, '0.00']])('vServ %s sai %s', (entrada, saida) => {
    const r = montarDps({ ...entradaBase, valores: { ...entradaBase.valores, vServ: entrada } }, P) as any
    expect(r.xml).toContain(`<vServ>${saida}</vServ>`)
  })
})
