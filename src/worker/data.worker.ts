/**
 * Owns the dataset. Rows are stored column by column (index = row id);
 * the main thread only ever asks for summaries and small slices.
 */
import * as Comlink from 'comlink'
import Papa from 'papaparse'
import {
  COLUMN_LABELS,
  COLUMNS,
  ISSUE_TYPES,
  issueType,
  issueCodeAt,
  issueIndex,
  type Column,
  type IssueCode,
  type RowValues,
} from '../domain/config'
import { RULES } from '../domain/config'
import { matchesRow, parseQuery } from '../domain/search'
import { checkCell, decidePreferred, findDuplicates, uniqueRule, type CellContext } from '../domain/validate'

export type LoadPhase = 'reading' | 'checking' | 'done'

export interface LoadProgress {
  phase: LoadPhase
  rowsParsed: number
  bytesRead: number
  totalBytes: number
  estimatedTotalRows: number
  /** 0–100 */
  percent: number
}

export interface IssueCount {
  code: IssueCode
  column: Column
  count: number
  fixable: boolean
}

/** How ambiguous values (03/04/2024) in one column were read, and why. */
export interface Ambiguity {
  column: Column
  /** values more than one accepted format could read */
  count: number
  /** values only one format could read, per format */
  evidence: Record<string, number>
  /** the format the file proves; undefined = fell back per row */
  chosen?: string
}

export interface Summary {
  /** rows still in the file (removed duplicates excluded) */
  rowCount: number
  rowsRemoved: number
  /** rows with no issue at all */
  rowsGood: number
  /** rows whose issues all have a known fix */
  rowsAutoFixable: number
  /** rows with at least one issue that needs a person */
  rowsManual: number
  issues: IssueCount[]
  ambiguities: Ambiguity[]
  duplicateGroups: Partial<Record<Column, number>>
}

/** Which rows the table shows. */
export type RowFilter = { kind: 'all' } | { kind: 'any-issue' } | { kind: 'issue'; code: IssueCode }

export interface ViewQuery {
  filter: RowFilter
  search: string
  sort?: { column: Column; dir: 'asc' | 'desc' }
}

export interface ViewInfo {
  count: number
  /** field names in the search we didn't recognise */
  unknownFields: string[]
}

export interface RowSlice {
  /** position in the current view */
  index: number
  /** stable row id (position in the file) */
  id: number
  values: RowValues
  issues: Partial<Record<Column, IssueCode>>
  /** Suggested fixed values for cells with a fixable issue. */
  suggestions: Partial<Record<Column, string>>
  /** Original value of cells the user changed. */
  changed: Partial<Record<Column, string>>
  /** Removed since the view was built (e.g. merged away); shown struck through. */
  removed?: { mergedInto?: number }
  /** Duplicate views: position of this row's group. */
  group?: { ordinal: number; total: number }
}

export interface CellChange {
  row: number
  column: Column
  before: string
  after: string
}

/** One user action (a cell edit, a bulk fix): undone and redone as a whole. */
export interface ChangeSet {
  label: string
  changes: CellChange[]
  /** rows this action removed (undo brings them back) */
  removedRows?: number[]
  /** for merges: the row the removed rows were merged into */
  mergedInto?: number
}

export interface HistoryState {
  undo?: string
  redo?: string
}

/** Live check of a value the user is typing. */
export interface ValueCheck {
  issue: IssueCode | null
  suggestion?: string
}

/** One line of a bulk-fix preview: every cell with this value gets the same fix. */
export interface FixGroup {
  before: string
  after: string
  count: number
}

export interface FixPreview {
  code: IssueCode
  total: number
  groups: FixGroup[]
  /** distinct values beyond the ones listed */
  moreGroups: number
}

// ---------- store ----------

let columns = emptyColumns()
let issues = emptyIssues(0)
let rowCount = 0
let issueIndexByCode = new Map<IssueCode, Uint32Array>()
let duplicateGroups = new Map<Column, Map<string, number[]>>()
let preferred: CellContext['preferred'] = {}
let ambiguities: Ambiguity[] = []
let rowCounts = { good: 0, autoFixable: 0, manual: 0 }
let rowsWithAnyIssue = new Uint32Array(0)
/** 1 = row removed by the user (e.g. a duplicate). Removed rows leave views, counts and the export. */
let removed = new Uint8Array(0)
/** Original value of every cell the user changed, keyed by cellKey(). */
let originals = new Map<number, string>()
let undoStack: ChangeSet[] = []
let redoStack: ChangeSet[] = []
/** Current table view: row ids in display order. null = all rows in file order. */
let view: Uint32Array | null = null
/** Duplicate views: which group (1-based) each view position belongs to, and how many groups. */
let viewGroups: { ordinal: Uint32Array; total: number } | null = null
/** Rows removed by a merge → the row they were merged into. */
let mergedInto = new Map<number, number>()

function contextFor(row: number): CellContext {
  return { cell: (c) => columns[c][row] ?? '', preferred }
}

function emptyColumns(): Record<Column, string[]> {
  return Object.fromEntries(COLUMNS.map((c) => [c, [] as string[]]))
}

function emptyIssues(capacity: number): Record<Column, Uint8Array> {
  return Object.fromEntries(COLUMNS.map((c) => [c, new Uint8Array(capacity)]))
}

function ensureCapacity(n: number) {
  for (const c of COLUMNS) {
    const arr = issues[c]
    if (arr.length >= n) continue
    const grown = new Uint8Array(Math.max(n, arr.length * 2))
    grown.set(arr)
    issues[c] = grown
  }
}

function setIssue(col: Column, row: number, code: IssueCode | null) {
  issues[col][row] = code === null ? 0 : issueIndex(code)
}

const yieldToEvents = () => new Promise((r) => setTimeout(r, 0))

// ---------- loading ----------

async function load(file: File, onProgress: (p: LoadProgress) => void): Promise<Summary> {
  columns = emptyColumns()
  rowCount = 0
  issueIndexByCode = new Map()
  duplicateGroups = new Map()
  originals = new Map()
  mergedInto = new Map()
  undoStack = []
  redoStack = []
  preferred = {}
  ambiguities = []
  // Rough guess at ~80 bytes per row; grows if wrong.
  issues = emptyIssues(Math.ceil(file.size / 80))

  // Per column: values only one format could read (evidence), and rows to re-check once decided.
  const evidence = new Map<Column, Record<string, number>>()
  const deferred = new Map<Column, number[]>()
  let lastReport = 0

  const report = (phase: LoadPhase, bytesRead: number, percent: number, force = false) => {
    const now = Date.now()
    if (!force && now - lastReport < 100) return
    lastReport = now
    const estimatedTotalRows =
      phase === 'reading' && bytesRead > 0 ? Math.round((rowCount / bytesRead) * file.size) : rowCount
    onProgress({ phase, rowsParsed: rowCount, bytesRead, totalBytes: file.size, estimatedTotalRows, percent })
  }

  await new Promise<void>((resolve, reject) => {
    let headerChecked = false
    Papa.parse<Record<string, string | undefined>>(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 1024,
      chunk(results, parser) {
        if (!headerChecked) {
          headerChecked = true
          const missing = COLUMNS.filter((c) => !results.meta.fields?.includes(c))
          if (missing.length) {
            parser.abort()
            reject(new Error(`This file is missing these columns: ${missing.join(', ')}`))
            return
          }
        }
        const start = rowCount
        ensureCapacity(start + results.data.length)
        for (let i = 0; i < results.data.length; i++) {
          const raw = results.data[i]
          for (const c of COLUMNS) columns[c].push(raw[c] ?? '')
        }
        for (let row = start; row < start + results.data.length; row++) {
          const ctx = contextFor(row)
          for (const c of COLUMNS) {
            const check = checkCell(c, columns[c][row], ctx)
            setIssue(c, row, check.issue)
            if (check.evidence) {
              const e = evidence.get(c) ?? {}
              e[check.evidence] = (e[check.evidence] ?? 0) + 1
              evidence.set(c, e)
            }
            if (check.ambiguous) {
              const rows = deferred.get(c)
              if (rows) rows.push(row)
              else deferred.set(c, [row])
            }
          }
        }
        rowCount += results.data.length
        const bytes = results.meta.cursor
        report('reading', bytes, (bytes / file.size) * 90)
      },
      complete: () => resolve(),
      error: (err) => reject(new Error(`We couldn't read this file: ${err.message}`)),
    })
  })

  removed = new Uint8Array(rowCount)

  // ---- phase (b): cross-row checks ----
  report('checking', file.size, 90, true)
  await yieldToEvents()

  // Ambiguous values: re-check with the format the whole file proves (or the per-row fallback).
  for (const [column, rows] of deferred) {
    const e = evidence.get(column) ?? {}
    const chosen = decidePreferred(e)
    if (chosen) preferred[column] = chosen
    for (const row of rows) setIssue(column, row, checkCell(column, columns[column][row], contextFor(row)).issue)
    ambiguities.push({ column, count: rows.length, evidence: e, chosen })
  }
  report('checking', file.size, 93, true)
  await yieldToEvents()

  for (const column of COLUMNS) checkDuplicates(column)
  report('checking', file.size, 97, true)
  await yieldToEvents()

  buildIndex()
  view = null
  report('done', file.size, 100, true)
  return getSummary()
}

/**
 * Duplicates: only values that passed every other check take part; every row in a group is flagged.
 * Safe to re-run after edits: rows flagged before are re-checked first.
 */
function checkDuplicates(column: Column) {
  const rule = uniqueRule(column)
  if (!rule) return
  const dupIndex = issueIndex(rule.issue)
  for (const ids of duplicateGroups.get(column)?.values() ?? [])
    for (const row of ids)
      if (issues[column][row] === dupIndex) setIssue(column, row, checkCell(column, columns[column][row], contextFor(row)).issue)
  const clean = function* () {
    for (let r = 0; r < rowCount; r++) if (issues[column][r] === 0 && !removed[r]) yield r
  }
  const groups = findDuplicates(clean(), columns[column], rule.key)
  for (const ids of groups.values()) for (const row of ids) setIssue(column, row, rule.issue)
  duplicateGroups.set(column, groups)
}

/** code → sorted row ids, plus the count of rows with any issue. */
function buildIndex() {
  const counts = new Uint32Array(ISSUE_TYPES.length + 1)
  // 0 = good, 1 = only fixable issues, 2 = needs a person
  const rowState = new Uint8Array(rowCount)
  for (const c of COLUMNS) {
    const arr = issues[c]
    for (let r = 0; r < rowCount; r++) {
      const idx = arr[r]
      if (!idx || removed[r]) continue
      counts[idx]++
      rowState[r] = Math.max(rowState[r], ISSUE_TYPES[idx - 1].fixable ? 1 : 2)
    }
  }
  rowCounts = { good: 0, autoFixable: 0, manual: 0 }
  for (let r = 0; r < rowCount; r++) {
    if (removed[r]) continue
    if (rowState[r] === 0) rowCounts.good++
    else if (rowState[r] === 1) rowCounts.autoFixable++
    else rowCounts.manual++
  }
  rowsWithAnyIssue = new Uint32Array(rowCounts.autoFixable + rowCounts.manual)
  for (let r = 0, k = 0; r < rowCount; r++) if (rowState[r]) rowsWithAnyIssue[k++] = r

  issueIndexByCode = new Map()
  ISSUE_TYPES.forEach((t, i) => {
    const idx = i + 1
    const ids = new Uint32Array(counts[idx])
    const arr = issues[t.column]
    let k = 0
    for (let r = 0; r < rowCount && k < ids.length; r++) if (arr[r] === idx && !removed[r]) ids[k++] = r
    issueIndexByCode.set(t.code, ids)
  })
}

// ---------- queries ----------

function getSummary(): Summary {
  const list: IssueCount[] = ISSUE_TYPES.map((t) => ({
    code: t.code,
    column: t.column,
    count: issueIndexByCode.get(t.code)?.length ?? 0,
    fixable: t.fixable,
  }))
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count)
  return {
    rowCount: rowCounts.good + rowCounts.autoFixable + rowCounts.manual,
    rowsRemoved: rowCount - (rowCounts.good + rowCounts.autoFixable + rowCounts.manual),
    rowsGood: rowCounts.good,
    rowsAutoFixable: rowCounts.autoFixable,
    rowsManual: rowCounts.manual,
    issues: list,
    ambiguities,
    duplicateGroups: Object.fromEntries([...duplicateGroups].map(([c, g]) => [c, g.size])),
  }
}

// ---------- table view ----------

const NUMBER_COLUMNS = new Set(RULES.columns.filter((c) => c.checks.some((k) => k.type === 'number')).map((c) => c.key))

function sortIds(ids: Uint32Array, column: Column, dir: 'asc' | 'desc'): Uint32Array {
  const values = columns[column]
  const sign = dir === 'asc' ? 1 : -1
  if (NUMBER_COLUMNS.has(column)) {
    // Sort by the cleaned number ("€ 68" → 68); unreadable values go last either way.
    const keys = new Float64Array(rowCount)
    for (const id of ids) {
      const raw = values[id]
      // Blank is "no value", not 0: NaN sorts last like other unreadable values.
      keys[id] = raw.trim() === '' ? NaN : Number(checkCell(column, raw, contextFor(id)).suggestion ?? raw)
    }
    return ids.sort((a, b) => {
      const x = keys[a]
      const y = keys[b]
      if (Number.isNaN(x)) return Number.isNaN(y) ? a - b : 1
      if (Number.isNaN(y)) return -1
      return (x - y) * sign || a - b
    })
  }
  const keys: string[] = new Array(rowCount)
  for (const id of ids) keys[id] = values[id].trim().toLowerCase()
  return ids.sort((a, b) => {
    const x = keys[a]
    const y = keys[b]
    if (x === y) return a - b
    if (x === '') return 1 // blanks last
    if (y === '') return -1
    return (x < y ? -1 : 1) * sign
  })
}

/** Filter → search → sort. Keeps the result in the worker; the table pages through it. */
function setView(q: ViewQuery): ViewInfo {
  const { terms, unknownFields } = parseQuery(q.search)
  let ids: Uint32Array
  if (q.filter.kind === 'issue') ids = issueIndexByCode.get(q.filter.code) ?? new Uint32Array(0)
  else if (q.filter.kind === 'any-issue') ids = rowsWithAnyIssue
  else {
    ids = new Uint32Array(rowCount)
    let k = 0
    for (let r = 0; r < rowCount; r++) if (!removed[r]) ids[k++] = r
    ids = ids.slice(0, k)
  }

  if (terms.length) {
    const hits = new Uint32Array(ids.length)
    let k = 0
    for (const id of ids) if (matchesRow(terms, COLUMNS, (c) => columns[c][id])) hits[k++] = id
    ids = hits.slice(0, k)
  } else ids = ids.slice() // never sort the shared index in place

  viewGroups = null
  const dupColumn = q.filter.kind === 'issue' ? duplicateColumnOf(q.filter.code) : undefined
  if (q.sort) ids = sortIds(ids, q.sort.column, q.sort.dir)
  else if (dupColumn) ids = groupDuplicates(ids, dupColumn)
  view = ids
  return { count: ids.length, unknownFields }
}

/** The column whose `unique` check raises this issue, if any. */
function duplicateColumnOf(code: IssueCode): Column | undefined {
  const col = issueType(code).column
  return uniqueRule(col)?.issue === code ? col : undefined
}

/** Duplicate views: rows of one group next to each other, groups in file order of their first row. */
function groupDuplicates(ids: Uint32Array, column: Column): Uint32Array {
  const rule = uniqueRule(column)!
  const firstSeen = new Map<string, number>()
  const keys: string[] = new Array(rowCount)
  for (const id of ids) {
    const k = rule.key(columns[column][id])
    keys[id] = k
    if (!firstSeen.has(k)) firstSeen.set(k, id)
  }
  const sorted = ids.sort((a, b) => firstSeen.get(keys[a])! - firstSeen.get(keys[b])! || a - b)
  const ordinal = new Uint32Array(sorted.length)
  let g = 0
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || keys[sorted[i]] !== keys[sorted[i - 1]]) g++
    ordinal[i] = g
  }
  viewGroups = { ordinal, total: g }
  return sorted
}

function getViewRows(start: number, count: number): RowSlice[] {
  const size = view ? view.length : rowCount
  const out: RowSlice[] = []
  for (let index = Math.max(0, start); index < Math.min(size, start + count); index++) {
    const slice = rowSlice(index, view ? view[index] : index)
    if (viewGroups) slice.group = { ordinal: viewGroups.ordinal[index], total: viewGroups.total }
    out.push(slice)
  }
  return out
}

function rowSlice(index: number, id: number): RowSlice {
  const values = {} as RowValues
  const rowIssues: RowSlice['issues'] = {}
  const suggestions: RowSlice['suggestions'] = {}
  for (const c of COLUMNS) {
    const v = columns[c][id]
    values[c] = v
    const code = issueCodeAt(issues[c][id])
    if (!code) continue
    rowIssues[c] = code
    const s = checkCell(c, v, contextFor(id)).suggestion
    if (s !== undefined) suggestions[c] = s
  }
  const changed: RowSlice['changed'] = {}
  COLUMNS.forEach((c, ci) => {
    const was = originals.get(cellKey(id, ci))
    if (was !== undefined) changed[c] = was
  })
  const slice: RowSlice = { index, id, values, issues: rowIssues, suggestions, changed }
  if (removed[id]) slice.removed = { mergedInto: mergedInto.get(id) }
  return slice
}

// ---------- changes ----------

const COLUMN_INDEX = new Map(COLUMNS.map((c, i) => [c, i]))
const cellKey = (row: number, ci: number) => row * COLUMNS.length + ci

/** Apply (or roll back) one action: values, removed rows, re-checks, counts. */
function apply(set: ChangeSet, direction: 'do' | 'undo') {
  const touched = new Set<Column>()
  for (const c of set.changes) {
    const value = direction === 'do' ? c.after : c.before
    const key = cellKey(c.row, COLUMN_INDEX.get(c.column)!)
    if (!originals.has(key)) originals.set(key, columns[c.column][c.row])
    else if (originals.get(key) === value) originals.delete(key) // back to the original
    columns[c.column][c.row] = value
    touched.add(c.column)
  }
  for (const c of set.changes) setIssue(c.column, c.row, checkCell(c.column, columns[c.column][c.row], contextFor(c.row)).issue)
  if (set.removedRows?.length) {
    for (const r of set.removedRows) {
      removed[r] = direction === 'do' ? 1 : 0
      if (set.mergedInto !== undefined) {
        if (direction === 'do') mergedInto.set(r, set.mergedInto)
        else mergedInto.delete(r)
      }
    }
    for (const c of COLUMNS) if (uniqueRule(c)) touched.add(c) // groups may have dissolved
  }
  for (const c of touched) checkDuplicates(c)
  buildIndex()
}

function record(
  label: string,
  changes: { row: number; column: Column; value: string }[],
  removeRows: number[] = [],
  into?: number,
): HistoryState {
  const set: ChangeSet = {
    label,
    mergedInto: into,
    changes: changes
      .filter((c) => columns[c.column][c.row] !== c.value)
      .map((c) => ({ row: c.row, column: c.column, before: columns[c.column][c.row], after: c.value })),
    removedRows: removeRows.filter((r) => !removed[r]),
  }
  if (set.changes.length === 0 && set.removedRows!.length === 0) return getHistory()
  apply(set, 'do')
  undoStack.push(set)
  redoStack = []
  return getHistory()
}

/** Inline edit of one cell. */
function editCell(row: number, column: Column, value: string): HistoryState {
  return record(`Edited ${COLUMN_LABELS[column]} in row ${row + 1}`, [{ row, column, value }])
}

/** Undo on one cell: put back its original value, as a new history entry (history stays linear). */
function revertCell(row: number, column: Column): HistoryState {
  const original = originals.get(cellKey(row, COLUMN_INDEX.get(column)!))
  if (original === undefined) return getHistory()
  return record(`Restored ${COLUMN_LABELS[column]} in row ${row + 1}`, [{ row, column, value: original }])
}

/** Selection: apply every suggested fix in these rows (one column, or all columns). */
function fixRows(rowIds: number[], column?: Column): HistoryState {
  const cols = column ? [column] : COLUMNS
  const changes = rowIds.flatMap((row) =>
    cols.flatMap((c) => {
      if (!issues[c][row]) return []
      const fix = checkCell(c, columns[c][row], contextFor(row)).suggestion
      return fix === undefined ? [] : [{ row, column: c, value: fix }]
    }),
  )
  const what = column ? COLUMN_LABELS[column] : 'everything we could'
  return record(`Fixed ${what} in ${formatInt(rowIds.length)} selected rows`, changes)
}

/** Selection: set one value in one column for every selected row. */
function setCells(rowIds: number[], column: Column, value: string): HistoryState {
  const label = `Set ${COLUMN_LABELS[column]} to "${value}" in ${formatInt(rowIds.length)} rows`
  return record(label, rowIds.map((row) => ({ row, column, value })))
}

/** All rows sharing this row's value in a unique column (the duplicate group). */
function getGroupRows(column: Column, rowId: number): RowSlice[] {
  const rule = uniqueRule(column)
  if (!rule) return []
  const k = rule.key(columns[column][rowId])
  const ids: number[] = []
  for (let i = 0; i < rowCount; i++) if (!removed[i] && rule.key(columns[column][i]) === k) ids.push(i)
  return ids.map((id, i) => rowSlice(i, id))
}

/** Merge: the kept row takes the chosen values, the others are removed. One undoable action. */
function mergeRows(keep: number, others: number[], values: RowValues): HistoryState {
  const label = `Merged ${others.map((r) => `row ${formatInt(r + 1)}`).join(', ')} into row ${formatInt(keep + 1)}`
  return record(
    label,
    COLUMNS.map((c) => ({ row: keep, column: c, value: values[c] })),
    others,
    keep,
  )
}

function getRowsByIds(ids: number[]): RowSlice[] {
  return ids.filter((id) => id < rowCount && !removed[id]).map((id, i) => rowSlice(i, id))
}

/** Live check while typing: same rules as the import, including duplicates. */
function checkValue(row: number, column: Column, value: string, ignoreRows: number[] = []): ValueCheck {
  const ignore = new Set(ignoreRows)
  const ctx: CellContext = { cell: (c) => (c === column ? value : columns[c][row]), preferred }
  const r = checkCell(column, value, ctx)
  if (r.issue) return { issue: r.issue, suggestion: r.suggestion }
  const rule = uniqueRule(column)
  if (rule) {
    const k = rule.key(value)
    const values = columns[column]
    for (let i = 0; i < rowCount; i++)
      if (i !== row && !removed[i] && !ignore.has(i) && rule.key(values[i]) === k) return { issue: rule.issue }
  }
  return { issue: null }
}

/** Rows of an issue whose current value is not excluded, with their suggested fix. */
function fixableCells(code: IssueCode, excluded: ReadonlySet<string> = new Set()) {
  const t = issueType(code)
  const out: { row: number; column: Column; value: string; before: string }[] = []
  for (const row of issueIndexByCode.get(code) ?? []) {
    const before = columns[t.column][row]
    if (excluded.has(before)) continue
    const fix = checkCell(t.column, before, contextFor(row)).suggestion
    if (fix !== undefined) out.push({ row, column: t.column, value: fix, before })
  }
  return out
}

const PREVIEW_GROUPS = 100

/** What a bulk fix would change, grouped by value, largest first. */
function previewFix(code: IssueCode): FixPreview {
  const groups = new Map<string, FixGroup>()
  const cells = fixableCells(code)
  for (const c of cells) {
    const g = groups.get(c.before)
    if (g) g.count++
    else groups.set(c.before, { before: c.before, after: c.value, count: 1 })
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
  return { code, total: cells.length, groups: sorted.slice(0, PREVIEW_GROUPS), moreGroups: Math.max(0, sorted.length - PREVIEW_GROUPS) }
}

/** Apply the suggested fix for whole issues as one undoable action. */
function applyFixes(codes: IssueCode[], excludedValues: Record<IssueCode, string[]> = {}): HistoryState {
  const changes = codes.flatMap((code) => fixableCells(code, new Set(excludedValues[code] ?? [])))
  const n = changes.length
  const label =
    codes.length === 1
      ? `Fixed ${formatInt(n)} × ${issueType(codes[0]).title.toLowerCase()}`
      : `Applied ${codes.length} automatic fixes to ${formatInt(n)} cells`
  return record(label, changes)
}

function undo(): HistoryState {
  const set = undoStack.pop()
  if (set) {
    apply(set, 'undo')
    redoStack.push(set)
  }
  return getHistory()
}

function redo(): HistoryState {
  const set = redoStack.pop()
  if (set) {
    apply(set, 'do')
    undoStack.push(set)
  }
  return getHistory()
}

function getHistory(): HistoryState {
  return { undo: undoStack[undoStack.length - 1]?.label, redo: redoStack[redoStack.length - 1]?.label }
}

const formatInt = (n: number) => n.toLocaleString('en-US')

// ---------- export ----------

/** The whole file with every change applied, same columns and order as the input. */
function exportCsv(): Blob {
  const rows: string[][] = []
  for (let r = 0; r < rowCount; r++) if (!removed[r]) rows.push(COLUMNS.map((c) => columns[c][r]))
  return new Blob([Papa.unparse({ fields: [...COLUMNS], data: rows })], { type: 'text/csv;charset=utf-8' })
}

const api = {
  load,
  getSummary,
  setView,
  getViewRows,
  editCell,
  revertCell,
  fixRows,
  setCells,
  getRowsByIds,
  getGroupRows,
  mergeRows,
  checkValue,
  previewFix,
  applyFixes,
  undo,
  redo,
  getHistory,
  exportCsv,
}
export type DataApi = typeof api

Comlink.expose(api)
