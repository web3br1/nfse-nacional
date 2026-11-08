// Montadores de XML autorizado SINTÉTICO (nenhum dado real), no leiaute dos XSD em xsd/:
// NFSe/infNFSe(@Id = NFS + 50)/{nNFSe, dhProc, ...}; evento/infEvento/pedRegEvento/infPedReg/{chNFSe, dhEvento, eNNNNNN}.
// Não são validados no XSD (a Signature é obrigatória lá e o leitor não a confere); os caminhos vêm do XSD.
const NS = 'http://www.sped.fazenda.gov.br/nfse'
export const CHAVE = '35503082' + '1' + '12345678000195' + '0000000000017' + '2611' + '123456789' + '0'
export const ASSINATURA = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>'

export function nfseCom(o: { chave?: string; id?: string; nNFSe?: string; dhProc?: string; antes?: string; dentro?: string; raiz?: string } = {}): string {
  const chave = o.chave ?? CHAVE
  const raiz = o.raiz ?? 'NFSe'
  return `<?xml version="1.0" encoding="UTF-8"?><${raiz} xmlns="${NS}" versao="1.01">${o.antes ?? ''}`
    + `<infNFSe Id="${o.id ?? `NFS${chave}`}"><xLocEmi>Sao Paulo</xLocEmi><xLocPrestacao>Sao Paulo</xLocPrestacao>`
    + `<nNFSe>${o.nNFSe ?? '17'}</nNFSe><cStat>100</cStat><dhProc>${o.dhProc ?? '2026-11-07T10:00:00-03:00'}</dhProc>`
    + `<nDFSe>1</nDFSe>${o.dentro ?? ''}</infNFSe>${ASSINATURA}</${raiz}>`
}

export function eventoCom(o: {
  tipo?: string; chave?: string; dhEvento?: string; antes?: string; dentro?: string; grupos?: string
} = {}): string {
  const tipo = o.tipo ?? '101101'
  const chave = o.chave ?? CHAVE
  const grupo = o.grupos ?? `<e${tipo}><xDesc>Evento</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissao do documento</xMotivo></e${tipo}>`
  const ped = `<pedRegEvento versao="1.01"><infPedReg Id="PRE${chave}${tipo}"><tpAmb>2</tpAmb><verAplic>T</verAplic>`
    + `<dhEvento>${o.dhEvento ?? '2026-11-07T10:00:00-03:00'}</dhEvento><CNPJAutor>12345678000195</CNPJAutor>`
    + `<chNFSe>${chave}</chNFSe>${grupo}</infPedReg></pedRegEvento>`
  return `<?xml version="1.0" encoding="UTF-8"?><evento xmlns="${NS}" versao="1.01">${o.antes ?? ''}`
    + `<infEvento Id="EVT${chave}${tipo}"><verAplic>T</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>`
    + `<dhProc>2026-11-07T10:00:01-03:00</dhProc><nDFSe>1</nDFSe>${o.dentro ?? ''}${ped}</infEvento>${ASSINATURA}</evento>`
}
