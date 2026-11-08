// Gera src/versao.ts a partir da versão do package.json.
import { readFileSync, writeFileSync } from 'node:fs'

const raiz = new URL('../', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', raiz), 'utf8'))
if (typeof version !== 'string' || version === '') throw new Error('package.json sem version')

writeFileSync(
  new URL('src/versao.ts', raiz),
  `// gerado por scripts/gerar-versao.mjs — não edite\nexport const VERSAO_PACOTE = ${JSON.stringify(version)};\n`,
)
