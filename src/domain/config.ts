/**
 * Typed view of src/config/rules.json. The JSON is the single source of truth:
 * columns, the checks each column runs (in order), and the plain-language issue texts.
 */
import raw from '../config/rules.json'

export type Check =
  | { type: 'required'; issues: { missing: string } }
  | { type: 'trimmed'; issues: { format: string } }
  | { type: 'pattern'; regex: string; issues: { invalid: string } }
  | { type: 'unique'; match: 'exact' | 'ignore-case'; issues: { duplicate: string } }
  | {
      type: 'oneOf'
      values: string[]
      aliases?: Record<string, string[]>
      issues: { format: string; unknown: string }
    }
  | {
      type: 'date'
      target: string
      accept: string[]
      ambiguous?: {
        decide: 'from-file'
        fallback?: { column: string; when: Record<string, string>; otherwise: string }
      }
      issues: { format: string; notReal: string; unreadable: string }
    }
  | {
      type: 'number'
      min?: number
      strip?: string[]
      issues: { format: string; notNumber: string; belowMin: string }
    }

export interface ColumnConfig {
  key: string
  label: string
  /** extra names users can type in search, e.g. "date:" for signup_date */
  searchAs?: string[]
  /** display hint for the table, in px (default 130) */
  width?: number
  checks: Check[]
}

export interface IssueText {
  title: string
  explanation: string
  example: string
  fixable?: boolean
}

export interface RulesConfig {
  columns: ColumnConfig[]
  issues: Record<string, IssueText>
}

export const RULES = raw as RulesConfig

export type Column = string
export type IssueCode = string
export type RowValues = Record<Column, string>

export const COLUMNS: readonly Column[] = RULES.columns.map((c) => c.key)
export const COLUMN_LABELS: Record<Column, string> = Object.fromEntries(RULES.columns.map((c) => [c.key, c.label]))
export const COLUMN_WIDTHS: Record<Column, number> = Object.fromEntries(RULES.columns.map((c) => [c.key, c.width ?? 130]))

export interface IssueType extends IssueText {
  code: IssueCode
  column: Column
  fixable: boolean
}

/** Every issue a check can raise, with the column it belongs to. Order = stored index. */
export const ISSUE_TYPES: IssueType[] = RULES.columns.flatMap((col) =>
  col.checks.flatMap((check) =>
    Object.values(check.issues).map((code: string) => {
      const text = RULES.issues[code]
      if (!text) throw new Error(`rules.json: issue "${code}" has no text`)
      return { ...text, code, column: col.key, fixable: text.fixable ?? false }
    }),
  ),
)

const BY_CODE = new Map(ISSUE_TYPES.map((t) => [t.code, t]))
const INDEX_BY_CODE = new Map(ISSUE_TYPES.map((t, i) => [t.code, i + 1]))

export function issueType(code: IssueCode): IssueType {
  return BY_CODE.get(code)!
}

/** Compact per-cell storage: 0 = no issue, otherwise catalog index + 1. */
export function issueIndex(code: IssueCode): number {
  return INDEX_BY_CODE.get(code)!
}

export function issueCodeAt(index: number): IssueCode | null {
  return index === 0 ? null : ISSUE_TYPES[index - 1].code
}
