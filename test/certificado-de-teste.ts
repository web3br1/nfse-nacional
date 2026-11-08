// origem: AquaPrime@0e95f0c7 tests/helpers/certificado-de-teste.js:1-41
/**
 * Certificado autoassinado gerado no teste (DER mínimo do X.509 v3, RSA 2048).
 * Saiu de assinatura-xml.test.js (T2.2) para a T2.1 assinar o XML que valida no XSD; nada real entra.
 * T2.3: `hash: 'SHA-256'` e `ip` (subjectAltName) para o servidor e o cliente do mTLS local — o
 * OpenSSL 3 do Node recusa certificado SHA-1 no TLS, e sem SAN o nome do servidor não confere.
 * O padrão segue SHA-1 sem extensão, que é o que a T2.1 e a T2.2 assinam.
 */
const der = (tag, ...partes) => {
  const corpo = Buffer.concat(partes.map((p) => Buffer.from(p)))
  const n = corpo.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return Buffer.concat([Buffer.from([tag, ...len]), corpo])
}
const seq = (...p) => der(0x30, ...p)
const OID_RSA = { 'SHA-1': 0x05, 'SHA-256': 0x0b }   // sha1WithRSA / sha256WithRSA (1.2.840.113549.1.1.x)
const OID_CN = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03])
const OID_SAN = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11])
const algRsa = (hash) => seq(Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, OID_RSA[hash]]), Buffer.from([0x05, 0x00]))
const nomeCn = (cn) => seq(der(0x31, seq(OID_CN, der(0x0c, Buffer.from(cn)))))
const pem = (rotulo, buf) => `-----BEGIN ${rotulo}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${rotulo}-----\n`

// T1.6: otherName do ICP-Brasil no subjectAltName (DOC-ICP-04 7.1.2.2). `cnpj` = 2.16.76.1.3.3 (PrintableString);
// `cpf` = 2.16.76.1.3.1 (OCTET STRING: nascimento ddmmaaaa + CPF + NIS + RG...). Sem eles o certificado sai como antes.
const OID_ICP_CNPJ = [0x60, 0x4c, 0x01, 0x03, 0x03]
const OID_ICP_CPF = [0x60, 0x4c, 0x01, 0x03, 0x01]
const otherName = (oid, tag, valor) =>
  der(0xa0, Buffer.from([0x06, oid.length, ...oid]), der(0xa0, der(tag, Buffer.from(valor))))

export async function gerarCertificado({ cn = 'teste T2.2', hash = 'SHA-1', ip, cnpj, cpf, cpfCru, validade } = {}) {
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash }
  const par = await crypto.subtle.generateKey(
    { ...alg, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'])
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', par.publicKey))
  const nome = nomeCn(cn)
  const nomes = [
    ...(ip ? [der(0x87, ip.split('.').map(Number))] : []),
    ...(cnpj !== undefined ? [otherName(OID_ICP_CNPJ, 0x13, cnpj)] : []),
    ...(cpf !== undefined || cpfCru !== undefined ? [otherName(OID_ICP_CPF, 0x04, cpfCru ?? `01011990${cpf}00000000000`)] : []),
  ]
  const extensoes = nomes.length ? [der(0xa3, seq(seq(OID_SAN, der(0x04, seq(...nomes)))))] : []
  const tbs = seq(
    der(0xa0, der(0x02, [2])), der(0x02, [1]), algRsa(hash), nome,
    seq(der(0x17, Buffer.from(validade?.de ?? '260101000000Z')), der(0x17, Buffer.from(validade?.ate ?? '360101000000Z'))),
    nome, spki, ...extensoes)
  const assinatura = Buffer.from(await crypto.subtle.sign(alg, par.privateKey, tbs))
  const cert = seq(tbs, algRsa(hash), der(0x03, Buffer.concat([Buffer.from([0]), assinatura])))
  return {
    certPem: pem('CERTIFICATE', cert),
    keyPem: pem('PRIVATE KEY', Buffer.from(await crypto.subtle.exportKey('pkcs8', par.privateKey))),
  }
}
