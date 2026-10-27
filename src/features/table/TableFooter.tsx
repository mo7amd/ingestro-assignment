import { Button, HStack, Text } from '@chakra-ui/react'
import { formatCount } from '../format'

interface Props {
  count: number
  visible: [number, number]
  /** position of the active row, if any */
  active: number | null
  /** duplicate views: which group the current row is in */
  group?: { ordinal: number; total: number }
  onGoTo: (index: number) => void
}

/** Under the table: where you are, and step through the list row by row. */
export function TableFooter({ count, visible, active, group, onGoTo }: Props) {
  const [first, last] = visible
  return (
    <HStack justify="space-between" fontSize="sm" color="fg.muted">
      <Text>
        {count === 0 ? 'No rows' : `Rows ${formatCount(first + 1)}–${formatCount(Math.min(last + 1, count))} of ${formatCount(count)}`}
        {group && ` · Group ${formatCount(group.ordinal)} of ${formatCount(group.total)}`}
      </Text>
      <HStack gap="2">
        <Button size="xs" variant="outline" disabled={!count || (active ?? 0) <= 0} onClick={() => onGoTo((active ?? 0) - 1)}>
          ◀ Previous
        </Button>
        <Text minW="32" textAlign="center">
          {active === null ? 'No row selected' : `${formatCount(active + 1)} of ${formatCount(count)}`}
        </Text>
        <Button
          size="xs"
          variant="outline"
          disabled={!count || (active ?? -1) >= count - 1}
          onClick={() => onGoTo(active === null ? 0 : active + 1)}
        >
          Next ▶
        </Button>
      </HStack>
    </HStack>
  )
}
