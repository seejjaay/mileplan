export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

const URL_RE = /https?:\/\/[^\s<>"]+/g
const TRAILING_PUNCT = /[.,;:!?]$/

function count(s: string, ch: string): number {
  return s.split(ch).length - 1
}

/** Drops sentence punctuation and any ")" with no "(" inside the match, so "(see https://x.dev/a_(b))" keeps its own parens. */
function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    if (TRAILING_PUNCT.test(url)) url = url.slice(0, -1)
    else if (url.endsWith(')') && count(url, ')') > count(url, '(')) url = url.slice(0, -1)
    else return url
  }
}

/** Splits plain text into text and http(s) link segments; joining every segment's `text` gives the input back. */
export function linkify(input: string): Segment[] {
  const out: Segment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += text
    else out.push({ kind: 'text', text })
  }
  let cursor = 0
  for (const match of input.matchAll(URL_RE)) {
    const start = match.index
    const url = trimUrl(match[0])
    // Trimming can leave only the scheme ("https://."), which isn't a link.
    if (/^https?:\/\/$/.test(url)) continue
    pushText(input.slice(cursor, start))
    out.push({ kind: 'link', text: url, href: url })
    cursor = start + url.length
  }
  pushText(input.slice(cursor))
  return out
}
