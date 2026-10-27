import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, type ReactNode } from 'react'
import { COLUMN_LABELS, COLUMN_WIDTHS, COLUMNS, type Column } from '../../domain/config'
import { emailMatchesName } from '../../domain/hints'
import type { RowSlice, ViewQuery } from '../../worker/client'
import { formatCount, showSpaces } from '../format'
import './grid.css'

const ROW_H = 36
/** Cards under the last columns open leftwards so the grid edge doesn't cut them off. */
const popClass = (c: Column) => (COLUMNS.indexOf(c) >= COLUMNS.length - 3 ? 'cell-pop left' : 'cell-pop')
const DATA_COLUMNS = COLUMNS.map((c) => `minmax(${COLUMN_WIDTHS[c]}px, 1fr)`)
const DATA_WIDTH = COLUMNS.reduce((n, c) => n + COLUMN_WIDTHS[c], 0)
/** Browse views get a per-row problem count; focus mode leaves it out to keep attention on one issue. */
const layout = (withCount: boolean) => ({
  template: ['80px', ...(withCount ? ['44px'] : []), ...DATA_COLUMNS].join(' '),
  minWidth: 80 + (withCount ? 44 : 0) + DATA_WIDTH,
})

export interface EditState {
  /** position in the current view (where the editor is drawn) */
  index: number
  /** the row itself, so a save always lands on the right row even if the view changed */
  rowId: number
  column: Column
  value: string
  /** result of the live check: null = still checking */
  ok: boolean | null
}

/** The cell the user clicked last: where cell-level hints (was X · undo) appear. */
export interface ActiveCell {
  index: number
  /** undefined when the row was picked by its number or the keyboard */
  column?: Column
}

interface Props {
  count: number
  getRow: (index: number) => RowSlice | undefined
  ensureRange: (start: number, end: number) => void
  /** rows on screen, for the footer */
  onVisible: (first: number, last: number) => void
  /** focus mode: only this column's issues are highlighted */
  focusColumn?: Column
  sort: ViewQuery['sort']
  onSort: (column: Column) => void
  /** selected row ids */
  selection: ReadonlySet<number>
  active: ActiveCell | null
  onCellClick: (index: number, column: Column | null, e: { meta: boolean }) => void
  onKey: (e: React.KeyboardEvent) => void
  /** bump to scroll the active row into view */
  scrollKey: number
  editing: EditState | null
  onStartEdit: (index: number, column: Column) => void
  onEditChange: (value: string) => void
  onEditDone: (commit: boolean) => void
  onApplyFix: (rowId: number, column: Column, value: string) => void
  /** feedback shown under the cell being edited */
  editFeedback: ReactNode
  /** hint shown under the active cell when it was changed */
  activeHint: ReactNode
  /** duplicate views: the shared column; its cells get Fix / Merge actions */
  duplicateColumn?: Column
  onMerge: (rowId: number) => void
}

export function DataGrid(props: Props) {
  const { count, getRow, ensureRange, focusColumn, sort, onSort, selection, active, scrollKey, editing } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 15,
    scrollPaddingStart: ROW_H, // keep rows clear of the sticky header
  })
  const items = v.getVirtualItems()
  // Overscan rows are rendered but not visible; the footer wants what's on screen.
  const first = items[0]?.index ?? 0
  const last = items[items.length - 1]?.index ?? 0
  const visibleStart = Math.floor(v.scrollOffset ? v.scrollOffset / ROW_H : 0)
  const visibleEnd = visibleStart + Math.max(0, Math.floor(((scrollRef.current?.clientHeight ?? ROW_H) - ROW_H) / ROW_H) - 1)
  const { onVisible } = props
  useEffect(() => onVisible(visibleStart, visibleEnd), [visibleStart, visibleEnd, onVisible])
  const showCount = !focusColumn
  const { template, minWidth } = layout(showCount)

  useEffect(() => {
    if (count) ensureRange(first, last)
  }, [first, last, count, ensureRange])

  useEffect(() => {
    if (active) v.scrollToIndex(active.index, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [sort, focusColumn])

  return (
    <div ref={scrollRef} className="grid" style={{ height: '100%' }} tabIndex={0} onKeyDown={props.onKey}>
      <div className="grid-row head" style={{ gridTemplateColumns: template, minWidth }}>
        <div className="cell num">#</div>
        {showCount && <div className="cell" title="Problems in this row" />}
        {COLUMNS.map((c) => (
          <div key={c} className={`cell sortable${c === focusColumn ? ' focus' : ''}`} onClick={() => onSort(c)} title="Sort">
            {COLUMN_LABELS[c]}
            {sort?.column === c ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
          </div>
        ))}
      </div>
      <div style={{ height: v.getTotalSize(), position: 'relative', minWidth }}>
        {items.map((item) => {
          const row = getRow(item.index)
          const issueCount = row ? Object.keys(row.issues).length : 0
          const isActiveRow = active?.index === item.index
          const raised = isActiveRow || editing?.index === item.index
          // Duplicate views: a line where a new group starts.
          const groupStart = !!row?.group && item.index > 0 && getRow(item.index - 1)?.group?.ordinal !== row.group.ordinal
          const cls = [
            'grid-row body',
            row && selection.has(row.id) ? 'selected' : '',
            isActiveRow ? 'cursor' : '',
            groupStart ? 'group-start' : '',
            row?.removed ? 'removed' : '',
          ].join(' ')
          return (
            <div
              key={item.key}
              className={cls}
              style={{ gridTemplateColumns: template, top: item.start, zIndex: raised ? 3 : undefined }}
              onClick={(e) => props.onCellClick(item.index, null, { meta: e.metaKey || e.ctrlKey })}
            >
              <div className="cell num">{formatCount((row?.id ?? item.index) + 1)}</div>
              {showCount && <div className="cell">{issueCount > 0 && <span className="dot">{issueCount}</span>}</div>}
              {row?.removed ? (
                <RemovedRow row={row} />
              ) : row ? (
                COLUMNS.map((c) =>
                  editing && editing.index === item.index && editing.column === c ? (
                    <CellEditor key={c} edit={editing} onChange={props.onEditChange} onDone={props.onEditDone}>
                      {props.editFeedback}
                    </CellEditor>
                  ) : c === props.duplicateColumn ? (
                    <DuplicateCell
                      key={c}
                      row={row}
                      column={c}
                      active={isActiveRow && active?.column === c}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onCellClick(item.index, c, { meta: e.metaKey || e.ctrlKey })
                      }}
                      onFix={() => props.onStartEdit(item.index, c)}
                      onMerge={() => props.onMerge(row.id)}
                    />
                  ) : (
                    <GridCell
                      key={c}
                      row={row}
                      column={c}
                      highlight={!focusColumn || c === focusColumn}
                      active={isActiveRow && active?.column === c}
                      hint={isActiveRow && active?.column === c ? props.activeHint : null}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onCellClick(item.index, c, { meta: e.metaKey || e.ctrlKey })
                      }}
                      onEdit={() => props.onStartEdit(item.index, c)}
                      onApplyFix={(value) => props.onApplyFix(row.id, c, value)}
                    />
                  ),
                )
              ) : (
                <div className="cell placeholder">Loading…</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface CellProps {
  row: RowSlice
  column: Column
  highlight: boolean
  active: boolean
  hint: ReactNode
  onClick: (e: React.MouseEvent) => void
  onEdit: () => void
  onApplyFix: (value: string) => void
}

function GridCell({ row, column, highlight, active, hint, onClick, onEdit, onApplyFix }: CellProps) {
  const value = row.values[column]
  const issue = row.issues[column]
  const fix = row.suggestions[column]
  const cls = [
    'cell',
    highlight && issue ? 'issue' : '',
    row.changed[column] !== undefined ? 'changed' : '',
    active ? 'active' : '',
  ].join(' ')
  return (
    <div className={cls} onClick={onClick} onDoubleClick={onEdit}>
      <span className="value">{highlight && issue && value === '' ? '(empty)' : value}</span>
      {highlight && issue && fix !== undefined && (
        <button
          className="fix"
          title={`Change to "${fix}"`}
          onClick={(e) => {
            e.stopPropagation()
            onApplyFix(fix)
          }}
        >
          → {showSpaces(fix)}
        </button>
      )}
      {hint && <div className={popClass(column)}>{hint}</div>}
    </div>
  )
}

/** A merged-away row stays in place (struck through) so the list doesn't jump; undo brings it back. */
function RemovedRow({ row }: { row: RowSlice }) {
  return (
    <>
      {COLUMNS.map((c, i) => (
        <div key={c} className="cell">
          {i === 0 && row.removed?.mergedInto !== undefined ? (
            <span className="removed-note">Merged into row {formatCount(row.removed.mergedInto + 1)}</span>
          ) : i === 0 ? (
            <span className="removed-note">Removed</span>
          ) : (
            <span className="value">{row.values[c]}</span>
          )}
        </div>
      ))}
    </>
  )
}

/**
 * Duplicate views: the shared value and the two ways out: fix it or merge.
 * The row whose name is in the email probably owns it, so it isn't offered "Fix".
 */
function DuplicateCell({
  row,
  column,
  active,
  onClick,
  onFix,
  onMerge,
}: {
  row: RowSlice
  column: Column
  active: boolean
  onClick: (e: React.MouseEvent) => void
  onFix: () => void
  onMerge: () => void
}) {
  const owner = emailMatchesName(row.values.email ?? '', row.values.first_name ?? '', row.values.last_name ?? '')
  const stillDuplicate = !!row.issues[column]
  const cls = ['cell', stillDuplicate ? 'issue' : '', row.changed[column] !== undefined ? 'changed' : '', active ? 'active' : '']
  return (
    <div className={cls.join(' ')} onClick={onClick} onDoubleClick={onFix}>
      <span className="value">{row.values[column]}</span>
      {stillDuplicate && (
        <span className="cta">
          {!owner && (
            <button className="fix" onClick={(e) => (e.stopPropagation(), onFix())}>
              Fix
            </button>
          )}
          <button className="fix" onClick={(e) => (e.stopPropagation(), onMerge())}>
            Merge…
          </button>
        </span>
      )}
    </div>
  )
}

function CellEditor({
  edit,
  onChange,
  onDone,
  children,
}: {
  edit: EditState
  onChange: (v: string) => void
  onDone: (commit: boolean) => void
  children: ReactNode
}) {
  const cls = edit.ok === null ? '' : edit.ok ? 'good' : 'bad'
  return (
    <div className="cell editing" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className={cls}
        value={edit.value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation() // arrows move the caret, not the selection
          if (e.key === 'Enter') onDone(true)
          if (e.key === 'Escape') onDone(false)
        }}
        onBlur={() => onDone(true)}
      />
      {children && <div className={popClass(edit.column)}>{children}</div>}
    </div>
  )
}
