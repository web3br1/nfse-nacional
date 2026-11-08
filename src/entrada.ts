// Vocabulário do leiaute (nomes do XSD), de nenhum dos dois apps. Só os elementos que o
// AquaPrime produz (item 8 da T0.1); elemento fora da lista não entra.
// regra: xsd/COMPARACAO.md · cerca: test/dps.test.ts

export type Ambiente = 'producao' | 'producao-restrita'

/** CNPJ ou CPF, exatamente um. CNPJ com letra só passa no perfil `producao-restrita` (G0 Q4 (a)). */
export type Documento = { CNPJ: string; CPF?: undefined } | { CPF: string; CNPJ?: undefined }

/** Endereço nacional (`endNac`): é o único que o AquaPrime produz. */
export interface EnderecoNacional {
  cMun: string
  CEP: string
  xLgr: string
  nro: string
  xCpl?: string
  xBairro: string
}

export type Prestador = Documento & {
  IM?: string
  // Sem xNome nem end: com tpEmit = 1 o leiaute proíbe (E0121, E0128). A DPS sai sempre com tpEmit = 1.
  regTrib: {
    /** 1 não optante · 2 MEI · 3 ME/EPP. O 4 não existe nos dois XSD (xsd/COMPARACAO.md). */
    opSimpNac: 1 | 2 | 3
    /** Obrigatório com opSimpNac 3 (E0166); proibido com 1 e 2 (E0162). */
    regApTribSN?: 1 | 2 | 3
    regEspTrib: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9
  }
}

export type Tomador = Documento & {
  /** Obrigatório no perfil `producao`; opcional em `producao-restrita`. */
  xNome?: string
  end?: EnderecoNacional
}

export interface Obra {
  inscImobFisc?: string
  /** Exatamente um de `cObra`, `cCIB`, `end`. */
  cObra?: string
  cCIB?: string
  end?: { CEP: string; xLgr: string; nro: string; xCpl?: string; xBairro: string }
}

export interface Servico {
  /** Onde o serviço foi feito (7 dígitos IBGE). Não é o município de incidência. */
  cLocPrestacao: string
  cTribNac: string
  cTribMun?: string
  xDescServ: string
  cNBS?: string
  obra?: Obra
}

export interface Valores {
  /** Em reais; sai com duas casas. */
  vServ: number
  /** Dedução do ISSQN em reais (`vDedRed/vDR`). Só no perfil `producao`: a restrita não tem
   *  correspondência escrita (vAjusteBC), então recusa nomeando `valores.vDedRed`. */
  vDedRed?: { vDR: number }
  tribMun: {
    tribISSQN: 1 | 2 | 3 | 4
    tpImunidade?: 0 | 1 | 2 | 3 | 4 | 5
    tpRetISSQN: 1 | 2 | 3
    /** Percentual, 0 a 9,99. */
    pAliq?: number
  }
  tribFed?: { vRetCP?: number; vRetIRRF?: number; vRetCSLL?: number }
  totTrib: { indTotTrib: 0 } | { pTotTribSN: number }
}

export interface Substituicao {
  chSubstda: string
  cMotivo: '01' | '02' | '03' | '04' | '05' | '99'
  xMotivo?: string
}

export interface EntradaDps {
  /** 1 produção · 2 homologação. */
  tpAmb: 1 | 2
  /** `AAAA-MM-DDThh:mm:ss±hh:00` (sem `Z`). */
  dhEmi: string
  /** 1 a 49999 (E0010). */
  serie: number
  /** Sem zero à esquerda no elemento; o Id leva os zeros. */
  nDPS: number
  /** `AAAA-MM-DD`. */
  dCompet: string
  /** Município emissor (7 dígitos IBGE). */
  cLocEmi: string
  subst?: Substituicao
  prest: Prestador
  toma?: Tomador
  serv: Servico
  valores: Valores
}
