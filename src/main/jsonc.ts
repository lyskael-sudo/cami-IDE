/**
 * Parses the JSON-with-comments dialect used by IDE configuration files.
 * Comments are removed only outside strings; trailing commas are accepted.
 */
export function parseJsonc<T = unknown>(source: string): T {
  const normalized = source.replace(/^\uFEFF/, '')
  let output = ''
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? ''
    const next = normalized[index + 1] ?? ''

    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false
        output += character
      }
      continue
    }

    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      } else if (character === '\n' || character === '\r') {
        output += '\n'
      }
      continue
    }

    if (inString) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      output += character
      continue
    }

    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }

    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }

    output += character
  }

  let cleaned = ''
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index] ?? ''
    if (character === ',' || character === '}' || character === ']') {
      let cursor = index + 1
      while (cursor < output.length && /\s/.test(output[cursor] ?? '')) {
        cursor += 1
      }
      if (character === ',' && (output[cursor] === '}' || output[cursor] === ']')) {
        continue
      }
    }
    cleaned += character
  }

  return JSON.parse(cleaned) as T
}
