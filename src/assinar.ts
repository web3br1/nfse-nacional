// origem: AquaPrime@0e95f0c7 supabase/functions/_shared/assinatura-xml.ts:1-275
// T2.2 — assinatura XMLDSig enveloped da NF-e, da NFC-e, da DPS e dos eventos.
// regra: docs/superpowers/plans/2026-10-10-lacunas-sem-brief/t02.2-assinatura-e-qr-code-da-nfc-e.md#a-regra · cerca: assinatura-xml.test.js
//
// Sem dependência (decisão 68): C14N 1.0 inclusiva, sem comentários, só do subconjunto que
// nós montamos (sem DOCTYPE nem instrução de processamento), e RSA-SHA1 por `crypto.subtle`,
// que existe igual no Deno da edge function, no Node do teste e no assinador local da loja.
// O documento não é reserializado: a `Signature` é inserida logo depois do elemento assinado.

const DS = 'http://www.w3.org/2000/09/xmldsig#'
/** Algoritmos da assinatura, num lugar só (G0 Q3 (a): RSA-SHA1 + C14N 1.0, até a resposta real da produção restrita, T6.1). */
export const ALGORITMO_ASSINATURA: { readonly assinatura: string; readonly digest: string; readonly c14n: string } = {
  assinatura: `${DS}rsa-sha1`,
  digest: `${DS}sha1`,
  c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
}
const C14N = ALGORITMO_ASSINATURA.c14n
const ALG_ASSINATURA = ALGORITMO_ASSINATURA.assinatura
const ALG_DIGEST = ALGORITMO_ASSINATURA.digest
const ENVELOPED = `${DS}enveloped-signature`
const NS_XML = 'http://www.w3.org/XML/1998/namespace'
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }

type Texto = { tipo: 'tx'; valor: string }
export type Elem = {
  tipo: 'el'; nome: string; prefixo: string; local: string
  attrs: { nome: string; prefixo: string; local: string; valor: string }[]
  ns: Map<string, string> // prefixo ('' = padrão) → URI, tudo o que está no escopo
  filhos: (Elem | Texto)[]; inicio: number; fim: number
}

class Recusa extends Error {}

// ---------- leitura do XML (só o subconjunto que a C14N própria cobre) ----------

function decodificar(cru: string, atributo: boolean): string {
  let s = cru.replace(/\r\n?/g, '\n')
  if (atributo) s = s.replace(/[\t\n]/g, ' ')
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g, (m, ref) => {
    if (!ref) throw new Recusa('XML malformado: & solto')
    if (ref[0] === '#') return String.fromCodePoint(ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10))
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[ref as 'amp']
  })
}

const NOME = '[A-Za-z_][\\w.\\-]*(?::[A-Za-z_][\\w.\\-]*)?'
const RE_ABRE = new RegExp(`<(${NOME})((?:\\s+${NOME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'y')
const RE_ATTR = new RegExp(`(${NOME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g')
const RE_FECHA = new RegExp(`</(${NOME})\\s*>`, 'y')

const partir = (qn: string) => {
  const i = qn.indexOf(':')
  return i < 0 ? { prefixo: '', local: qn } : { prefixo: qn.slice(0, i), local: qn.slice(i + 1) }
}

function ler(s: string): Elem {
  let i = 0
  if (s.charCodeAt(0) === 0xfeff) i = 1
  if (s.startsWith('<?xml', i)) {
    const f = s.indexOf('?>', i)
    if (f < 0) throw new Recusa('XML malformado: declaração sem fim')
    i = f + 2
  }
  let raiz: Elem | null = null
  const pilha: Elem[] = []
  while (i < s.length) {
    const topo = pilha[pilha.length - 1]
    if (s.startsWith('<!--', i)) {
      const f = s.indexOf('-->', i + 4)
      if (f < 0) throw new Recusa('XML malformado: comentário sem fim')
      i = f + 3
    } else if (s.startsWith('<!DOCTYPE', i)) {
      throw new Recusa('XML com DOCTYPE não é assinado')
    } else if (s.startsWith('<?', i)) {
      throw new Recusa('XML com instrução de processamento não é assinado')
    } else if (s.startsWith('<![CDATA[', i)) {
      const f = s.indexOf(']]>', i)
      if (!topo || f < 0) throw new Recusa('XML malformado: CDATA fora de elemento')
      topo.filhos.push({ tipo: 'tx', valor: s.slice(i + 9, f).replace(/\r\n?/g, '\n') })
      i = f + 3
    } else if (s.startsWith('</', i)) {
      RE_FECHA.lastIndex = i
      const m = RE_FECHA.exec(s)
      if (!m || !topo || m[1] !== topo.nome) throw new Recusa(`XML malformado: fechamento inesperado na posição ${i}`)
      i = RE_FECHA.lastIndex
      topo.fim = i
      pilha.pop()
    } else if (s[i] === '<') {
      RE_ABRE.lastIndex = i
      const m = RE_ABRE.exec(s)
      if (!m) throw new Recusa(`XML malformado: tag inválida na posição ${i}`)
      if (raiz && !topo) throw new Recusa('XML malformado: mais de uma raiz')
      const inicio = i
      i = RE_ABRE.lastIndex
      const ns = new Map(topo ? topo.ns : [])
      const attrs: Elem['attrs'] = []
      const vistos = new Set<string>()
      for (const a of m[2].matchAll(RE_ATTR)) {
        if (vistos.has(a[1])) throw new Recusa(`XML malformado: atributo repetido ${a[1]}`)
        vistos.add(a[1])
        const valor = decodificar(a[2] ?? a[3], true)
        if (a[1] === 'xmlns') ns.set('', valor)
        else if (a[1].startsWith('xmlns:')) ns.set(a[1].slice(6), valor)
        else attrs.push({ nome: a[1], ...partir(a[1]), valor })
      }
      const { prefixo, local } = partir(m[1])
      const vinculado = (p: string) => p === '' || p === 'xml' || ns.has(p)
      if (!vinculado(prefixo) || attrs.some((a) => !vinculado(a.prefixo))) {
        throw new Recusa(`XML malformado: prefixo sem namespace em ${m[1]}`)
      }
      const el: Elem = { tipo: 'el', nome: m[1], prefixo, local, attrs, ns, filhos: [], inicio, fim: i }
      if (topo) topo.filhos.push(el)
      else raiz = el
      if (!m[3]) pilha.push(el)
    } else {
      const f = s.indexOf('<', i) < 0 ? s.length : s.indexOf('<', i)
      const cru = s.slice(i, f)
      if (topo) topo.filhos.push({ tipo: 'tx', valor: decodificar(cru, false) })
      else if (cru.trim()) throw new Recusa('XML malformado: texto fora da raiz')
      i = f
    }
  }
  if (!raiz || pilha.length) throw new Recusa('XML malformado: elemento sem fechamento')
  return raiz
}

/** O mesmo leitor, para quem lê XML de fora (o retorno da SEFAZ, T2.3): `null` se malformado. */
export function lerXml(s: string): Elem | null {
  try { return ler(s) } catch (e) { if (e instanceof Recusa) return null; throw e }
}

export function* elementos(el: Elem): Generator<Elem> {
  yield el
  for (const f of el.filhos) if (f.tipo === 'el') yield* elementos(f)
}

const ehAssinatura = (el: Elem) => el.local === 'Signature' && el.ns.get(el.prefixo) === DS

// ---------- C14N 1.0 inclusiva, sem comentários ----------

const escTexto = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
const escAttr = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')

// `nsDoPai` é o escopo já emitido pelo ancestral de saída; no ápice ele é vazio, e por isso
// o ápice emite tudo o que herdou (é o que faz a C14N inclusiva).
export function canonizar(el: Elem, nsDoPai: Map<string, string>, enveloped: boolean): string {
  const decl: string[] = []
  for (const p of [...el.ns.keys()].sort()) {
    const uri = el.ns.get(p)!
    if (p === 'xml') continue
    if (p === '') {
      if (uri === '' ? (nsDoPai.get('') ?? '') !== '' : nsDoPai.get('') !== uri) decl.push(` xmlns="${escAttr(uri)}"`)
    } else if (nsDoPai.get(p) !== uri) decl.push(` xmlns:${p}="${escAttr(uri)}"`)
  }
  const uriDe = (p: string) => (p === '' ? '' : p === 'xml' ? NS_XML : el.ns.get(p)!)
  const attrs = el.attrs.map((a) => ({ ...a, uri: uriDe(a.prefixo) }))
    .sort((a, b) => (a.uri === b.uri ? (a.local < b.local ? -1 : 1) : a.uri < b.uri ? -1 : 1))
    .map((a) => ` ${a.nome}="${escAttr(a.valor)}"`)
  let dentro = ''
  for (const f of el.filhos) {
    if (f.tipo === 'tx') dentro += escTexto(f.valor)
    else if (!(enveloped && ehAssinatura(f))) dentro += canonizar(f, el.ns, enveloped)
  }
  return `<${el.nome}${decl.join('')}${attrs.join('')}>${dentro}</${el.nome}>`
}

// ---------- cripto ----------

const utf8 = (t: string) => new TextEncoder().encode(t)
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const deB64 = (t: string) => Uint8Array.from(atob(t.replace(/\s/g, '')), (c) => c.charCodeAt(0))
const corpoPem = (pem: string, rotulo: string) => {
  const m = new RegExp(`-----BEGIN ${rotulo}-----([A-Za-z0-9+/=\\s]+)-----END ${rotulo}-----`).exec(pem)
  return m ? m[1].replace(/\s/g, '') : null
}
const digest = async (t: string) => b64(await crypto.subtle.digest('SHA-1', utf8(t)))

/** RSA-SHA1 em Base64 com a chave PKCS#8; também assina os parâmetros do QR Code v3. */
export async function assinarRsaSha1(texto: string, keyPem: string): Promise<{ valor: string } | { motivo: string }> {
  const corpo = corpoPem(keyPem, 'PRIVATE KEY')
  if (!corpo) return { motivo: 'chave privada fora do PKCS#8' }
  try {
    const chave = await crypto.subtle.importKey('pkcs8', deB64(corpo), RSA, false, ['sign'])
    return { valor: b64(await crypto.subtle.sign(RSA, chave, utf8(texto))) }
  } catch {
    return { motivo: 'chave privada fora do PKCS#8' }
  }
}

// SubjectPublicKeyInfo do X.509: 7º campo do tbsCertificate quando há versão ([0]), 6º sem ela.
function spkiDoCertificado(der: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const tlv = (o: number) => {
    let n = der[o + 1], h = 2
    if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j++) n = n * 256 + der[o + 2 + j]; h = 2 + k }
    return { tag: der[o], ini: o + h, fim: o + h + n }
  }
  const tbs = tlv(tlv(0).ini)
  let o = tbs.ini
  if (tlv(o).tag === 0xa0) o = tlv(o).fim
  for (let campo = 0; campo < 5; campo++) o = tlv(o).fim // serial, algoritmo, emissor, validade, titular
  return der.slice(o, tlv(o).fim)
}

// ---------- API ----------

const filho = (el: Elem, local: string) => el.filhos.filter((f): f is Elem => f.tipo === 'el' && f.local === local)
const texto = (el: Elem) => el.filhos.map((f) => (f.tipo === 'tx' ? f.valor : '')).join('').trim()

function alvoPorId(raiz: Elem, id: string): Elem {
  const contagem = new Map<string, Elem[]>()
  for (const e of elementos(raiz)) {
    const a = e.attrs.find((x) => x.nome === 'Id')
    if (a) contagem.set(a.valor, [...(contagem.get(a.valor) ?? []), e])
  }
  for (const [valor, els] of contagem) if (els.length > 1) throw new Recusa(`Id duplicado: ${valor}`)
  const alvo = contagem.get(id)
  if (!alvo) throw new Recusa('elemento a assinar sem Id')
  return alvo[0]
}

export async function assinarXml(
  xml: string, { idDoElemento, certPem, keyPem }: { idDoElemento: string; certPem: string; keyPem: string },
): Promise<{ xml: string } | { motivo: string }> {
  try {
    const cert = corpoPem(certPem ?? '', 'CERTIFICATE')
    if (!cert) return { motivo: 'certificado fora do PEM' }
    const alvo = alvoPorId(ler(xml), idDoElemento)
    const valorDigest = await digest(canonizar(alvo, new Map(), true))
    const assinatura = (valor: string) => `<Signature xmlns="${DS}"><SignedInfo>`
      + `<CanonicalizationMethod Algorithm="${C14N}"/><SignatureMethod Algorithm="${ALG_ASSINATURA}"/>`
      + `<Reference URI="#${idDoElemento}"><Transforms><Transform Algorithm="${ENVELOPED}"/>`
      + `<Transform Algorithm="${C14N}"/></Transforms><DigestMethod Algorithm="${ALG_DIGEST}"/>`
      + `<DigestValue>${valorDigest}</DigestValue></Reference></SignedInfo>`
      + `<SignatureValue>${valor}</SignatureValue>`
      + `<KeyInfo><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></Signature>`
    const inserir = (valor: string) => xml.slice(0, alvo.fim) + assinatura(valor) + xml.slice(alvo.fim)
    // O SignedInfo é canonizado no lugar onde vai ficar: a C14N inclusiva herda os
    // namespaces dos ancestrais, e é assim que a SEFAZ o canoniza para conferir.
    const signedInfo = signedInfoDe(ler(inserir('')), idDoElemento)
    const r = await assinarRsaSha1(canonizar(signedInfo, new Map(), false), keyPem)
    if ('motivo' in r) return r
    return { xml: inserir(r.valor) }
  } catch (e) {
    if (e instanceof Recusa) return { motivo: e.message }
    throw e
  }
}

function signedInfoDe(raiz: Elem, id: string): Elem {
  const sig = [...elementos(raiz)].find((e) => ehAssinatura(e) && filho(filho(e, 'SignedInfo')[0], 'Reference')[0]
    ?.attrs.some((a) => a.nome === 'URI' && a.valor === `#${id}`))
  return filho(sig!, 'SignedInfo')[0]
}

/** Confere a assinatura com o certificado dado. Só para teste e para conferir antes de enviar. */
export async function verificarAssinatura(xml: string, certPem: string): Promise<boolean> {
  try {
    const raiz = ler(xml)
    const sigs = [...elementos(raiz)].filter(ehAssinatura)
    if (sigs.length !== 1) return false
    const [si] = filho(sigs[0], 'SignedInfo')
    const alg = (el: Elem | undefined) => el?.attrs.find((a) => a.nome === 'Algorithm')?.valor
    const refs = filho(si, 'Reference')
    if (alg(filho(si, 'CanonicalizationMethod')[0]) !== C14N) return false
    if (alg(filho(si, 'SignatureMethod')[0]) !== ALG_ASSINATURA || refs.length !== 1) return false
    const transforms = filho(filho(refs[0], 'Transforms')[0], 'Transform').map(alg)
    if (transforms.join(' ') !== `${ENVELOPED} ${C14N}`) return false
    if (alg(filho(refs[0], 'DigestMethod')[0]) !== ALG_DIGEST) return false
    const uri = refs[0].attrs.find((a) => a.nome === 'URI')?.valor ?? ''
    if (!uri.startsWith('#')) return false
    const alvo = alvoPorId(raiz, uri.slice(1))
    if (await digest(canonizar(alvo, new Map(), true)) !== texto(filho(refs[0], 'DigestValue')[0])) return false
    const cert = corpoPem(certPem, 'CERTIFICATE')
    if (!cert) return false
    const chave = await crypto.subtle.importKey('spki', spkiDoCertificado(deB64(cert)), RSA, false, ['verify'])
    return await crypto.subtle.verify(RSA, chave, deB64(texto(filho(sigs[0], 'SignatureValue')[0])),
      utf8(canonizar(si, new Map(), false)))
  } catch {
    return false
  }
}
