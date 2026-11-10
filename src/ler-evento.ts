// origem: Luminaris@519676ab server/src/lib/nfseEvento.ts:34-67 (parseEventoCancelamento; o brief citava :191-224,
// que não existe neste commit). Adaptações: fast-xml-parser → lerXml; lança → { ok: false, motivo }; sem
// verifyNfseEventoSignature; lê qualquer tipo do xs:choice do XSD (os 16) e devolve o tipo, em vez de só o
// cancelamento; dhEvento de infPedReg (o Luminaris lia infEvento/dhProc); caminho exato a partir da raiz.
// regra: XSD tiposEventos_v1.01.xsd TCEvento/TCInfEvento/TCPedRegEvt/TCInfPedReg · cerca: test/leitores.test.ts
import { Recusa, filhoUnico, filhosEl, noNamespace, protegido, raizDe, valorDe, dataHoraDe, type Falha } from './ler-comum.js'

export type ResultadoEvento = { ok: true; tipo: string; chave: string; dhEvento: string; dataEvento: string } | Falha

// TSChaveNFSe dos dois conjuntos de XSD: produção só dígitos; restrita [0-9]{6}[0-9A-Z]{14}[0-9]{30}.
const CHAVE = /^(?:\d{50}|\d{6}[0-9A-Z]{14}\d{30})$/
// O xs:choice de TCInfPedReg inteiro, igual nos dois XSD v1.01 (16 grupos, na ordem do XSD). O leitor não
// interpreta o tipo; quem decide se o evento extingue a nota é o chamador.
const TIPOS = new Set([
  '101101', '105102', '101103', '105104', '105105',
  '202201', '203202', '204203', '205204', '202205', '203206', '204207', '205208',
  '305101', '305102', '305103',
])

/**
 * Lê o evento em evento/infEvento/pedRegEvento/infPedReg. Nunca lança. A assinatura NÃO é conferida aqui.
 * Elemento repetido em qualquer degrau do caminho recusa; um forjado mais fundo nunca é lido.
 */
export function lerEvento(xml: string): ResultadoEvento {
  return protegido((): ResultadoEvento => {
    const raiz = raizDe(xml, 'evento')
    const ped = filhoUnico(filhoUnico(filhoUnico(raiz, 'infEvento'), 'pedRegEvento'), 'infPedReg')
    const chave = valorDe(ped, 'chNFSe', CHAVE, '50 posições')
    const grupos = filhosEl(ped).filter((f) => /^e\d{6}$/.test(f.local) && noNamespace(f))
    if (grupos.length !== 1) throw new Recusa(`esperado exatamente 1 grupo de evento (eNNNNNN) em infPedReg, achei ${grupos.length}`)
    const tipo = grupos[0].local.slice(1)
    if (!TIPOS.has(tipo)) throw new Recusa(`tipo de evento ${tipo} fora do XSD`)
    const { dh, dia } = dataHoraDe(ped, 'dhEvento')
    return { ok: true, tipo, chave, dhEvento: dh, dataEvento: dia }
  })
}
