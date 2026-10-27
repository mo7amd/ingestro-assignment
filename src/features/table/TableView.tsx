import { Box, Button, HStack, Input, NativeSelect, Spinner, Stack, Text } from '@chakra-ui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { navigate, type Route } from '../../app/router'
import { COLUMN_LABELS, issueType, type Column, type IssueCode } from '../../domain/config'
import { uniqueRule } from '../../domain/validate'
import { dataApi, type RowFilter, type Summary, type ValueCheck, type ViewQuery } from '../../worker/client'
import { FixReviewDialog } from '../fixes/FixReviewDialog'
import type { History } from '../history/useHistory'
import { formatCount, showSpaces } from '../format'
import { DataGrid, type ActiveCell, type EditState } from './DataGrid'
import { FilterInfo } from './FilterInfo'
import { MergeDialog } from './MergeDialog'
import { SelectionBar } from './SelectionBar'
import { TableFooter } from './TableFooter'
import { useViewRows } from './useViewRows'

interface Props {
  summary: Summary
  route: Extract<Route, { page: 'table' }>
  history: History
}

function filterValue(f: RowFilter): string {
  return f.kind === 'issue' ? f.code : f.kind
}

function parseFilterValue(v: string): RowFilter {
  if (v === 'all' || v === 'any-issue') return { kind: v }
  return { kind: 'issue', code: v }
}

export function TableView({ summary, route, history }: Props) {
  const query: ViewQuery = { filter: route.filter, search: route.search, sort: route.sort }
  const focus = route.filter.kind === 'issue' ? issueType(route.filter.code) : null
  // Duplicate issues: same table, rows grouped, with Fix / Merge on the shared value.
  const duplicateColumn = focus && uniqueRule(focus.column)?.issue === focus.code ? focus.column : undefined

  const [searchText, setSearchText] = useState(route.search)
  const [reviewing, setReviewing] = useState<IssueCode[] | null>(null)

  // Keep the box in sync when the URL changes (back/forward).
  useEffect(() => setSearchText(route.search), [route.search])

  // Typing updates the URL after a short pause, without filling the history.
  useEffect(() => {
    if (searchText === route.search) return
    const t = setTimeout(() => navigate({ ...route, search: searchText }, { replace: true }), 250)
    return () => clearTimeout(t)
  }, [searchText, route])

  const remaining = focus ? (summary.issues.find((i) => i.code === focus.code)?.count ?? 0) : 0
  const fixable = summary.issues.filter((i) => i.fixable)
  const decide = summary.issues.filter((i) => !i.fixable)

  return (
    <Stack gap="3" h="calc(100vh - 120px)">
      <HStack gap="2" wrap="wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate({ page: 'dashboard' })}>
          ← Overview
        </Button>
        <NativeSelect.Root size="sm" w="auto" minW="64">
          <NativeSelect.Field
            value={filterValue(route.filter)}
            onChange={(e) => navigate({ ...route, filter: parseFilterValue(e.currentTarget.value) })}
          >
            <option value="all">All rows ({formatCount(summary.rowCount)})</option>
            <option value="any-issue">Rows with any problem ({formatCount(summary.rowsAutoFixable + summary.rowsManual)})</option>
            <optgroup label="We can fix these for you">
              {fixable.map((i) => (
                <option key={i.code} value={i.code}>
                  {issueType(i.code).title} ({formatCount(i.count)})
                </option>
              ))}
            </optgroup>
            <optgroup label="Needs your decision">
              {decide.map((i) => (
                <option key={i.code} value={i.code}>
                  {issueType(i.code).title} ({formatCount(i.count)})
                </option>
              ))}
            </optgroup>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <FilterInfo filter={route.filter} summary={summary} />
        {focus?.fixable && remaining > 0 && (
          <Button size="sm" colorPalette="blue" onClick={() => setReviewing([focus.code])}>
            Review & fix all {formatCount(remaining)}
          </Button>
        )}
        {focus && remaining === 0 && <Text color="green.fg" fontSize="sm">✓ All fixed</Text>}
        <Input
          size="sm"
          flex="1"
          minW="64"
          placeholder='Search, or search one column: country:deutsch  email:empty  spend:"€"'
          value={searchText}
          onChange={(e) => setSearchText(e.currentTarget.value)}
        />
      </HStack>

      <Table query={query} route={route} history={history} focusColumn={focus?.column} duplicateColumn={duplicateColumn} />

      {reviewing && (
        <FixReviewDialog
          codes={reviewing}
          onClose={() => setReviewing(null)}
          onApply={(codes, excluded) => {
            setReviewing(null)
            history.run(() => dataApi.applyFixes(codes, excluded))
          }}
        />
      )}
    </Stack>
  )
}

interface TableProps {
  query: ViewQuery
  route: Extract<Route, { page: 'table' }>
  history: History
  focusColumn?: Column
  duplicateColumn?: Column
}

/** The grid plus everything that acts on it: selection, keyboard, editing, footer. */
function Table({ query, route, history, focusColumn, duplicateColumn }: TableProps) {
  const [merging, setMerging] = useState<number[] | null>(null)
  const { info, ensureRange, getRow } = useViewRows(query, history.version)
  const count = info?.count ?? 0

  // ---- selection: click, Cmd/Ctrl+click, arrows, Shift+arrows ----
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [active, setActive] = useState<ActiveCell | null>(null)
  const anchor = useRef<number | null>(null)
  const [scrollKey, setScrollKey] = useState(0)
  const [visible, setVisible] = useState<[number, number]>([0, 0])
  const onVisible = useCallback((a: number, b: number) => setVisible([a, b]), [])

  const viewKey = JSON.stringify(query)
  useEffect(() => {
    setSelection(new Set())
    setActive(null)
    anchor.current = null
  }, [viewKey])

  const onCellClick = (index: number, column: Column | null, { meta }: { meta: boolean }) => {
    const row = getRow(index)
    if (!row) return
    if (meta) {
      setSelection((s) => {
        const next = new Set(s)
        if (next.has(row.id)) next.delete(row.id)
        else next.add(row.id)
        return next
      })
    } else setSelection(new Set([row.id]))
    anchor.current = index
    setActive({ index, column: column ?? undefined })
  }

  const moveTo = (index: number, extend: boolean) => {
    if (!count) return
    const next = Math.max(0, Math.min(count - 1, index))
    if (extend && anchor.current !== null) {
      const [a, b] = anchor.current < next ? [anchor.current, next] : [next, anchor.current]
      const ids = new Set<number>()
      for (let i = a; i <= b; i++) {
        const r = getRow(i)
        if (r) ids.add(r.id)
      }
      setSelection(ids)
    } else {
      const r = getRow(next)
      setSelection(r ? new Set([r.id]) : new Set())
      anchor.current = next
    }
    setActive((a) => ({ index: next, column: a?.column }))
    setScrollKey((k) => k + 1)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const from = active?.index ?? -1
      moveTo(e.key === 'ArrowDown' ? from + 1 : Math.max(0, from - 1), e.shiftKey)
    } else if (e.key === 'Enter' && active?.column) {
      e.preventDefault()
      startEdit(active.index, active.column)
    } else if (e.key === 'Escape') {
      setSelection(new Set())
    }
  }

  // ---- editing ----
  const [editing, setEditing] = useState<EditState | null>(null)
  const [editCheck, setEditCheck] = useState<ValueCheck | null>(null)
  const checkSeq = useRef(0)
  /** Enter/Escape and the blur that follows both end an edit; only the first one counts. */
  const editOpen = useRef(false)

  const check = (rowId: number, column: Column, value: string) => {
    const seq = ++checkSeq.current
    setEditCheck(null)
    dataApi.checkValue(rowId, column, value).then((r) => {
      if (seq !== checkSeq.current) return // a newer keystroke won
      setEditCheck(r)
      setEditing((e) => (e ? { ...e, ok: r.issue === null } : e))
    })
  }

  const startEdit = (index: number, column: Column) => {
    const row = getRow(index)
    if (!row) return
    setActive({ index, column })
    editOpen.current = true
    setEditing({ index, rowId: row.id, column, value: row.values[column], ok: null })
    check(row.id, column, row.values[column])
  }

  const changeEdit = (value: string) => {
    if (!editing) return
    setEditing({ ...editing, value, ok: null })
    check(editing.rowId, editing.column, value)
  }

  const finishEdit = (commit: boolean) => {
    if (!editing || !editOpen.current) return
    editOpen.current = false
    const { rowId, column, value } = editing
    setEditing(null)
    setEditCheck(null)
    checkSeq.current++
    // editCell skips no-op writes, so saving an unchanged value records nothing.
    if (commit) history.run(() => dataApi.editCell(rowId, column, value))
  }

  // Leaving the view mid-edit (e.g. browser Back) saves, like clicking away does.
  const finishEditRef = useRef(finishEdit)
  finishEditRef.current = finishEdit
  useEffect(() => () => finishEditRef.current(true), [viewKey])

  // ---- small cards under a cell ----
  const editFeedback = editing && (
    <Stack gap="1">
      {editCheck === null ? (
        <Text color="fg.muted">Checking…</Text>
      ) : editCheck.issue === null ? (
        <Text color="green.fg">✓ Looks good</Text>
      ) : (
        <>
          <Text color="orange.fg">⚠ {issueType(editCheck.issue).title}</Text>
          <Text color="fg.muted">{issueType(editCheck.issue).explanation}</Text>
          {editCheck.suggestion !== undefined && (
            <Button
              size="xs"
              variant="outline"
              alignSelf="start"
              // keep focus in the editor so the click doesn't save the old value first
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => changeEdit(editCheck.suggestion!)}
            >
              Use “{showSpaces(editCheck.suggestion)}”
            </Button>
          )}
        </>
      )}
      <Text color="fg.subtle" fontSize="xs">
        Enter to save · Esc to cancel
      </Text>
    </Stack>
  )

  const activeRow = active ? getRow(active.index) : undefined
  const was = active?.column && activeRow ? activeRow.changed[active.column] : undefined
  const activeHint = was !== undefined && activeRow && active?.column && !editing && (
    <HStack justify="space-between" gap="3">
      <Text>
        {COLUMN_LABELS[active.column]} was{' '}
        <Box as="code" px="1" bg="bg.muted" borderRadius="sm">
          {was === '' ? '(empty)' : showSpaces(was)}
        </Box>
      </Text>
      <Button
        size="xs"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation()
          history.run(() => dataApi.revertCell(activeRow.id, active.column!))
        }}
      >
        ↶ Undo this cell
      </Button>
    </HStack>
  )

  const selectedIds = [...selection]

  return (
    <>
      {info && info.unknownFields.length > 0 && (
        <Text fontSize="sm" color="orange.fg">
          We don't know the column "{info.unknownFields.join('", "')}", so we searched it as plain text. Columns:{' '}
          {Object.values(COLUMN_LABELS).join(', ')}.
        </Text>
      )}
      <Box flex="1" minH="0" position="relative">
        {!info && (
          // The worker is building the view; sorting all 200k rows takes a moment.
          <HStack position="absolute" top="12" left="50%" transform="translateX(-50%)" zIndex="2" px="4" py="2"
            bg="bg.muted" borderWidth="1px" borderRadius="md" fontSize="sm" color="fg.muted" gap="2">
            <Spinner size="xs" />
            <Text>{route.sort ? `Sorting by ${COLUMN_LABELS[route.sort.column].toLowerCase()}…` : 'Updating the list…'}</Text>
          </HStack>
        )}
        <DataGrid
          count={count}
          getRow={getRow}
          ensureRange={ensureRange}
          onVisible={onVisible}
          focusColumn={focusColumn}
          sort={route.sort}
          onSort={(column) => {
            const s = route.sort
            const sort: ViewQuery['sort'] =
              s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : undefined
            navigate({ ...route, sort })
          }}
          selection={selection}
          active={active}
          onCellClick={onCellClick}
          onKey={onKey}
          scrollKey={scrollKey}
          editing={editing}
          onStartEdit={startEdit}
          onEditChange={changeEdit}
          onEditDone={finishEdit}
          onApplyFix={(rowId, column, value) => history.run(() => dataApi.editCell(rowId, column, value))}
          editFeedback={editFeedback}
          activeHint={activeHint}
          duplicateColumn={duplicateColumn}
          onMerge={(rowId) => setMerging([rowId])}
        />
        {selectedIds.length > 1 && (
          <SelectionBar
            rowIds={selectedIds}
            focusColumn={focusColumn}
            onFix={() => history.run(() => dataApi.fixRows(selectedIds, focusColumn))}
            onSet={(column, value) => history.run(() => dataApi.setCells(selectedIds, column, value))}
            onClear={() => setSelection(new Set())}
            onMerge={duplicateColumn ? () => setMerging(selectedIds) : undefined}
          />
        )}
      </Box>
      <TableFooter
        busy={!info}
        count={count}
        visible={visible}
        active={active?.index ?? null}
        group={active ? getRow(active.index)?.group : getRow(visible[0])?.group}
        onGoTo={(i) => moveTo(i, false)}
      />
      {merging && duplicateColumn && (
        <MergeDialog
          column={duplicateColumn}
          rowIds={merging}
          onClose={() => setMerging(null)}
          onMerge={(keep, others, values) => {
            setMerging(null)
            setSelection(new Set())
            history.run(() => dataApi.mergeRows(keep, others, values))
          }}
        />
      )}
    </>
  )
}
