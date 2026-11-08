// Entradas sintéticas do oráculo (nenhum dado real) e a tradução para a entrada da open-nfse.
// Mapeamento: docs/auditoria/2026-11-07-open-nfse-leitura.md §5 (AquaPrime), chamando buildDpsXml direto.
import { buildDpsId } from 'open-nfse'
import type { EntradaDps } from '../../src/index.js'
import { VERSAO_PACOTE } from '../../src/index.js'
import { entradaBase } from '../fixtures.js'

// Perfil de produção (G0 Q5): tpAmb 1.
const base: EntradaDps = { ...entradaBase, tpAmb: 1 }
const CHAVE_50 = '35' + '2'.repeat(48)

export const entradas: Record<string, EntradaDps> = {
  'prestador CNPJ e tomador CPF': base,
  'tomador CNPJ': { ...base, toma: { CNPJ: '98765432000198', xNome: 'Empresa Sintetica', end: base.toma!.end } },
  'retencao de ISS com aliquota e tributos federais': {
    ...base,
    nDPS: 123456789,
    serie: 49999,
    valores: {
      vServ: 1234.56,
      tribMun: { tribISSQN: 1, tpRetISSQN: 2, pAliq: 2.5 },
      tribFed: { vRetCP: 10.5, vRetIRRF: 20, vRetCSLL: 3.25 },
      totTrib: { indTotTrib: 0 },
    },
  },
  'substituicao': {
    ...base,
    nDPS: 7,
    subst: { chSubstda: CHAVE_50, cMotivo: '01', xMotivo: 'Desenquadramento do Simples Nacional' },
  },
  'sem tomador': { ...base, nDPS: 8, toma: undefined },
  'prestador CPF': {
    ...base,
    nDPS: 9,
    prest: { CPF: '12345678909', IM: '999', regTrib: { opSimpNac: 1, regEspTrib: 0 } },
  },
  'MEI com deducao, cTribMun, cNBS e obra': {
    ...base,
    nDPS: 10,
    prest: { CNPJ: '12345678000195', regTrib: { opSimpNac: 2, regEspTrib: 0 } },
    serv: {
      cLocPrestacao: '3304557',
      cTribNac: '070201',
      cTribMun: '001',
      xDescServ: 'Obra de piscina',
      cNBS: '112012000',
      obra: { inscImobFisc: 'INSC-1', cObra: 'OBRA-77' },
    },
    valores: {
      vServ: 500,
      vDedRed: { vDR: 50.1 },
      tribMun: { tribISSQN: 1, tpRetISSQN: 1 },
      totTrib: { indTotTrib: 0 },
    },
  },
  'descricao com caracteres especiais e complemento': {
    ...base,
    nDPS: 11,
    toma: {
      CPF: '12345678909',
      xNome: 'Cliente & "Filho" <teste>',
      end: { cMun: '3550308', CEP: '01001000', xLgr: 'Rua A&B', nro: 's/n', xCpl: 'Bloco 2', xBairro: 'Centro' },
    },
    serv: { cLocPrestacao: '3550308', cTribNac: '070201', xDescServ: 'Limpeza <filtro> & "casa de maquinas"' },
  },
  'fuso fora de Brasilia': { ...base, nDPS: 12, dhEmi: '2026-11-07T10:00:00-04:00' },
}

/** Instante e data de competência como `Date`, sem depender do fuso da máquina. */
const instante = (s: string) => new Date(s)
const dataBrt = (s: string) => new Date(`${s}T12:00:00-03:00`)

const ident = (d: { CNPJ?: string; CPF?: string }) => (d.CNPJ !== undefined ? { CNPJ: d.CNPJ } : { CPF: d.CPF! })
const endereco = (e: NonNullable<EntradaDps['toma']>['end']) =>
  e && {
    localidade: { endNac: { cMun: e.cMun, CEP: e.CEP } },
    xLgr: e.xLgr,
    nro: e.nro,
    ...(e.xCpl !== undefined ? { xCpl: e.xCpl } : {}),
    xBairro: e.xBairro,
  }

/** Traduz a entrada do pacote para o `DPS` da open-nfse (`buildDpsXml`). `verAplic` fixo = versão do pacote. */
export function paraOpenNfse(e: EntradaDps): any {
  const inscricao = e.prest.CNPJ ?? e.prest.CPF!
  return {
    versao: '1.01',
    infDPS: {
      Id: buildDpsId({
        cLocEmi: e.cLocEmi,
        tipoInsc: e.prest.CNPJ !== undefined ? 'CNPJ' : 'CPF',
        inscricaoFederal: inscricao,
        serie: String(e.serie),
        nDPS: String(e.nDPS),
      }),
      tpAmb: String(e.tpAmb),
      dhEmi: instante(e.dhEmi),
      verAplic: VERSAO_PACOTE,
      serie: String(e.serie),
      nDPS: String(e.nDPS),
      dCompet: dataBrt(e.dCompet),
      tpEmit: '1',
      cLocEmi: e.cLocEmi,
      ...(e.subst ? { subst: { ...e.subst } } : {}),
      prest: {
        identificador: ident(e.prest),
        ...(e.prest.IM !== undefined ? { IM: e.prest.IM } : {}),
        regTrib: { ...e.prest.regTrib, opSimpNac: String(e.prest.regTrib.opSimpNac), regEspTrib: String(e.prest.regTrib.regEspTrib),
          ...(e.prest.regTrib.regApTribSN !== undefined ? { regApTribSN: String(e.prest.regTrib.regApTribSN) } : {}) },
      },
      ...(e.toma
        ? {
            toma: {
              identificador: ident(e.toma),
              ...(e.toma.xNome !== undefined ? { xNome: e.toma.xNome } : {}),
              ...(e.toma.end ? { end: endereco(e.toma.end) } : {}),
            },
          }
        : {}),
      serv: {
        locPrest: { cLocPrestacao: e.serv.cLocPrestacao },
        cServ: {
          cTribNac: e.serv.cTribNac,
          ...(e.serv.cTribMun !== undefined ? { cTribMun: e.serv.cTribMun } : {}),
          xDescServ: e.serv.xDescServ,
          ...(e.serv.cNBS !== undefined ? { cNBS: e.serv.cNBS } : {}),
        },
        ...(e.serv.obra
          ? {
              obra: {
                ...(e.serv.obra.inscImobFisc !== undefined ? { inscImobFisc: e.serv.obra.inscImobFisc } : {}),
                identificacao: { cObra: e.serv.obra.cObra },
              },
            }
          : {}),
      },
      valores: {
        vServPrest: { vServ: e.valores.vServ },
        ...(e.valores.vDedRed ? { vDedRed: { vDR: e.valores.vDedRed.vDR } } : {}),
        trib: {
          tribMun: {
            tribISSQN: String(e.valores.tribMun.tribISSQN),
            ...(e.valores.tribMun.tpImunidade !== undefined ? { tpImunidade: String(e.valores.tribMun.tpImunidade) } : {}),
            tpRetISSQN: String(e.valores.tribMun.tpRetISSQN),
            ...(e.valores.tribMun.pAliq !== undefined ? { pAliq: e.valores.tribMun.pAliq } : {}),
          },
          ...(e.valores.tribFed ? { tribFed: { ...e.valores.tribFed } } : {}),
          totTrib: 'indTotTrib' in e.valores.totTrib ? { indTotTrib: String(e.valores.totTrib.indTotTrib) } : { pTotTribSN: e.valores.totTrib.pTotTribSN },
        },
      },
    },
  }
}
