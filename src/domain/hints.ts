import { stripDiacritics } from './validate'

const lettersOnly = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const asciiLetters = (s: string) => lettersOnly(stripDiacritics(s))

/**
 * Does this email look like it belongs to this person? "yuki.lindqvist103434@…" → Yuki Lindqvist.
 * Tries "García" both as "garcia" and "garca", since exports often drop accented letters.
 */
export function emailMatchesName(email: string, first: string, last: string): boolean {
  const local = lettersOnly(email.split('@')[0])
  return [lettersOnly, asciiLetters].some((f) => {
    const a = f(first)
    const b = f(last)
    return a.length > 0 && b.length > 0 && local.includes(a) && local.includes(b)
  })
}
