// Validadores e escape comuns aos documentos do leiaute v1.01 (DPS e pedido de evento). Sem dependência de XML.
// regra: xsd/COMPARACAO.md · cerca: test/dps.test.ts, test/evento.test.ts

export const NS = 'http://www.sped.fazenda.gov.br/nfse'

// Padrões copiados dos dois XSD (TSString, TSDateTimeUTC, TSData).
export const TSSTRING = /^(?:[!-ÿ][ -ÿ]*[!-ÿ]|[!-ÿ])$/
export const DH_EMI = /^20\d\d-\d\d-\d\dT(?:20|21|22|23|[01]\d):[0-5]\d:[0-5]\d(?:[+-](?:0\d|10|11):00|\+12:00)$/
export const DATA = /^(20\d\d)-(\d\d)-(\d\d)$/
export const CONTROLE_XML = /[\u0000-\u0008\u000B-\u001F￾￿]/

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export const el = (nome: string, conteudo: string | undefined) => (conteudo === undefined ? '' : `<${nome}>${conteudo}</${nome}>`)

export class Validacao {
  readonly motivos: string[] = []
  falha(campo: string, msg: string) {
    this.motivos.push(`${campo}: ${msg}`)
  }

  /** Texto escapado, ou undefined (com motivo, se obrigatório ou inválido). */
  texto(
    campo: string,
    v: unknown,
    o: { min?: number; max: number; obrigatorio?: boolean; tsString?: boolean; naoBranco?: boolean },
  ): string | undefined {
    if (v === undefined || v === null) {
      if (o.obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'string') {
      this.falha(campo, 'deve ser texto')
      return undefined
    }
    // isWellFormed é ES2024; Node >= 22.12 tem.
    if (!(v as unknown as { isWellFormed(): boolean }).isWellFormed()) {
      this.falha(campo, 'tem surrogate solto (UTF-16 malformado)')
      return undefined
    }
    const n = [...v].length
    if (n < (o.min ?? 1) || n > o.max) {
      this.falha(campo, `deve ter de ${o.min ?? 1} a ${o.max} caracteres`)
      return undefined
    }
    if (CONTROLE_XML.test(v)) {
      this.falha(campo, 'tem caractere de controle que o XML não admite (inclui CR)')
      return undefined
    }
    if (o.naoBranco && v.trim() === '') {
      this.falha(campo, 'não pode ser só espaços')
      return undefined
    }
    if (o.tsString && !TSSTRING.test(v)) {
      this.falha(campo, 'caractere fora de U+0021..U+00FF ou espaço no início ou no fim (TSString)')
      return undefined
    }
    return esc(v)
  }

  padrao(campo: string, v: unknown, re: RegExp, descricao: string, obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'string' || !re.test(v)) {
      this.falha(campo, `deve ser ${descricao}`)
      return undefined
    }
    return v
  }

  enumeracao(campo: string, v: unknown, validos: readonly (string | number)[], obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if ((typeof v !== 'string' && typeof v !== 'number') || !validos.some((x) => String(x) === String(v))) {
      this.falha(campo, `deve ser um de ${validos.join(', ')}`)
      return undefined
    }
    return String(v)
  }

  /** Decimal com duas casas (arredonda em centavos antes de formatar). `maximo` em unidades. */
  decimal(campo: string, v: unknown, maximo: number, obrigatorio = true): string | undefined {
    if (v === undefined || v === null) {
      if (obrigatorio) this.falha(campo, 'obrigatório')
      return undefined
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      this.falha(campo, 'deve ser número finito maior ou igual a zero')
      return undefined
    }
    const centavos = Math.round(v * 100)
    // O pacote não arredonda dinheiro em silêncio: só o ruído binário (0.1 + 0.2) passa; 1.005 volta motivo.
    if (Math.abs(v * 100 - centavos) >= 1e-6) {
      this.falha(campo, 'tem fração de centavo; informe o valor já arredondado em centavos')
      return undefined
    }
    if (!Number.isSafeInteger(centavos) || centavos > Math.round(maximo * 100)) {
      this.falha(campo, `deve ser no máximo ${maximo}`)
      return undefined
    }
    return (centavos / 100).toFixed(2)
  }

  dataReal(campo: string, v: unknown): string | undefined {
    const m = typeof v === 'string' ? DATA.exec(v) : null
    if (!m) {
      this.falha(campo, 'deve ser AAAA-MM-DD')
      return undefined
    }
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const d = new Date(Date.UTC(ano, mes - 1, dia))
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
      this.falha(campo, 'data inexistente')
      return undefined
    }
    return v as string
  }
}
