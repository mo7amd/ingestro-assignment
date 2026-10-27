import { Button, Heading, HStack, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import type { IssueCode } from '../../domain/config'
import type { IssueCount, Summary } from '../../worker/client'
import { formatCount } from '../format'
import { HealthBar } from './HealthBar'
import { IssueCard } from './IssueCard'

interface Props {
  summary: Summary
  onOpenIssue: (code: IssueCode) => void
  onReviewAll: () => void
}

function Section({ title, issues, onOpenIssue, action }: Props & { title: string; issues: IssueCount[]; action?: React.ReactNode }) {
  if (issues.length === 0) return null
  return (
    <Stack gap="3">
      <HStack justify="space-between">
        <Heading size="md">{title}</Heading>
        {action}
      </HStack>
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} gap="3">
        {issues.map((issue) => (
          <IssueCard key={issue.code} issue={issue} onOpen={() => onOpenIssue(issue.code)} />
        ))}
      </SimpleGrid>
    </Stack>
  )
}

export function Dashboard(props: Props) {
  const { summary } = props
  // summary.issues is sorted by count, largest first.
  const fixable = summary.issues.filter((i) => i.fixable)
  return (
    <Stack gap="8">
      <Stack gap="1">
        <Text color="fg.muted">{formatCount(summary.rowCount)} customers checked</Text>
        <HealthBar summary={summary} />
      </Stack>
      <Section
        {...props}
        title="We can fix these for you"
        issues={fixable}
        action={
          <Button size="sm" colorPalette="blue" onClick={props.onReviewAll}>
            Review & apply all {formatCount(fixable.reduce((n, i) => n + i.count, 0))} fixes
          </Button>
        }
      />
      <Section {...props} title="Needs your decision" issues={summary.issues.filter((i) => !i.fixable)} />
    </Stack>
  )
}
