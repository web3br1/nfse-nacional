import { readFileSync } from 'node:fs'

export * from './id.js'

// O package.json fica um nível acima de src/ e de dist/.
export const VERSAO_PACOTE: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version
