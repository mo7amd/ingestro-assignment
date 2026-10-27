import { Progress, Stack, Text } from '@chakra-ui/react'
import type { LoadProgress } from '../../worker/client'
import { formatCount } from '../format'

interface Props {
  fileName: string
  progress: LoadProgress | null
}

function message(p: LoadProgress | null): string {
  if (!p) return 'Opening file…'
  if (p.phase === 'reading') {
    const estimate = Math.max(p.rowsParsed, Math.round(p.estimatedTotalRows / 1000) * 1000)
    return `Reading ${formatCount(p.rowsParsed)} of ~${formatCount(estimate)} rows`
  }
  return `Checking ${formatCount(p.rowsParsed)} customers for problems…`
}

export function LoadingState({ fileName, progress }: Props) {
  const percent = Math.round(progress?.percent ?? 0)
  return (
    <Stack gap="3" aria-live="polite">
      <Text fontWeight="semibold">{fileName}</Text>
      <Progress.Root value={progress ? percent : null} colorPalette="blue" size="lg">
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      <Text color="fg.muted">
        {message(progress)} ({percent}%)
      </Text>
    </Stack>
  )
}
