// origem: Luminaris@519676ab server/src/lib/nfse.ts:85-187 (parseNfseAutorizada), reduzido ao que a T1.6 devolve
// Adaptações: fast-xml-parser → lerXml (src/assinar.ts); lança → { ok: false, motivo }; sem verifyNfseSignature
// (a assinatura da Sefin não é conferida aqui: restrição da T1.6); caminho exato a partir da raiz em vez de
// objeto achado por nome; só chave, número e dhProc (o resto do ParsedNfse não é desta tarefa).
// regra: XSD tiposComplexos_v1.01.xsd TCNFSe/TCInfNFSe e tiposSimples TSIdNFSe/TSNNFSe · cerca: test/leitores.test.ts
import { Recusa, filhoUnico, protegido, raizDe, valorDe, dataHoraDe, type Falha } from './ler-comum.js'

export type ResultadoNfse = { ok: true; chave: string; numero: string; dhProc: string; dataProc: string } | Falha

// TSIdNFSe = "NFS" + 50: produção só dígitos; produção-restrita admite o CNPJ com letra (índices 9..22 da chave).
const ID_NFSE = /^NFS(?:\d{50}|\d{9}[0-9A-Z]{14}\d{27})$/
const NUMERO = /^[1-9]\d{0,12}$/ // TSNNFSe

/**
 * Lê a NFS-e autorizada em NFSe/infNFSe. Nunca lança. A assinatura NÃO é conferida aqui.
 * Dois `infNFSe` filhos da raiz, ou uma raiz que não é `NFSe`, recusam; um `infNFSe` mais fundo (forjado) nunca é lido.
 */
export function lerNfse(xml: string): ResultadoNfse {
  return protegido((): ResultadoNfse => {
    const inf = filhoUnico(raizDe(xml, 'NFSe'), 'infNFSe')
    const id = inf.attrs.find((a) => a.nome === 'Id')?.valor ?? ''
    if (!ID_NFSE.test(id)) throw new Recusa(`infNFSe/@Id "${id.slice(0, 60)}" fora de NFS + 50 posições`)
    const numero = valorDe(inf, 'nNFSe', NUMERO, '1 a 13 dígitos, sem zero à esquerda')
    const { dh, dia } = dataHoraDe(inf, 'dhProc')
    return { ok: true, chave: id.slice(3), numero, dhProc: dh, dataProc: dia }
  })
}
