import { Alert, Button, Container, Heading, HStack, Stack, Text } from '@chakra-ui/react'
import { navigate, useRoute } from './app/router'
import { Dashboard } from './features/dashboard/Dashboard'
import { FilePicker } from './features/load/FilePicker'
import { LoadingState } from './features/load/LoadingState'
import { useHistory } from './features/history/useHistory'
import { useImport } from './features/load/useImport'
import { ExportButton } from './features/export/ExportButton'
import { FixReviewDialog } from './features/fixes/FixReviewDialog'
import { dataApi } from './worker/client'
import type { IssueCode } from './domain/config'
import { useState } from 'react'
import { TableView } from './features/table/TableView'

if (window.location.pathname === '/') history.replaceState(null, '', '/dashboard')

export default function App() {
  const { state, start, reset, refreshSummary } = useImport()
  const route = useRoute()
  const history = useHistory(refreshSummary)
  const [reviewing, setReviewing] = useState<IssueCode[] | null>(null)

  return (
    <Container maxW="8xl" py="6">
      <Stack gap="6">
        <HStack justify="space-between">
          <Heading size="2xl" cursor="pointer" onClick={() => navigate({ page: 'dashboard' })}>
            Ingestro
          </Heading>
          {state.status === 'ready' && (
            <HStack>
              <Button size="sm" variant="ghost" disabled={!history.history.undo} onClick={history.undo} title={history.history.undo}>
                ↶ Undo
              </Button>
              <Button size="sm" variant="ghost" disabled={!history.history.redo} onClick={history.redo} title={history.history.redo}>
                ↷ Redo
              </Button>
              {history.history.undo && (
                <Text color="fg.muted" fontSize="sm" maxW="72" truncate>
                  Last: {history.history.undo}
                </Text>
              )}
              <Text color="fg.muted" fontSize="sm">
                {state.fileName}
              </Text>
              <ExportButton summary={state.summary} fileName={state.fileName} />
              {route.page === 'dashboard' && (
                <Button variant="outline" size="sm" onClick={() => navigate({ page: 'table', filter: { kind: 'all' }, search: '' })}>
                  Browse all rows
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigate({ page: 'dashboard' })
                  history.reset()
                  reset()
                }}
              >
                Load another file
              </Button>
            </HStack>
          )}
        </HStack>

        {state.status === 'idle' && <FilePicker onFile={start} />}

        {state.status === 'loading' && <LoadingState fileName={state.fileName} progress={state.progress} />}

        {state.status === 'error' && (
          <Stack gap="4">
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Title>{state.message}</Alert.Title>
            </Alert.Root>
            <FilePicker onFile={start} />
          </Stack>
        )}

        {state.status === 'ready' && route.page === 'dashboard' && (
          <Dashboard
            summary={state.summary}
            onOpenIssue={(code) => navigate({ page: 'table', filter: { kind: 'issue', code }, search: '' })}
            onReviewAll={() => setReviewing(state.summary.issues.filter((i) => i.fixable).map((i) => i.code))}
          />
        )}

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

        {state.status === 'ready' && route.page === 'table' && <TableView summary={state.summary} route={route} history={history} />}
      </Stack>
    </Container>
  )
}
