import type { EntradaDps } from '../src/index.js'

// Fixture sintética: nenhum dado real.
export const entradaBase: EntradaDps = {
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
