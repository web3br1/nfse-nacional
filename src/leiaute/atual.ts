import type { Ambiente, EntradaDps } from '../entrada.js'
import { montarDpsV101, type ResultadoDps } from './v1-01/dps.js'

export const LEIAUTE_ATUAL = 'v1-01'
export type VersaoLeiaute = 'v1-01'

/** Conjunto de XSD em que a DPS de cada ambiente valida (G0 Q5 (a)). */
export const XSD_DO_AMBIENTE: Readonly<Record<Ambiente, 'v1.01-20260209' | 'PRODREST-v1.01-20261020'>> = {
  producao: 'v1.01-20260209',
  'producao-restrita': 'PRODREST-v1.01-20261020',
}

export function montarDps(
  entrada: EntradaDps,
  opcoes: { ambiente: Ambiente; versao?: VersaoLeiaute },
): ResultadoDps {
  const versao = opcoes.versao ?? LEIAUTE_ATUAL
  if (versao !== 'v1-01') return { ok: false, motivos: [`versao: leiaute ${String(versao)} não existe`] }
  return montarDpsV101(entrada, opcoes.ambiente)
}
