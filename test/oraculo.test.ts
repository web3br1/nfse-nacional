// Oráculo diferencial: a DPS do pacote contra a da open-nfse@0.11.1 (devDependency de teste, nenhum byte em produção).
// Perfil de produção (G0 Q5): a open-nfse segue o leiaute de produção, não o da restrita.
// Assinatura fora da comparação: nenhuma das duas DPS é assinada aqui (auditoria T0.2 §4).
// regra: docs/auditoria/2026-11-07-open-nfse-leitura.md §5 · cerca: test/oraculo.test.ts
import { describe, expect, it } from 'vitest'
import { buildDpsXml } from 'open-nfse'
import { canonizar, lerXml, montarDps, type EntradaDps } from '../src/index.js'
import { type Elem } from '../src/assinar.js'
import { entradas, paraOpenNfse } from './fixtures/entradas.js'
import { validarNoXsd } from './xsd.js'

type Diferenca = { caminho: string; nossa: string | undefined; deles: string | undefined }
type Aceita = {
  caminho: string
  /** Fonte oficial e qual lado está certo. */
  motivo: string
  /** Restringe a aceita ao tipo de diferença descrito no motivo; sem isso um valor errado no mesmo caminho passaria. */
  quando: (nossa: string | undefined, deles: string | undefined) => boolean
}

// Cada linha cita a fonte oficial (xsd/v1.01-20260209/, arquivo:linha) e diz quais lados estão certos.
// Diferença sem fonte é parada (regra 4): não entra aqui.
const mesmoNumero = (a?: string, b?: string) => a !== undefined && b !== undefined && Number(a) === Number(b)
const mesmoInstante = (a?: string, b?: string) =>
  a !== undefined && b !== undefined && !Number.isNaN(Date.parse(a)) && Date.parse(a) === Date.parse(b)

const MOTIVO_DECIMAL =
  'tiposSimples_v1.01.xsd:1438 (TSDec15V2: forma inteira ou com duas casas) aceita as duas formas: os dois lados estão certos. ' +
  'O pacote sempre emite duas casas ("150.00"); a open-nfse emite a forma inteira quando o número é inteiro (build-xml.js formatDecimal, "150"). Mesmo valor.'

export const DIFERENCAS_ACEITAS: Aceita[] = [
  { caminho: '/DPS/infDPS/valores/vServPrest/vServ', motivo: MOTIVO_DECIMAL, quando: mesmoNumero },
  { caminho: '/DPS/infDPS/valores/trib/tribFed/vRetIRRF', motivo: MOTIVO_DECIMAL, quando: mesmoNumero },
  {
    caminho: '/DPS/infDPS/dhEmi',
    motivo:
      'tiposSimples_v1.01.xsd:146 (TSDateTimeUTC) aceita qualquer deslocamento de -11:00 a +12:00: os dois lados estão certos. ' +
      'O pacote preserva o deslocamento informado ("10:00:00-04:00"); a open-nfse converte para -03:00 fixo ("11:00:00-03:00", build-xml.js formatDateTime). Mesmo instante.',
    quando: mesmoInstante,
  },
]

// ---------- leitura e comparação ----------

const semDeclaracao = (xml: string) => xml.replace(/^<\?xml[^>]*\?>/, '')
const lerSemAssinatura = (xml: string): Elem => {
  const raiz = lerXml(semDeclaracao(xml))
  if (!raiz) throw new Error('XML ilegível no oráculo')
  const tira = (e: Elem): Elem => ({
    ...e,
    filhos: e.filhos.filter((f) => !(f.tipo === 'el' && f.local === 'Signature')).map((f) => (f.tipo === 'el' ? tira(f) : f)),
  })
  return tira(raiz)
}

/** Texto canônico (C14N 1.0) sem `<Signature>`, por um caminho independente da comparação por folhas. */
export const canonizarSemAssinatura = (xml: string) => canonizar(lerSemAssinatura(xml), new Map(), true)

function folhas(e: Elem, caminho: string, saida: Map<string, string>, ordens: Map<string, string>) {
  saida.set(`${caminho}/@ns`, e.ns.get(e.prefixo) ?? '')
  for (const a of e.attrs) {
    if (a.nome === 'xmlns' || a.nome.startsWith('xmlns:')) continue
    saida.set(`${caminho}/@${a.local}`, a.valor)
  }
  const filhos = e.filhos.filter((f): f is Elem => f.tipo === 'el')
  if (filhos.length === 0) {
    saida.set(caminho, e.filhos.map((f) => (f.tipo === 'tx' ? f.valor : '')).join(''))
    return
  }
  ordens.set(caminho, filhos.map((f) => f.local).join(','))
  const total = new Map<string, number>()
  for (const f of filhos) total.set(f.local, (total.get(f.local) ?? 0) + 1)
  const n = new Map<string, number>()
  for (const f of filhos) {
    const i = (n.get(f.local) ?? 0) + 1
    n.set(f.local, i)
    const nome = (total.get(f.local) ?? 0) > 1 ? `${f.local}[${i}]` : f.local
    folhas(f, `${caminho}/${nome}`, saida, ordens)
  }
}

/** Compara elemento a elemento por caminho (`/DPS/infDPS/prest/CNPJ`) e a ordem dos filhos (`…/#ordem`). */
export function diferencas(nossaXml: string, delesXml: string): Diferenca[] {
  const a = new Map<string, string>(), b = new Map<string, string>()
  const oa = new Map<string, string>(), ob = new Map<string, string>()
  const ra = lerSemAssinatura(nossaXml), rb = lerSemAssinatura(delesXml)
  folhas(ra, `/${ra.local}`, a, oa)
  folhas(rb, `/${rb.local}`, b, ob)
  const saida: Diferenca[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) !== b.get(k)) saida.push({ caminho: k, nossa: a.get(k), deles: b.get(k) })
  }
  for (const k of new Set([...oa.keys(), ...ob.keys()])) {
    const sa = oa.get(k)?.split(',') ?? [], sb = ob.get(k)?.split(',') ?? []
    const comum = (s: string[], o: string[]) => s.filter((x) => o.includes(x)).join(',')
    if (comum(sa, sb) !== comum(sb, sa)) saida.push({ caminho: `${k}/#ordem`, nossa: sa.join(','), deles: sb.join(',') })
  }
  return saida
}

const aceitaCobre = (a: Aceita, d: Diferenca) => a.caminho === d.caminho && a.quando(d.nossa, d.deles)
export const naoAceitas = (ds: Diferenca[], aceitas: Aceita[]) => ds.filter((d) => !aceitas.some((a) => aceitaCobre(a, d)))
export const aceitasSemOcorrencia = (ds: Diferenca[], aceitas: Aceita[]) => aceitas.filter((a) => !ds.some((d) => aceitaCobre(a, d)))

// ---------- as duas DPS ----------

const AMBIENTE = { ambiente: 'producao' } as const
function dpsNossa(e: EntradaDps): string {
  const r = montarDps(e, AMBIENTE)
  if (!r.ok) throw new Error(`montarDps recusou: ${r.motivos.join('; ')}`)
  return r.xml
}
const dpsDaOpenNfse = async (e: EntradaDps) => buildDpsXml(paraOpenNfse(e))

const casos = Object.entries(entradas)
async function todasAsDiferencas() {
  const por = new Map<string, Diferenca[]>()
  for (const [nome, e] of casos) por.set(nome, diferencas(dpsNossa(e), await dpsDaOpenNfse(e)))
  return por
}

describe('oráculo: DPS do pacote × open-nfse@0.11.1 (perfil de produção)', () => {
  it('há ao menos cinco fixtures sintéticas', () => {
    expect(casos.length).toBeGreaterThanOrEqual(5)
  })

  it.each(casos)('%s: a DPS do pacote = a da open-nfse, a menos das diferenças aceitas', async (_, e) => {
    const nossa = dpsNossa(e)
    const deles = await dpsDaOpenNfse(e)
    expect(naoAceitas(diferencas(nossa, deles), DIFERENCAS_ACEITAS)).toEqual([])
  })

  it('o texto canônico sem assinatura concorda com a comparação por caminho (segundo caminho de medição)', async () => {
    let examinadas = 0
    for (const [, e] of casos) {
      const nossa = dpsNossa(e), deles = await dpsDaOpenNfse(e)
      examinadas++
      // canônico idêntico <=> nenhuma diferença por caminho; qualquer divergência entre os dois métodos é defeito do oráculo
      expect(canonizarSemAssinatura(nossa) === canonizarSemAssinatura(deles)).toBe(diferencas(nossa, deles).length === 0)
    }
    expect(examinadas).toBe(casos.length)
    expect(examinadas).toBeGreaterThan(0)
  })

  it('toda diferença aceita ainda acontece em alguma fixture', async () => {
    const por = await todasAsDiferencas()
    const todas = [...por.values()].flat()
    expect(por.size).toBeGreaterThanOrEqual(5) // zero fixtures examinadas seria verde universal
    expect(todas.length).toBeGreaterThan(0)
    expect(aceitasSemOcorrencia(todas, DIFERENCAS_ACEITAS).map((a) => a.caminho)).toEqual([])
  })

  it('controle positivo: uma aceita fictícia que não ocorre é lixo e o teste de lixo a pega', async () => {
    const todas = [...(await todasAsDiferencas()).values()].flat()
    const ficticia: Aceita = { caminho: '/DPS/infDPS/campoQueNaoExiste', motivo: 'fictícia', quando: () => true }
    expect(aceitasSemOcorrencia(todas, [...DIFERENCAS_ACEITAS, ficticia]).map((a) => a.caminho)).toEqual([ficticia.caminho])
    // e a aceita de caminho certo com valor errado não cobre a diferença (o `quando` aperta)
    const errada: Diferenca = { caminho: '/DPS/infDPS/valores/vServPrest/vServ', nossa: '150.00', deles: '160' }
    expect(naoAceitas([errada], DIFERENCAS_ACEITAS)).toEqual([errada])
  })

  it('controle negativo do comparador: zeros à esquerda no nDPS aparecem em /DPS/infDPS/nDPS', () => {
    const nossa = dpsNossa(entradas['prestador CNPJ e tomador CPF'])
    const torta = nossa.replace('<nDPS>1</nDPS>', '<nDPS>000000000000001</nDPS>')
    expect(torta).not.toBe(nossa)
    expect(diferencas(torta, nossa)).toEqual([{ caminho: '/DPS/infDPS/nDPS', nossa: '000000000000001', deles: '1' }])
  })

  it('controle negativo: ordem trocada de elementos é apontada e a assinatura é ignorada', () => {
    const nossa = dpsNossa(entradas['prestador CNPJ e tomador CPF'])
    const trocada = nossa.replace('<serie>1</serie><nDPS>1</nDPS>', '<nDPS>1</nDPS><serie>1</serie>')
    expect(trocada).not.toBe(nossa)
    expect(diferencas(trocada, nossa).map((d) => d.caminho)).toEqual(['/DPS/infDPS/#ordem'])
    const assinada = nossa.replace('</DPS>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>x</SignatureValue></Signature></DPS>')
    expect(assinada).not.toBe(nossa)
    expect(diferencas(assinada, nossa)).toEqual([])
    expect(canonizarSemAssinatura(assinada)).toBe(canonizarSemAssinatura(nossa)) // o canônico também ignora a assinatura (lado "idêntico")
    expect(canonizarSemAssinatura(trocada)).not.toBe(canonizarSemAssinatura(nossa)) // e vê a ordem (lado "diferente")
  })
})

describe('oráculo: cada DPS valida no XSD de produção (v1.01-20260209)', () => {
  it.each(casos)('%s: a do pacote valida', async (_, e) => {
    expect(await validarNoXsd(dpsNossa(e), 'v1.01-20260209', 'DPS')).toEqual({ valido: true, erros: [] })
  })

  // A validade da open-nfse é achado, não verdade: o que ela falhar fica registrado aqui, nomeado.
  const ACHADOS_OPEN_NFSE_INVALIDA: Record<string, string> = {}
  it('a da open-nfse valida, exceto o que está registrado como achado', async () => {
    const invalidas: Record<string, string> = {}
    let examinadas = 0
    for (const [nome, e] of casos) {
      examinadas++
      const r = await validarNoXsd(await dpsDaOpenNfse(e), 'v1.01-20260209', 'DPS')
      if (!r.valido) invalidas[nome] = r.erros.join(' | ')
    }
    expect(examinadas).toBe(casos.length)
    expect(Object.keys(invalidas).sort()).toEqual(Object.keys(ACHADOS_OPEN_NFSE_INVALIDA).sort())
  })

  it('controle do validador: a DPS sem dCompet é recusada', async () => {
    const xml = dpsNossa(entradas['prestador CNPJ e tomador CPF']).replace(/<dCompet>[^<]*<\/dCompet>/, '')
    const r = await validarNoXsd(xml, 'v1.01-20260209', 'DPS')
    expect(r.valido).toBe(false)
    expect(r.erros.join(' ')).toContain('dCompet')
  })
})
