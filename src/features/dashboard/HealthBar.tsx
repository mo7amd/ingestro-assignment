import { Box, HStack, Stack, Text } from '@chakra-ui/react'
import type { Summary } from '../../worker/client'
import { formatCount, formatPercent } from '../format'

const SEGMENTS = [
  { key: 'rowsGood', label: 'Look good', color: 'green.500' },
  { key: 'rowsAutoFixable', label: 'We can fix automatically', color: 'blue.500' },
  { key: 'rowsManual', label: 'Need your decision', color: 'orange.500' },
] as const

/** One bar, three colors: where the whole file stands, at a glance. */
export function HealthBar({ summary }: { summary: Summary }) {
  const total = summary.rowCount || 1
  return (
    <Stack gap="3">
      <HStack h="4" gap="0.5" borderRadius="full" overflow="hidden">
        {SEGMENTS.map((s) => (
          <Box key={s.key} h="full" bg={s.color} style={{ width: `${(summary[s.key] / total) * 100}%` }} />
        ))}
      </HStack>
      <HStack gap="8" wrap="wrap">
        {SEGMENTS.map((s) => (
          <HStack key={s.key} gap="2" align="baseline">
            <Box w="2.5" h="2.5" borderRadius="full" bg={s.color} />
            <Text fontSize="2xl" fontWeight="bold">
              {formatPercent(summary[s.key] / total)}
            </Text>
            <Text color="fg.muted">
              {s.label} · {formatCount(summary[s.key])} rows
            </Text>
          </HStack>
        ))}
      </HStack>
    </Stack>
  )
}
