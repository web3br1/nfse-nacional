// origem: AquaPrime@0e95f0c7 supabase/functions/_shared/assinatura-xml.test.js:1-152
/**
 * T2.2 — a assinatura XMLDSig da NF-e, da NFC-e, da DPS e dos eventos (MOC 7.0 §4.2.4).
 *
 * Decisão 68: sem dependência em produção. O `xml-crypto` só entra aqui, como referência
 * independente — se a nossa C14N divergir da dele num caractere, o `checkSignature` dele
 * reprova. O par de chaves e o certificado são gerados pelo próprio teste; nada real entra.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { SignedXml } from 'xml-crypto'
import { DOMParser } from '@xmldom/xmldom'
import { assinarXml, verificarAssinatura, ALGORITMO_ASSINATURA } from '../src/assinar.js'
import { montarDps, montarPedidoCancelamento } from '../src/leiaute/atual.js'
import { validarNoXsd } from './xsd.js'
import { entradaBase } from './fixtures.js'
import { gerarCertificado } from './certificado-de-teste.js'

const CHAVE = '35261012345678000190650010000000011123456780'
const ID = `NFe${CHAVE}`

// Fixture mínima (decisão 71) com o que a C14N precisa acertar: namespace herdado do
// ancestral (inclusive o prefixado), atributos fora de ordem, escape de texto e de
// atributo, elemento vazio, CDATA e comentário.
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<NFe xmlns="http://www.portalfiscal.inf.br/nfe" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
  + `<infNFe versao="4.00" Id="${ID}">`
  + '<ide><cUF>35</cUF><natOp>A &amp; B &lt;c&gt; "d"</natOp><vazio/></ide>'
  + '<emit b="1" a="x&quot;y&#10;z"/>'
  + '<total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>'
  + '<infAdic><infCpl><![CDATA[a<b & c]]></infCpl></infAdic><!-- comentário -->'
  + '</infNFe></NFe>'

const DS = 'http://www.w3.org/2000/09/xmldsig#'
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'

function conferirComXmlCrypto(xml, certPem) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const sig = doc.getElementsByTagNameNS(DS, 'Signature')[0]
  const sx = new SignedXml({ publicCert: certPem })
  sx.loadSignature(sig)
  return sx.checkSignature(xml)
}

let cert, outro
beforeAll(async () => {
  cert = await gerarCertificado()
  outro = await gerarCertificado()
  // o certificado gerado é X.509 de verdade: o leitor do Node o aceita
  expect(new X509Certificate(cert.certPem).subject).toContain('teste T2.2')
})

describe('assinarXml — caso 1: assina o elemento pelo Id, no padrão do MOC 7.0', () => {
  it('põe a Signature irmã de infNFe, dentro de NFe, com os algoritmos do MOC', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    expect(r).toHaveProperty('xml')
    const doc = new DOMParser().parseFromString(r.xml, 'text/xml')
    const sig = doc.getElementsByTagNameNS(DS, 'Signature')
    expect(sig.length).toBe(1)
    expect(sig[0].parentNode.localName).toBe('NFe')
    expect(sig[0].previousSibling.localName).toBe('infNFe')
    const alg = (nomeEl) => Array.from(doc.getElementsByTagNameNS(DS, nomeEl)).map((e) => e.getAttribute('Algorithm'))
    expect(alg('CanonicalizationMethod')).toEqual([C14N])
    expect(alg('SignatureMethod')).toEqual([`${DS}rsa-sha1`])
    expect(alg('Transform')).toEqual([`${DS}enveloped-signature`, C14N])
    expect(alg('DigestMethod')).toEqual([`${DS}sha1`])
    const refs = doc.getElementsByTagNameNS(DS, 'Reference')
    expect(refs.length).toBe(1)
    expect(refs[0].getAttribute('URI')).toBe(`#${ID}`)
    const certB64 = cert.certPem.replace(/-----[^-]+-----|\s/g, '')
    expect(doc.getElementsByTagNameNS(DS, 'X509Certificate')[0].textContent).toBe(certB64)
  })

  it('o resto do documento sai intacto: a assinatura só é inserida', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    expect(r.xml.replace(/<Signature [\s\S]*<\/Signature>/, '')).toBe(XML)
  })

  it('verificarAssinatura confere com o certificado de quem assinou', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    expect(await verificarAssinatura(r.xml, cert.certPem)).toBe(true)
    expect(await verificarAssinatura(r.xml, outro.certPem)).toBe(false)
  })

  it('a referência independente (xml-crypto) aceita DigestValue e SignatureValue', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    expect(conferirComXmlCrypto(r.xml, cert.certPem)).toBe(true)
  })
})

describe('assinarXml — caso 2: alterar o elemento assinado invalida', () => {
  it('um dígito do vNF trocado reprova na nossa verificação e na do xml-crypto', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    const adulterado = r.xml.replace('<vNF>100.00</vNF>', '<vNF>900.00</vNF>')
    expect(adulterado).not.toBe(r.xml)
    expect(await verificarAssinatura(adulterado, cert.certPem)).toBe(false)
    expect(conferirComXmlCrypto(adulterado, cert.certPem)).toBe(false)
  })

  it('uma segunda Signature no documento reprova (só uma assinatura é conferida)', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    const sig = r.xml.match(/<Signature [\s\S]*<\/Signature>/)[0]
    expect(await verificarAssinatura(r.xml.replace('</NFe>', `${sig}</NFe>`), cert.certPem)).toBe(false)
  })

  it('um caractere do SignedInfo trocado reprova', async () => {
    const r = await assinarXml(XML, { idDoElemento: ID, ...cert })
    const adulterado = r.xml.replace('#rsa-sha1', '#rsa-sha256')
    expect(await verificarAssinatura(adulterado, cert.certPem)).toBe(false)
  })
})

describe('assinarXml — caso 3: recusa antes de assinar', () => {
  it('sem elemento com o Id pedido', async () => {
    const semId = XML.replace(` Id="${ID}"`, '')
    expect(await assinarXml(semId, { idDoElemento: ID, ...cert })).toEqual({ motivo: 'elemento a assinar sem Id' })
  })

  it('Id duplicado', async () => {
    const dup = XML.replace('<ide>', `<ide Id="${ID}">`)
    expect(await assinarXml(dup, { idDoElemento: ID, ...cert })).toEqual({ motivo: `Id duplicado: ${ID}` })
  })

  it('XML com DOCTYPE fica fora do subconjunto que a C14N própria cobre', async () => {
    const dtd = XML.replace('<NFe ', '<!DOCTYPE NFe><NFe ')
    expect(await assinarXml(dtd, { idDoElemento: ID, ...cert })).toEqual({ motivo: 'XML com DOCTYPE não é assinado' })
  })

  it('XML malformado', async () => {
    const mal = XML.replace('</ide>', '</idx>')
    const r = await assinarXml(mal, { idDoElemento: ID, ...cert })
    expect(r.motivo).toMatch(/^XML malformado/)
  })

  it('chave fora do PKCS#8', async () => {
    const rsa = cert.keyPem.replace(/PRIVATE KEY/g, 'RSA PRIVATE KEY')
    expect(await assinarXml(XML, { idDoElemento: ID, certPem: cert.certPem, keyPem: rsa }))
      .toEqual({ motivo: 'chave privada fora do PKCS#8' })
  })

  it('certificado fora do PEM', async () => {
    expect(await assinarXml(XML, { idDoElemento: ID, certPem: 'MIIB...', keyPem: cert.keyPem }))
      .toEqual({ motivo: 'certificado fora do PEM' })
  })
})

describe('assinarXml — o mesmo código assina a DPS e o evento', () => {
  it('infDPS da NFS-e: Signature irmã, Reference para o Id, xml-crypto aceita', async () => {
    const dps = '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'
      + '<infDPS Id="DPS351234567890123456780000100000000000001"><tpAmb>2</tpAmb></infDPS></DPS>'
    const r = await assinarXml(dps, { idDoElemento: 'DPS351234567890123456780000100000000000001', ...cert })
    expect(r.xml).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/)
    expect(conferirComXmlCrypto(r.xml, cert.certPem)).toBe(true)
    expect(await verificarAssinatura(r.xml, cert.certPem)).toBe(true)
  })
})

// ---------- T1.4: casos novos do pacote (DPS e pedido de cancelamento reais, XSD, constante única) ----------

const CJ_PRODUCAO = 'v1.01-20260209' as const
const CJ_RESTRITA = 'PRODREST-v1.01-20261020' as const
const AMBIENTES = [
  ['producao', CJ_PRODUCAO],
  ['producao-restrita', CJ_RESTRITA],
] as const

// Mesmo montador da T1.2, com o tpAmb derivado do perfil (como em dps.test.ts).
const dpsAssinavel = (ambiente: 'producao' | 'producao-restrita') => {
  const r = montarDps({ ...entradaBase, tpAmb: ambiente === 'producao' ? 1 : 2 }, { ambiente })
  if (!r.ok) throw new Error(`montarDps recusou: ${r.motivos.join('; ')}`)
  return r
}

// Chave de 50 caracteres: cLocEmi(7) + ambGer(1) + tpInsc(1) + inscrição(14) + 27 dígitos (como em evento.test.ts).
const chaveCom = (tpInsc: '1' | '2', insc: string) => `35503082${tpInsc}${insc}${'7'.repeat(27)}`.slice(0, 50)
const pedidoBase = (tpInsc: '1' | '2') => ({
  tpAmb: 2 as const,
  dhEvento: '2026-11-07T10:00:00-03:00',
  autor: tpInsc === '2' ? { cnpj: '12345678000195' } : { cpf: '12345678909' },
  chave: tpInsc === '2' ? chaveCom('2', '12345678000195') : chaveCom('1', '00012345678909'),
  cMotivo: 1 as const,
  xMotivo: 'Erro na emissão da nota',
})

describe('T1.4 — DPS da T1.2 assinada: xml-crypto e XSD', () => {
  it.each(AMBIENTES)('perfil %s: confere no xml-crypto e valida no XSD %s com a Signature', async (ambiente, conjunto) => {
    const { xml, id } = dpsAssinavel(ambiente)
    const assinado = await assinarXml(xml, { idDoElemento: id, ...cert }) as { xml: string }
    expect(assinado).toHaveProperty('xml')
    expect(conferirComXmlCrypto(assinado.xml, cert.certPem)).toBe(true)
    expect(await verificarAssinatura(assinado.xml, cert.certPem)).toBe(true)
    expect(assinado.xml).toMatch(/<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/)
    expect(await validarNoXsd(assinado.xml, conjunto, 'DPS')).toEqual({ valido: true, erros: [] })
  })

  it('controle negativo: um byte do conteúdo do infDPS alterado reprova no xml-crypto, na nossa conferência e no digest', async () => {
    const { xml, id } = dpsAssinavel('producao')
    const assinado = await assinarXml(xml, { idDoElemento: id, ...cert }) as { xml: string }
    const adulterado = assinado.xml.replace('<vServ>150.00</vServ>', '<vServ>950.00</vServ>')
    expect(adulterado).not.toBe(assinado.xml)
    expect(adulterado.length).toBe(assinado.xml.length)
    expect(conferirComXmlCrypto(adulterado, cert.certPem)).toBe(false)
    expect(await verificarAssinatura(adulterado, cert.certPem)).toBe(false)
  })

  it('controle negativo: o xml-crypto recusa a assinatura conferida com o certificado de outro titular', async () => {
    const { xml, id } = dpsAssinavel('producao')
    const assinado = await assinarXml(xml, { idDoElemento: id, ...cert }) as { xml: string }
    // com a chave de outro titular o xml-crypto lança 'invalid signature' em vez de devolver false
    const confere = () => { try { return conferirComXmlCrypto(assinado.xml, outro.certPem) } catch { return false } }
    expect(confere()).toBe(false)
  })
})

describe('T1.4 — pedido de cancelamento assinado em infPedReg', () => {
  it.each([['2'], ['1']] as const)('tpInsc %s: confere no xml-crypto e valida nos dois XSD', async (tpInsc) => {
    const r = montarPedidoCancelamento(pedidoBase(tpInsc))
    if (!r.ok) throw new Error(`montarPedidoCancelamento recusou: ${r.motivos.join('; ')}`)
    expect(r.id).toMatch(/^PRE\d{50}101101$/)
    const assinado = await assinarXml(r.xml, { idDoElemento: r.id, ...cert }) as { xml: string }
    expect(assinado).toHaveProperty('xml')
    expect(assinado.xml).toMatch(/<\/infPedReg><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/)
    expect(conferirComXmlCrypto(assinado.xml, cert.certPem)).toBe(true)
    for (const conjunto of [CJ_PRODUCAO, CJ_RESTRITA]) {
      expect(await validarNoXsd(assinado.xml, conjunto, 'pedRegEvento'), conjunto).toEqual({ valido: true, erros: [] })
    }
  })

  it('controle negativo: a justificativa alterada em um byte reprova no xml-crypto', async () => {
    const r = montarPedidoCancelamento(pedidoBase('2'))
    if (!r.ok) throw new Error('pedido recusado')
    const assinado = await assinarXml(r.xml, { idDoElemento: r.id, ...cert }) as { xml: string }
    const adulterado = assinado.xml.replace('Erro na emissão', 'Erro na emissao')
    expect(adulterado).not.toBe(assinado.xml)
    expect(conferirComXmlCrypto(adulterado, cert.certPem)).toBe(false)
  })
})

describe('T1.4 — a constante única do algoritmo (G0 Q3 (a): RSA-SHA1 + C14N 1.0)', () => {
  it('guarda os três URIs das restrições, ao pé da letra', () => {
    expect(ALGORITMO_ASSINATURA).toEqual({
      assinatura: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
      c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    })
  })

  it('o SignedInfo usa exatamente a constante única', async () => {
    const { xml, id } = dpsAssinavel('producao')
    const s = (await assinarXml(xml, { idDoElemento: id, ...cert }) as { xml: string }).xml
    expect(s).toContain(`SignatureMethod Algorithm="${ALGORITMO_ASSINATURA.assinatura}"`)
    expect(s).toContain(`DigestMethod Algorithm="${ALGORITMO_ASSINATURA.digest}"`)
    expect(s).toContain(`CanonicalizationMethod Algorithm="${ALGORITMO_ASSINATURA.c14n}"`)
    // a Transform C14N da Reference também lê da constante
    expect(s).toContain(`<Transform Algorithm="${ALGORITMO_ASSINATURA.c14n}"/>`)
  })

  it('o pacote reexporta a constante e as funções de assinatura (T1.6 e T1.7 as usam)', async () => {
    const pacote = await import('../src/index.js')
    expect(pacote.ALGORITMO_ASSINATURA).toBe(ALGORITMO_ASSINATURA)
    for (const nome of ['assinarXml', 'verificarAssinatura', 'lerXml', 'canonizar'] as const) {
      expect(typeof pacote[nome], nome).toBe('function')
    }
  })
})
