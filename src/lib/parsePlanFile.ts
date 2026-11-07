export const MAX_PLAN_BYTES = 256 * 1024

export type ParsePlanResult = { ok: true; plan: Record<string, unknown> } | { ok: false; message: string }

const fail = (message: string): ParsePlanResult => ({ ok: false, message })

/**
 * Index of the first character that makes `text` invalid JSON, or null when it is valid.
 * Browsers word JSON.parse errors differently (and some give no position at all), so the location
 * we show comes from this small scanner and not from the error message.
 */
function firstJsonError(text: string): number | null {
  let i = 0
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const literal = (word: string): boolean => {
    for (const ch of word) {
      if (text[i] !== ch) return false
      i++
    }
    return true
  }
  const string = (): boolean => {
    i++ // opening quote
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i++
        return true
      }
      if (c < ' ') return false
      if (c === '\\') {
        i++
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) return false
          i += 4
        } else if (!'"\\/bfnrt'.includes(text[i] ?? '')) return false
      }
      i++
    }
    return false
  }
  const close = (): boolean => {
    i++
    return true
  }
  const number = (): boolean => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m) return false
    i += m[0].length
    return true
  }
  const value = (): boolean => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') return close()
      for (;;) {
        ws()
        if (text[i] !== '"' || !string()) return false
        ws()
        if (text[i] !== ':') return false
        i++
        if (!value()) return false
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') return close()
        return false
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') return close()
      for (;;) {
        if (!value()) return false
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') return close()
        return false
      }
    }
    if (c === '"') return string()
    if (c === 't') return literal('true')
    if (c === 'f') return literal('false')
    if (c === 'n') return literal('null')
    return number()
  }
  if (!value()) return i
  ws()
  return i < text.length ? i : null
}

function lineAndColumn(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.min(index, text.length))
  const line = before.split('\n').length
  return { line, column: index - (before.lastIndexOf('\n') + 1) + 1 }
}

export function parsePlanText(text: string): ParsePlanResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    const fromMessage = /position (\d+)/.exec(e instanceof Error ? e.message : '')
    const at = firstJsonError(text) ?? (fromMessage ? Number(fromMessage[1]) : text.length)
    const { line, column } = lineAndColumn(text, at)
    return fail(`plan.json isn't valid JSON (line ${line}, column ${column})`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('plan.json must be a JSON object')
  return { ok: true, plan: parsed as Record<string, unknown> }
}

/** Checks the name and size before reading, then parses. The server does all the real validating. */
export async function parsePlanFile(file: File): Promise<ParsePlanResult> {
  if (!file.name.toLowerCase().endsWith('.json')) return fail('Choose a .json file')
  if (file.size > MAX_PLAN_BYTES) return fail('plan.json is too big (256 KB at most)')
  return parsePlanText(await file.text())
}
