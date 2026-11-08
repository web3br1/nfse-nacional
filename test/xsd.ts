// Valida XML nos XSD oficiais versionados em xsd/. Só teste: xmllint-wasm é devDependency.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateXML } from 'xmllint-wasm'

export type ConjuntoXsd = 'v1.01-20260209' | 'PRODREST-v1.01-20261020'
export type RaizXsd = 'DPS' | 'pedRegEvento'

const ARQUIVO_RAIZ: Record<RaizXsd, string> = {
  DPS: 'DPS_v1.01.xsd',
  pedRegEvento: 'pedRegEvento_v1.01.xsd',
}

// Defeito do XSD oficial de produção (tiposSimples_v1.01.xsd, TSSerieDPS): o padrão é `^0{0,4}\d{1,5}$`.
// Em XSD, `^` e `$` são caracteres literais, então o libxml2 recusa qualquer série. O motor da Sefin
// parece tratá-los como âncoras (a restrita nem os usa). Só aqui, em memória, o padrão perde as âncoras;
// o arquivo em xsd/ continua byte a byte o do zip. `ajustar: false` valida ao pé da letra.
const PADRAO_SERIE_LITERAL = 'value="^0{0,4}\\d{1,5}$"'
const PADRAO_SERIE_AJUSTADO = 'value="0{0,4}\\d{1,5}"'

type Arquivo = { fileName: string; contents: string }
const cache = new Map<string, Arquivo[]>()

function arquivos(conjunto: ConjuntoXsd, ajustar: boolean): Arquivo[] {
  const chave = `${conjunto}|${ajustar}`
  let lista = cache.get(chave)
  if (!lista) {
    const dir = new URL(`../xsd/${conjunto}/`, import.meta.url)
    lista = readdirSync(fileURLToPath(dir))
      .filter((n) => n.endsWith('.xsd'))
      .sort()
      .map((n) => ({ fileName: n, contents: readFileSync(new URL(n, dir), 'utf8') }))
    if (ajustar && conjunto === 'v1.01-20260209') {
      const simples = lista.find((a) => a.fileName === 'tiposSimples_v1.01.xsd')
      if (!simples || simples.contents.split(PADRAO_SERIE_LITERAL).length !== 2) {
        throw new Error('o padrão literal de TSSerieDPS não aparece exatamente uma vez: o ajuste de test/xsd.ts caducou')
      }
      simples.contents = simples.contents.split(PADRAO_SERIE_LITERAL).join(PADRAO_SERIE_AJUSTADO)
    }
    cache.set(chave, lista)
  }
  return lista
}

export async function validarNoXsd(
  xml: string,
  conjunto: ConjuntoXsd,
  raiz: RaizXsd,
  opcoes: { ajustar?: boolean } = {},
): Promise<{ valido: boolean; erros: string[] }> {
  const todos = arquivos(conjunto, opcoes.ajustar ?? true)
  const nomeRaiz = ARQUIVO_RAIZ[raiz]
  const schema = todos.find((a) => a.fileName === nomeRaiz)
  if (!schema) throw new Error(`XSD raiz ausente: ${conjunto}/${nomeRaiz}`)
  const r = await validateXML({
    xml: [{ fileName: 'entrada.xml', contents: xml }],
    schema: [schema],
    preload: todos.filter((a) => a !== schema),
  })
  return { valido: r.valid, erros: r.errors.map((e) => e.message) }
}
