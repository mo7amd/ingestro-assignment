import { Box, IconButton, Popover, Portal, Stack, Text } from '@chakra-ui/react'
import { issueType } from '../../domain/config'
import { uniqueRule } from '../../domain/validate'
import type { RowFilter, Summary } from '../../worker/client'
import { formatCount } from '../format'

/** "!" beside the filter: what the current filter means. Opens on click, never on hover. */
export function FilterInfo({ filter, summary }: { filter: RowFilter; summary: Summary }) {
  return (
    <Popover.Root positioning={{ placement: 'bottom-start' }}>
      <Popover.Trigger asChild>
        <IconButton aria-label="What does this filter mean?" size="sm" variant="ghost" color="fg.muted">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="7" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </IconButton>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Body>
              <Explanation filter={filter} summary={summary} />
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  )
}

function Explanation({ filter, summary }: { filter: RowFilter; summary: Summary }) {
  if (filter.kind === 'all')
    return <Text fontSize="sm">Every customer in the file. Cells with a problem are highlighted; the number at the start of a row says how many problems it has.</Text>
  if (filter.kind === 'any-issue')
    return <Text fontSize="sm">Customers with at least one problem. Cells with a problem are highlighted.</Text>

  const t = issueType(filter.code)
  const amb = summary.ambiguities.find((a) => a.column === t.column)
  return (
    <Stack gap="2" fontSize="sm">
      <Text fontWeight="semibold">{t.title}</Text>
      <Text color="fg.muted">{t.explanation}</Text>
      <Text>
        {t.fixable ? 'Fix: ' : 'Good value: '}
        <Box as="code" px="1" bg="bg.muted" borderRadius="sm">
          {t.example}
        </Box>
      </Text>
      {amb?.chosen && t.fixable && (
        <Text color="fg.muted">
          Values like 03/04/2024 are read as {amb.chosen}, because {formatCount(amb.evidence[amb.chosen])} values in this
          file only fit that format.
        </Text>
      )}
      <Text color="fg.muted">
        {uniqueRule(t.column)?.issue === t.code
          ? 'Rows that share a value are grouped together. On each row: "Fix" to give it its own value, or "Merge…" if the rows are the same customer. You can also select rows of one group and merge them.'
          : t.fixable
            ? 'Click the suggestion in a cell to apply it, or use "Review & fix all".'
            : 'Double-click a cell to correct it, or select rows and set a value for all of them.'}
      </Text>
    </Stack>
  )
}
