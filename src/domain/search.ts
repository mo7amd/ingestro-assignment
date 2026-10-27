/**
 * Field-aware search: `country:deutsch email:"@corp.example" smith`.
 * Field terms and free text are ANDed; free text matches any column.
 * `field:empty` finds blank cells. Field names come from rules.json (key, label, searchAs).
 */
import { RULES, type Column } from './config'

export interface SearchTerm {
  /** undefined = any column */
  column?: Column
  /** lower-cased; '' with empty=true means "blank cell" */
  text: string
  empty?: boolean
}

export interface ParsedQuery {
  terms: SearchTerm[]
  /** field names we didn't recognise; searched as plain text instead */
  unknownFields: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')

const FIELD_NAMES = new Map<string, Column>()
for (const col of RULES.columns) {
  for (const name of [col.key, col.label, ...(col.searchAs ?? [])]) FIELD_NAMES.set(norm(name), col.key)
}

const TOKEN_RE = /(?:([\w-]+):)?(?:"([^"]*)"|(\S+))/g

export function parseQuery(input: string): ParsedQuery {
  const terms: SearchTerm[] = []
  const unknownFields: string[] = []
  for (const m of input.matchAll(TOKEN_RE)) {
    const [, field, quoted, bare] = m
    const text = (quoted ?? bare ?? '').toLowerCase()
    if (!field) {
      if (text) terms.push({ text })
      continue
    }
    const column = FIELD_NAMES.get(norm(field))
    if (!column) {
      unknownFields.push(field)
      terms.push({ text: `${field}:${text}`.toLowerCase() })
    } else if (text === 'empty') terms.push({ column, text: '', empty: true })
    else if (text) terms.push({ column, text })
  }
  return { terms, unknownFields }
}

/** Does one row match every term? `cell(c)` returns the raw value. */
export function matchesRow(terms: SearchTerm[], columns: readonly Column[], cell: (c: Column) => string): boolean {
  for (const t of terms) {
    if (t.empty) {
      if (cell(t.column!).trim() !== '') return false
    } else if (t.column) {
      if (!cell(t.column).toLowerCase().includes(t.text)) return false
    } else if (!columns.some((c) => cell(c).toLowerCase().includes(t.text))) return false
  }
  return true
}
