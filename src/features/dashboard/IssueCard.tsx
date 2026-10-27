import { Badge, Card, Text } from '@chakra-ui/react'
import { COLUMN_LABELS, issueType } from '../../domain/config'
import type { IssueCount } from '../../worker/client'
import { formatCount } from '../format'

interface Props {
  issue: IssueCount
  onOpen: () => void
}

/** Column, count, title. The explanation lives in the table's details panel. */
export function IssueCard({ issue, onOpen }: Props) {
  const t = issueType(issue.code)
  return (
    <Card.Root
      size="sm"
      variant="outline"
      cursor="pointer"
      _hover={{ borderColor: 'border.emphasized', shadow: 'sm' }}
      onClick={onOpen}
    >
      <Card.Body gap="2">
        <Badge alignSelf="start" variant="subtle">
          {COLUMN_LABELS[issue.column]}
        </Badge>
        <Text fontSize="3xl" fontWeight="bold" lineHeight="1">
          {formatCount(issue.count)}
        </Text>
        <Text fontWeight="medium">{t.title}</Text>
      </Card.Body>
    </Card.Root>
  )
}
