/**
 * Generic check engine. Interprets the checks from rules.json; knows nothing about
 * specific columns. Pure: no DOM, no worker APIs, so it runs in node for tests.
 *
 * Checks run in config order and the first failing one wins,
 * so put "required" first and format checks last.
 */
import { RULES, type Check, type Column, type IssueCode } from './config'

export interface CellCheck {
  issue: IssueCode | null
  /** The corrected value, when we can derive one. */
  suggestion?: string
  /** A date that only one accepted format can read: counts as evidence for that format. */
  evidence?: string
  /** A date several formats read differently; decided per file, re-check once known. */
  ambiguous?: boolean
}

export interface CellContext {
  /** Raw value of another column in the same row (for fallbacks like "US → MM/DD"). */
  cell: (column: Column) => string
  /** Format the whole file supports, per column, once decided. */
  preferred: Partial<Record<Column, string>>
}

const OK: CellCheck = { issue: null }

// ---------- text helpers ----------

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Loose key for matching spellings: "  U.S. " → "us", "España" → "espana". */
function looseKey(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

// ---------- date formats ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

interface Ymd {
  y: number
  m: number
  d: number
}

/** Turn "DD/MM/YYYY" or "D MMM YYYY" into a parser. Tokens: YYYY, MMM, MM, M, DD, D. */
function compileDateFormat(format: string): (s: string) => Ymd | null {
  const parts: ('y' | 'm' | 'mon' | 'd')[] = []
  const src = format.replace(/YYYY|MMM|MM|M|DD|D|\s+|[^A-Za-z\s]/g, (tok) => {
    if (tok === 'YYYY') return parts.push('y'), '(\\d{4})'
    if (tok === 'MMM') return parts.push('mon'), '([A-Za-z]{3,})\\.?'
    if (tok === 'MM' || tok === 'M') return parts.push('m'), '(\\d{1,2})'
    if (tok === 'DD' || tok === 'D') return parts.push('d'), '(\\d{1,2})'
    if (/\s/.test(tok)) return '\\s+'
    return tok.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  })
  const re = new RegExp(`^${src}$`)
  return (s) => {
    const match = re.exec(s)
    if (!match) return null
    const out: Ymd = { y: 0, m: 0, d: 0 }
    for (let i = 0; i < parts.length; i++) {
      const v = match[i + 1]
      const p = parts[i]
      if (p === 'mon') {
        out.m = MONTHS.indexOf(v.slice(0, 3).toLowerCase()) + 1
        if (out.m === 0) return null
      } else out[p] = Number(v)
    }
    return out
  }
}

export function isRealDate({ y, m, d }: Ymd): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const isoOf = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// ---------- compiled checks ----------

type Compiled = (raw: string, ctx: CellContext) => CellCheck | null // null = passed, go on

function compileCheck(check: Check, column: Column): Compiled | null {
  switch (check.type) {
    case 'required':
      return (raw) => (raw.trim() === '' ? { issue: check.issues.missing } : null)

    case 'trimmed':
      return (raw) => {
        const v = raw.trim()
        return v !== raw ? { issue: check.issues.format, suggestion: v } : null
      }

    case 'pattern': {
      const re = new RegExp(check.regex)
      return (raw) => (re.test(raw.trim()) ? null : { issue: check.issues.invalid })
    }

    case 'unique':
      return null // cross-row, see duplicateKey()

    case 'oneOf': {
      const valid = new Set(check.values)
      const lookup = new Map<string, string>()
      for (const v of check.values) lookup.set(looseKey(v), v)
      for (const [canonical, names] of Object.entries(check.aliases ?? {}))
        for (const n of names) lookup.set(looseKey(n), canonical)
      return (raw) => {
        if (valid.has(raw)) return null
        const hit = lookup.get(looseKey(raw))
        return hit ? { issue: check.issues.format, suggestion: hit } : { issue: check.issues.unknown }
      }
    }

    case 'date': {
      const target = compileDateFormat(check.target)
      const accept = check.accept.map((f) => ({ format: f, parse: compileDateFormat(f) }))
      const fallback = check.ambiguous?.fallback
      return (raw, ctx) => {
        const s = raw.trim()
        const t = target(s)
        if (t) {
          if (!isRealDate(t)) return { issue: check.issues.notReal }
          return s === raw ? null : { issue: check.issues.format, suggestion: s }
        }
        const shaped = accept.map((a) => ({ format: a.format, ymd: a.parse(s) })).filter((a) => a.ymd !== null)
        if (shaped.length === 0) return { issue: check.issues.unreadable }
        const real = shaped.filter((a) => isRealDate(a.ymd!))
        if (real.length === 0) return { issue: check.issues.notReal }

        const results = new Set(real.map((a) => isoOf(a.ymd!)))
        if (results.size === 1) {
          // One reading. If other formats fit the shape but not the calendar, that's evidence.
          const evidence = real.length === 1 && shaped.length > 1 ? real[0].format : undefined
          return { issue: check.issues.format, suggestion: isoOf(real[0].ymd!), evidence }
        }

        // Several formats read it differently (03/04/2024): use the file's choice, else the fallback.
        let chosen = real.find((a) => a.format === ctx.preferred[column])
        if (!chosen && fallback) {
          const key = canonicalValue(fallback.column, ctx.cell(fallback.column))
          const format = fallback.when[key] ?? fallback.otherwise
          chosen = real.find((a) => a.format === format)
        }
        chosen ??= real[0]
        return { issue: check.issues.format, suggestion: isoOf(chosen.ymd!), ambiguous: true }
      }
    }

    case 'number': {
      const strip = (check.strip ?? []).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const stripRe = strip.length ? new RegExp(strip.join('|'), 'gi') : null
      const clean = /^\d+(\.\d+)?$/
      return (raw) => {
        if (clean.test(raw)) return null
        let s = (stripRe ? raw.replace(stripRe, '') : raw).replace(/\s+/g, '')
        const negative = s.startsWith('-')
        if (negative) s = s.slice(1)
        const lastComma = s.lastIndexOf(',')
        const lastDot = s.lastIndexOf('.')
        if (lastComma >= 0 && lastDot >= 0) {
          // Both present: the last one is the decimal separator.
          s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
        } else if (lastComma >= 0) {
          // Only commas: "1,234,567" is thousands, "0,50" is a decimal comma.
          s = /^\d{1,3}(,\d{3})+$/.test(s) && !/^0,/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
        }
        if (!clean.test(s)) return { issue: check.issues.notNumber }
        const value = negative ? -Number(s) : Number(s)
        if (check.min !== undefined && value < check.min) return { issue: check.issues.belowMin }
        return { issue: check.issues.format, suggestion: negative ? `-${s}` : s }
      }
    }
  }
}

const COMPILED = new Map<Column, Compiled[]>(
  RULES.columns.map((col) => [col.key, col.checks.map((c) => compileCheck(c, col.key)).filter((c) => c !== null)]),
)

/** Run a column's checks on one value. */
export function checkCell(column: Column, raw: string, ctx: CellContext): CellCheck {
  for (const run of COMPILED.get(column) ?? []) {
    const result = run(raw, ctx)
    if (result) return result
  }
  return OK
}

/** The value a column would have after its fix, or the trimmed raw value. */
export function canonicalValue(column: Column, raw: string): string {
  const r = checkCell(column, raw, { cell: () => '', preferred: {} })
  return r.suggestion ?? raw.trim()
}

// ---------- cross-row ----------

/** Pick the format the whole file proves: exactly one format with evidence, else undecided. */
export function decidePreferred(evidence: Record<string, number>): string | undefined {
  const proven = Object.entries(evidence).filter(([, n]) => n > 0)
  return proven.length === 1 ? proven[0][0] : undefined
}

/** For columns with a `unique` check: how to compare values, and the issue to raise. */
export function uniqueRule(column: Column): { key: (raw: string) => string; issue: IssueCode } | null {
  const col = RULES.columns.find((c) => c.key === column)
  const check = col?.checks.find((c) => c.type === 'unique')
  if (!check || check.type !== 'unique') return null
  const key = check.match === 'ignore-case' ? (v: string) => v.trim().toLowerCase() : (v: string) => v.trim()
  return { key, issue: check.issues.duplicate }
}

/** Groups of row ids that share a key; only groups of 2+ are returned. */
export function findDuplicates(rows: Iterable<number>, values: readonly string[], key: (raw: string) => string) {
  const seen = new Map<string, number[]>()
  for (const i of rows) {
    const k = key(values[i])
    const ids = seen.get(k)
    if (ids) ids.push(i)
    else seen.set(k, [i])
  }
  for (const [k, ids] of seen) if (ids.length < 2) seen.delete(k)
  return seen
}
