import { describe, expect, it } from 'vitest'
import { idPedidoEvento } from '../src/index.js'
import { montarPedidoCancelamento } from '../src/leiaute/atual.js'
import { validarNoXsd, type ConjuntoXsd } from './xsd.js'

const CONJUNTOS: readonly ConjuntoXsd[] = ['v1.01-20260209', 'PRODREST-v1.01-20261020']

/**
 * Chave sintética (50): cLocEmi(7) + ambGer(1) + tpInsc(1) + inscrição(14) + 27 dígitos.
 * O XSD da restrita exige tpInsc 1 ou 2 na posição 8 (TSIdPedRegEvt) — o `'3'.repeat(50)` do brief
 * valida na produção e é recusado na restrita (desvio registrado no relatório da T1.3).
 */
const chaveCom = (insc: string, tpInsc = '2') => `35503082${tpInsc}${insc}${'7'.repeat(27)}`.slice(0, 50)
const CNPJ = '12345678000195'
const CHAVE = chaveCom(CNPJ)

const base = {
  tpAmb: 2 as const,
  dhEvento: '2026-11-07T10:00:00-03:00',
  autor: { cnpj: CNPJ },
  chave: CHAVE,
  cMotivo: 1 as const,
  xMotivo: 'Erro na emissão da nota',
}

const tira = (xml: string, elemento: string) => xml.replace(new RegExp(`<${elemento}>[^<]*</${elemento}>`), '')

/** Valida e, como controle negativo, derruba cada elemento obrigatório e exige `valido: false`. */
async function validaEControle(xml: string, c: ConjuntoXsd) {
  expect(await validarNoXsd(xml, c, 'pedRegEvento')).toEqual({ valido: true, erros: [] })
  for (const obrigatorio of ['xMotivo', 'cMotivo', 'chNFSe', 'dhEvento', 'verAplic']) {
    const quebrado = tira(xml, obrigatorio)
    expect(quebrado, `controle: ${obrigatorio} tinha de existir`).not.toBe(xml)
    expect((await validarNoXsd(quebrado, c, 'pedRegEvento')).valido, `sem ${obrigatorio}`).toBe(false)
  }
}

const ok = (r: ReturnType<typeof montarPedidoCancelamento>) => {
  if (!r.ok) throw new Error(`esperava ok, veio ${JSON.stringify(r.motivos)}`)
  return r
}

describe('montarPedidoCancelamento · XSD', () => {
  // T0.1 item 5: e101101, cMotivo {1,2,9}, xMotivo 15..255 (F3 linhas 21-23; XSD TE101101, TSCodJustCanc, TSMotivo).
  it.each(CONJUNTOS)('valida no XSD %s (tpAmb 2)', async (c) => {
    await validaEControle(ok(montarPedidoCancelamento(base)).xml, c)
  })

  it.each(CONJUNTOS)('tpAmb 1 (chave só com dígitos) valida no XSD %s', async (c) => {
    const r = ok(montarPedidoCancelamento({ ...base, tpAmb: 1, chave: '3'.repeat(50) }))
    // a chave '3'*50 tem tpInsc 3 na posição 8: o Id da restrita a recusa (ver o teste de tpInsc); aqui só a produção a admite.
    if (c === 'v1.01-20260209') await validaEControle(r.xml, c)
    else expect((await validarNoXsd(r.xml, c, 'pedRegEvento')).valido).toBe(false)
  })

  it.each(CONJUNTOS)('tpAmb 1 com chave de tpInsc 2 valida no XSD %s', async (c) => {
    await validaEControle(ok(montarPedidoCancelamento({ ...base, tpAmb: 1 })).xml, c)
  })

  it.each(CONJUNTOS)('autor CPF valida no XSD %s', async (c) => {
    const r = ok(montarPedidoCancelamento({ ...base, autor: { cpf: '12345678909' } }))
    expect(r.xml).toContain('<CPFAutor>12345678909</CPFAutor>')
    expect(r.xml).not.toContain('CNPJAutor')
    await validaEControle(r.xml, c)
  })

  it.each([[1], [2], [9]] as const)('cMotivo %s valida nos dois XSD', async (cMotivo) => {
    const r = ok(montarPedidoCancelamento({ ...base, cMotivo }))
    expect(r.xml).toContain(`<cMotivo>${cMotivo}</cMotivo>`)
    for (const c of CONJUNTOS) await validaEControle(r.xml, c)
  })

  it.each([['15 caracteres', 'x'.repeat(15)], ['255 caracteres', 'x'.repeat(255)]])('justificativa com %s valida', async (_, xMotivo) => {
    const r = ok(montarPedidoCancelamento({ ...base, xMotivo }))
    for (const c of CONJUNTOS) await validaEControle(r.xml, c)
  })

  it('o XML sai na ordem do XSD, com o Id no infPedReg e a versão 1.01', () => {
    const r = ok(montarPedidoCancelamento(base))
    expect(r.xml).toMatch(
      new RegExp(
        '^<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infPedReg Id="' +
          r.id +
          '"><tpAmb>2</tpAmb><verAplic>[^<]+</verAplic><dhEvento>2026-11-07T10:00:00-03:00</dhEvento>' +
          '<CNPJAutor>12345678000195</CNPJAutor><chNFSe>' +
          CHAVE +
          '</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissão da nota</xMotivo></e101101></infPedReg></pedRegEvento>$',
      ),
    )
  })

  it('escapa & < > " \' no xMotivo e o XSD aceita', async () => {
    const r = ok(montarPedidoCancelamento({ ...base, xMotivo: `Troca de <A> & "B" por 'C' na nota` }))
    expect(r.xml).toContain('<xMotivo>Troca de &lt;A&gt; &amp; &quot;B&quot; por &apos;C&apos; na nota</xMotivo>')
    for (const c of CONJUNTOS) await validaEControle(r.xml, c)
  })
})

describe('montarPedidoCancelamento · Id', () => {
  it('o Id é PRE + chave + 101101', () => {
    expect(ok(montarPedidoCancelamento({ ...base, tpAmb: 1, chave: '3'.repeat(50) })).id).toBe(`PRE${'3'.repeat(50)}101101`)
    expect(ok(montarPedidoCancelamento(base)).id).toBe(`PRE${CHAVE}101101`)
  })

  it('idPedidoEvento: letra na chave só com a opção, e só onde o Id da restrita admite', () => {
    const comLetra = chaveCom('12AB5678000195')
    expect(() => idPedidoEvento({ chave: comLetra, tipo: '101101' })).toThrow(RangeError)
    expect(idPedidoEvento({ chave: comLetra, tipo: '101101' }, { chaveAlfanumerica: true })).toBe(`PRE${comLetra}101101`)
    // tpInsc 1 (CPF) não admite letra; posição 8 fora de {1, 2} também não.
    expect(() => idPedidoEvento({ chave: chaveCom('12AB5678000195', '1'), tipo: '101101' }, { chaveAlfanumerica: true })).toThrow(RangeError)
    expect(() => idPedidoEvento({ chave: '3'.repeat(50), tipo: '101101' }, { chaveAlfanumerica: true })).toThrow(RangeError)
  })
})

describe('montarPedidoCancelamento · recusas', () => {
  // T0.1 item 5: xMotivo de 15 a 255 caracteres.
  it.each([['14 caracteres', 'x'.repeat(14)], ['256 caracteres', 'x'.repeat(256)]])('justificativa com %s volta motivo', (_, xMotivo) => {
    expect(montarPedidoCancelamento({ ...base, xMotivo })).toEqual({ ok: false, motivos: [expect.stringContaining('xMotivo')] })
  })

  it('cMotivo fora de 1, 2 e 9 volta motivo', () => {
    for (const cMotivo of [3, 0, 10, '01', 1.5, null, undefined]) {
      expect(montarPedidoCancelamento({ ...base, cMotivo: cMotivo as never }), String(cMotivo)).toEqual({
        ok: false,
        motivos: [expect.stringContaining('cMotivo')],
      })
    }
  })

  it('xMotivo com controle, surrogate solto, espaço nas pontas ou fora de Latin-1 volta motivo', () => {
    for (const xMotivo of ['Erro na\u0001emissão da nota', 'Erro na emissão \ud800 da nota', ' Erro na emissão da nota', 'Erro na emissão da nota ', 'Erro na emissão € da nota']) {
      expect(montarPedidoCancelamento({ ...base, xMotivo }), JSON.stringify(xMotivo)).toEqual({ ok: false, motivos: [expect.stringContaining('xMotivo')] })
    }
    expect(montarPedidoCancelamento({ ...base, xMotivo: 123 as never })).toEqual({ ok: false, motivos: [expect.stringContaining('xMotivo')] })
  })

  it('tpAmb fora de 1 e 2 volta motivo', () => {
    for (const tpAmb of [0, 3, '2', undefined, null]) {
      expect(montarPedidoCancelamento({ ...base, tpAmb: tpAmb as never }), String(tpAmb)).toEqual({ ok: false, motivos: [expect.stringContaining('tpAmb')] })
    }
  })

  it('dhEvento com Z, sem fuso, data impossível ou ausente volta motivo', () => {
    for (const dhEvento of ['2026-11-07T10:00:00Z', '2026-11-07T10:00:00', '2026-02-30T10:00:00-03:00', '2026-11-07T24:00:00-03:00', '', undefined]) {
      expect(montarPedidoCancelamento({ ...base, dhEvento: dhEvento as never }), String(dhEvento)).toEqual({
        ok: false,
        motivos: [expect.stringContaining('dhEvento')],
      })
    }
  })

  it('autor: exatamente um de cnpj ou cpf, com o formato certo', () => {
    for (const autor of [{}, { cnpj: CNPJ, cpf: '12345678909' }, { cnpj: '1234567800019' }, { cpf: '1234567890' }, { cpf: '1234567890A' }, undefined, null]) {
      expect(montarPedidoCancelamento({ ...base, autor: autor as never }), JSON.stringify(autor)).toEqual({ ok: false, motivos: [expect.stringContaining('autor')] })
    }
  })

  it('chave com tamanho ou classe errados volta motivo', () => {
    for (const chave of ['3'.repeat(49), '3'.repeat(51), 'x'.repeat(50), '', undefined, 123 as never]) {
      expect(montarPedidoCancelamento({ ...base, tpAmb: 1, chave: chave as never }), String(chave)).toEqual({ ok: false, motivos: [expect.stringContaining('chave')] })
    }
  })

  it('entrada nula ou não objeto volta motivo; versão inexistente volta motivo', () => {
    for (const p of [null, undefined, 'x', 42]) {
      expect(montarPedidoCancelamento(p as never)).toEqual({ ok: false, motivos: [expect.stringContaining('entrada')] })
    }
    expect(montarPedidoCancelamento(base, { versao: 'v9' as never })).toEqual({ ok: false, motivos: [expect.stringContaining('versao')] })
  })

  it('acumula um motivo por campo inválido', () => {
    const r = montarPedidoCancelamento({ ...base, cMotivo: 3 as never, xMotivo: 'curto', dhEvento: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivos).toHaveLength(3)
      for (const campo of ['cMotivo', 'xMotivo', 'dhEvento']) expect(r.motivos.some((m) => m.startsWith(campo))).toBe(true)
    }
  })
})

describe('montarPedidoCancelamento · CNPJ alfanumérico decidido por tpAmb (G0 Q4 (a))', () => {
  const CNPJ_LETRA = '12AB5678000195'
  const chaveLetra = chaveCom(CNPJ_LETRA)

  it('tpAmb 2 aceita letra no CNPJ do autor e na chave, e a restrita valida; a produção recusa (controle)', async () => {
    const r = ok(montarPedidoCancelamento({ ...base, autor: { cnpj: CNPJ_LETRA }, chave: chaveLetra }))
    expect(r.xml).toContain(`<CNPJAutor>${CNPJ_LETRA}</CNPJAutor>`)
    expect(r.id).toBe(`PRE${chaveLetra}101101`)
    await validaEControle(r.xml, 'PRODREST-v1.01-20261020')
    expect((await validarNoXsd(r.xml, 'v1.01-20260209', 'pedRegEvento')).valido).toBe(false)
  })

  it('tpAmb 2: letra só no autor, com chave numérica, também valida na restrita', async () => {
    const r = ok(montarPedidoCancelamento({ ...base, autor: { cnpj: CNPJ_LETRA } }))
    await validaEControle(r.xml, 'PRODREST-v1.01-20261020')
  })

  it('tpAmb 1 recusa letra no autor e na chave, um motivo por campo', () => {
    expect(montarPedidoCancelamento({ ...base, tpAmb: 1, autor: { cnpj: CNPJ_LETRA }, chave: chaveLetra })).toEqual({
      ok: false,
      motivos: [expect.stringContaining('autor'), expect.stringContaining('chave')],
    })
  })

  it('tpAmb 2: letra em CPF ou fora da faixa que o chNFSe admite volta motivo, e o XSD concorda', async () => {
    expect(montarPedidoCancelamento({ ...base, autor: { cpf: '1234567890A' } })).toEqual({ ok: false, motivos: [expect.stringContaining('autor')] })
    // letra no índice 20: o Id da restrita admite (tpInsc 2 vai até o índice 22), o chNFSe não (alfanumérico só até o 19).
    const fora = CHAVE.slice(0, 20) + 'A' + CHAVE.slice(21)
    expect(fora).toHaveLength(50)
    expect(montarPedidoCancelamento({ ...base, chave: fora })).toEqual({ ok: false, motivos: [expect.stringContaining('chave')] })
    // o XSD da restrita realmente recusa essa chave: a regra do pacote não é mais estrita que a fonte.
    const adulterado = ok(montarPedidoCancelamento(base)).xml.replaceAll(CHAVE, fora)
    expect(adulterado).not.toBe(ok(montarPedidoCancelamento(base)).xml)
    expect((await validarNoXsd(adulterado, 'PRODREST-v1.01-20261020', 'pedRegEvento')).valido).toBe(false)
  })

  it('tpAmb 2: tpInsc da chave fora de {1, 2} volta motivo, e o XSD da restrita concorda', async () => {
    const chave3 = chaveCom(CNPJ, '3')
    expect(montarPedidoCancelamento({ ...base, chave: chave3 })).toEqual({ ok: false, motivos: [expect.stringContaining('chave')] })
    const adulterado = ok(montarPedidoCancelamento(base)).xml.replaceAll(CHAVE, chave3)
    expect((await validarNoXsd(adulterado, 'PRODREST-v1.01-20261020', 'pedRegEvento')).valido).toBe(false)
  })
})
