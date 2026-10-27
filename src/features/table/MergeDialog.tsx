import { Box, Button, CloseButton, Dialog, Portal, Stack, Text } from '@chakra-ui/react'
import { useEffect, useMemo, useState } from 'react'
import { COLUMN_LABELS, COLUMNS, issueType, type Column, type RowValues } from '../../domain/config'
import { emailMatchesName } from '../../domain/hints'
import { uniqueRule } from '../../domain/validate'
import { dataApi, type RowSlice, type ValueCheck } from '../../worker/client'
import { showSpaces } from '../format'

interface Props {
  /** the column whose duplicates are being merged */
  column: Column
  /** rows to merge: a selection, or a single row (then its whole group is loaded) */
  rowIds: number[]
  onClose: () => void
  onMerge: (keep: number, others: number[], values: RowValues) => void
}

/**
 * Merge duplicates into one customer, as a small table: the group's rows, then the result row.
 * Pick the row that stays (its ID survives); where rows disagree, click the cell to keep.
 * The result row is checked with the import rules before merging.
 */
export function MergeDialog({ column, rowIds, onClose, onMerge }: Props) {
  const [rows, setRows] = useState<RowSlice[] | null>(null)
  const [keep, setKeep] = useState<number | null>(null)
  const [picked, setPicked] = useState<Partial<RowValues>>({})
  const [checks, setChecks] = useState<Partial<Record<Column, ValueCheck>>>({})

  useEffect(() => {
    const load = rowIds.length === 1 ? dataApi.getGroupRows(column, rowIds[0]) : dataApi.getRowsByIds(rowIds)
    load.then((rs) => {
      setRows(rs)
      // Start with the row whose name is in the email (the likely owner), else the first one.
      const owner = rs.find((r) => emailMatchesName(r.values.email ?? '', r.values.first_name ?? '', r.values.last_name ?? ''))
      setKeep((owner ?? rs[0])?.id ?? null)
    })
  }, [column, rowIds])

  const key = uniqueRule(column)?.key ?? ((v: string) => v)
  const sameGroup = !!rows && new Set(rows.map((r) => key(r.values[column]))).size === 1
  const kept = rows?.find((r) => r.id === keep)
  const others = useMemo(() => (rows ?? []).filter((r) => r.id !== keep).map((r) => r.id), [rows, keep])

  // Fields where the rows disagree. Unique columns (the ID) always come from the kept row.
  const conflicts = new Set(
    rows ? COLUMNS.filter((c) => !uniqueRule(c) && new Set(rows.map((r) => r.values[c].trim())).size > 1) : [],
  )

  /**
   * Default per field: the kept row's value, with its known fix applied ("Deutschland" → "DE"),
   * so the default never swaps in another person's data. Only a broken value without a fix
   * falls back to another row's valid value.
   */
  const defaultFor = (c: Column): string => {
    if (!kept || !rows) return ''
    const issue = kept.issues[c]
    if (!issue || issue === uniqueRule(c)?.issue) return kept.values[c]
    if (kept.suggestions[c] !== undefined) return kept.suggestions[c]!
    return rows.find((r) => !r.issues[c])?.values[c] ?? kept.values[c]
  }

  const result = useMemo(() => {
    if (!kept) return null
    const values = { ...kept.values }
    for (const c of conflicts) values[c] = picked[c] ?? defaultFor(c)
    return values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, picked, rows])

  // Check the merged row, ignoring the rows that will be removed.
  useEffect(() => {
    if (!result || keep === null) return
    let live = true
    Promise.all(COLUMNS.map((c) => dataApi.checkValue(keep, c, result[c], others).then((r) => [c, r] as const))).then(
      (entries) => live && setChecks(Object.fromEntries(entries)),
    )
    return () => {
      live = false
    }
  }, [result, keep, others])

  const problems = COLUMNS.filter((c) => checks[c]?.issue)
  const pick = (c: Column, value: string) => setPicked((p) => ({ ...p, [c]: value }))

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size="xl" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Merge into one customer</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {!rows ? (
                <Text color="fg.muted">Loading the rows…</Text>
              ) : !sameGroup ? (
                <Text color="orange.fg">
                  These rows don't share the same {COLUMN_LABELS[column].toLowerCase()}, so they aren't duplicates of each
                  other. Select rows from one group to merge them.
                </Text>
              ) : rows.length < 2 ? (
                <Text color="green.fg">This row has no duplicates left.</Text>
              ) : (
                <Stack gap="3" fontSize="sm">
                  <Text color="fg.muted">
                    Choose the row that stays (its customer ID is kept). Where the rows disagree, click the value to keep.
                    The other rows are removed; you can undo it.
                  </Text>
                  <Box overflowX="auto" borderWidth="1px" borderRadius="md">
                    <Box as="table" w="full" fontSize="xs" style={{ borderCollapse: 'collapse' }}>
                      <thead>
                        <Box as="tr" bg="bg.subtle">
                          <Box as="th" px="2" py="1.5" textAlign="left">
                            Keep
                          </Box>
                          {COLUMNS.map((c) => (
                            <Box
                              as="th"
                              key={c}
                              px="2"
                              py="1.5"
                              textAlign="left"
                              whiteSpace="nowrap"
                              color={conflicts.has(c) ? 'orange.fg' : undefined}
                            >
                              {COLUMN_LABELS[c]}
                            </Box>
                          ))}
                        </Box>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <Box as="tr" key={r.id} borderTopWidth="1px">
                            <Box as="td" px="2" py="1.5">
                              <input
                                type="radio"
                                name="keep"
                                aria-label={`Keep row ${r.id + 1}`}
                                checked={keep === r.id}
                                onChange={() => setKeep(r.id)}
                              />
                            </Box>
                            {COLUMNS.map((c) => {
                              const conflict = conflicts.has(c)
                              const chosen = conflict ? result?.[c] === r.values[c] : !!uniqueRule(c) && keep === r.id
                              const fix = r.suggestions[c]
                              return (
                                <Box
                                  as="td"
                                  key={c}
                                  px="2"
                                  py="1.5"
                                  whiteSpace="nowrap"
                                  cursor={conflict ? 'pointer' : undefined}
                                  bg={chosen ? 'blue.subtle' : undefined}
                                  _hover={conflict && !chosen ? { bg: 'bg.muted' } : undefined}
                                  onClick={conflict ? () => pick(c, r.values[c]) : undefined}
                                  title={r.issues[c] ? issueType(r.issues[c]!).title : undefined}
                                >
                                  {r.values[c] === '' ? '(empty)' : showSpaces(r.values[c])}
                                  {conflict && r.issues[c] && ' ⚠'}
                                  {conflict && fix !== undefined && (
                                    <Button
                                      size="2xs"
                                      variant={result?.[c] === fix ? 'solid' : 'ghost'}
                                      colorPalette="blue"
                                      ml="1"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        pick(c, fix)
                                      }}
                                    >
                                      → {showSpaces(fix)}
                                    </Button>
                                  )}
                                </Box>
                              )
                            })}
                          </Box>
                        ))}
                        {result && (
                          <Box as="tr" borderTopWidth="2px" borderColor="border.emphasized" fontWeight="semibold">
                            <Box as="td" px="2" py="2">
                              Result
                            </Box>
                            {COLUMNS.map((c) => (
                              <Box
                                as="td"
                                key={c}
                                px="2"
                                py="2"
                                whiteSpace="nowrap"
                                bg={checks[c]?.issue ? 'orange.subtle' : undefined}
                                title={checks[c]?.issue ? issueType(checks[c]!.issue!).title : undefined}
                              >
                                {result[c] === '' ? '(empty)' : showSpaces(result[c])}
                              </Box>
                            ))}
                          </Box>
                        )}
                      </tbody>
                    </Box>
                  </Box>
                  {problems.length === 0 ? (
                    <Text color="green.fg">✓ No problems in the merged customer</Text>
                  ) : (
                    problems.map((c) => (
                      <Text key={c} color="orange.fg">
                        ⚠ {COLUMN_LABELS[c]}: {issueType(checks[c]!.issue!).title} (you can fix it after merging)
                      </Text>
                    ))
                  )}
                </Stack>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="blue"
                disabled={!result || keep === null || !sameGroup || others.length === 0}
                onClick={() => result && keep !== null && onMerge(keep, others, result)}
              >
                Merge {rows?.length ?? ''} rows into one
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
