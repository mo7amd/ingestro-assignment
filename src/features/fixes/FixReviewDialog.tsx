import { Badge, Box, Button, CloseButton, Dialog, HStack, Portal, Stack, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { COLUMN_LABELS, issueType, type IssueCode } from '../../domain/config'
import { dataApi, type FixPreview } from '../../worker/client'
import { formatCount, showSpaces } from '../format'

interface Props {
  /** one issue (from the table) or every fixable issue (from the overview) */
  codes: IssueCode[]
  onClose: () => void
  onApply: (codes: IssueCode[], excluded: Record<IssueCode, string[]>) => void
}

const SHOW_FIRST = 8

/**
 * Review before apply: every change grouped by value ("Polska → PL · 2,598 rows"),
 * largest first. Untick a value or a whole issue to leave it alone. One click applies,
 * one undo reverts it all.
 */
export function FixReviewDialog({ codes, onClose, onApply }: Props) {
  const [previews, setPreviews] = useState<FixPreview[] | null>(null)
  const [skipIssue, setSkipIssue] = useState<Set<IssueCode>>(new Set())
  const [skipValue, setSkipValue] = useState<Record<IssueCode, Set<string>>>({})
  const [expanded, setExpanded] = useState<Set<IssueCode>>(new Set())

  useEffect(() => {
    Promise.all(codes.map((c) => dataApi.previewFix(c))).then(setPreviews)
  }, [codes])

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const included = (p: FixPreview) => {
    if (skipIssue.has(p.code)) return 0
    const skipped = p.groups.filter((g) => skipValue[p.code]?.has(g.before)).reduce((n, g) => n + g.count, 0)
    return p.total - skipped
  }
  const total = previews?.reduce((n, p) => n + included(p), 0) ?? 0
  const multi = codes.length > 1

  const apply = () => {
    if (!previews) return
    const chosen = previews.filter((p) => !skipIssue.has(p.code) && included(p) > 0).map((p) => p.code)
    const excluded = Object.fromEntries(chosen.map((c) => [c, [...(skipValue[c] ?? [])]]))
    onApply(chosen, excluded)
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size="lg" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{multi ? 'Review all automatic fixes' : `Review: ${issueType(codes[0]).title}`}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {!previews ? (
                <Text color="fg.muted">Working out the changes…</Text>
              ) : (
                <Stack gap="6">
                  <Text color="fg.muted">
                    Each line shows a value as it is now and what we'll change it to. Untick anything you want to leave as
                    it is. You can undo the whole change afterwards.
                  </Text>
                  {previews.map((p) => {
                    const off = skipIssue.has(p.code)
                    const shown = expanded.has(p.code) ? p.groups : p.groups.slice(0, SHOW_FIRST)
                    return (
                      <Stack key={p.code} gap="2" opacity={off ? 0.5 : 1}>
                        <HStack justify="space-between">
                          <HStack as="label" cursor={multi ? 'pointer' : undefined}>
                            {multi && (
                              <input type="checkbox" checked={!off} onChange={() => setSkipIssue((s) => toggle(s, p.code))} />
                            )}
                            <Text fontWeight="semibold">{issueType(p.code).title}</Text>
                            <Badge variant="subtle">{COLUMN_LABELS[issueType(p.code).column]}</Badge>
                          </HStack>
                          <Text color="fg.muted" fontSize="sm">
                            {formatCount(included(p))} cells
                          </Text>
                        </HStack>
                        <Stack gap="0" borderWidth="1px" borderRadius="md" fontSize="sm">
                          {shown.map((g) => {
                            const skip = off || skipValue[p.code]?.has(g.before)
                            return (
                              <HStack
                                as="label"
                                key={g.before}
                                px="3"
                                py="1.5"
                                gap="3"
                                borderBottomWidth="1px"
                                _last={{ borderBottomWidth: 0 }}
                                cursor="pointer"
                                opacity={skip ? 0.5 : 1}
                              >
                                <input
                                  type="checkbox"
                                  disabled={off}
                                  checked={!skip}
                                  onChange={() =>
                                    setSkipValue((s) => ({ ...s, [p.code]: toggle(s[p.code] ?? new Set<string>(), g.before) }))
                                  }
                                />
                                <Box flex="1" fontFamily="mono" whiteSpace="pre">
                                  <Box as="span" bg="orange.subtle" px="1" borderRadius="sm" textDecoration={skip ? undefined : 'line-through'}>
                                    {showSpaces(g.before)}
                                  </Box>
                                  {'  →  '}
                                  <Box as="span" bg="blue.subtle" px="1" borderRadius="sm">
                                    {g.after}
                                  </Box>
                                </Box>
                                <Text color="fg.muted">{formatCount(g.count)} rows</Text>
                              </HStack>
                            )
                          })}
                        </Stack>
                        {p.groups.length > SHOW_FIRST && (
                          <Button size="xs" variant="ghost" alignSelf="start" onClick={() => setExpanded((s) => toggle(s, p.code))}>
                            {expanded.has(p.code)
                              ? 'Show fewer'
                              : `Show all ${p.groups.length}${p.moreGroups ? '+' : ''} values`}
                          </Button>
                        )}
                        {p.moreGroups > 0 && expanded.has(p.code) && (
                          <Text fontSize="xs" color="fg.muted">
                            …and {formatCount(p.moreGroups)} more distinct values, each changed the same way.
                          </Text>
                        )}
                      </Stack>
                    )
                  })}
                </Stack>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button colorPalette="blue" disabled={!previews || total === 0} onClick={apply}>
                Apply {formatCount(total)} changes
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
