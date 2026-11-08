// regra: spec §4.1 (o pacote não lê ambiente) · cerca: este teste
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..', 'src')
// process.env, process['env'], const { env } = process, import.meta.env, import.meta['env']
const PROIBIDO = new RegExp([
  String.raw`\bprocess\s*(?:\.\s*env\b|\[\s*['"\x60]env['"\x60]\s*\])`,
  String.raw`\{[^}]*\benv\b[^}]*\}\s*=\s*process\b`,
  String.raw`\bimport\s*\.\s*meta\s*(?:\.\s*env\b|\[\s*['"\x60]env['"\x60]\s*\])`,
].join('|'))

describe('o pacote não lê variável de ambiente', () => {
  it.each([
    'process.env.X', "process['env'].X", 'const { env } = process', 'const { a, env: e } = process', 'import.meta.env.X', "import.meta['env']",
  ])('a regex pega %s', (trecho) => { expect(PROIBIDO.test(trecho)).toBe(true) })

  it('a regex não pega texto inocente', () => {
    expect(PROIBIDO.test('const environment = 1; processar(env)')).toBe(false)
  })

  it('nenhum arquivo de src/ lê o ambiente', () => {
    const arquivos = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    expect(arquivos.length).toBeGreaterThan(0) // cardinalidade: zero examinado é falha
    const ofensores = arquivos.filter((f) => PROIBIDO.test(readFileSync(join(SRC, f), 'utf8')))
    expect(ofensores).toEqual([])
  })
})
