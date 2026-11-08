// regra: spec §4.1 (o pacote não lê ambiente) · cerca: este teste
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..', 'src')
const PROIBIDOS = ['process' + '.env', 'import.meta' + '.env']

describe('o pacote não lê variável de ambiente', () => {
  it('nenhum arquivo de src/ usa process.env nem import.meta.env', () => {
    const arquivos = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    expect(arquivos.length).toBeGreaterThan(0) // cardinalidade: zero examinado é falha
    const ofensores = arquivos.filter((f) => PROIBIDOS.some((p) => readFileSync(join(SRC, f), 'utf8').includes(p)))
    expect(ofensores).toEqual([])
  })
})
