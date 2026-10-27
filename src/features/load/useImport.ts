import { useCallback, useState } from 'react'
import { dataApi, proxy, type LoadProgress, type Summary } from '../../worker/client'

export type ImportState =
  | { status: 'idle' }
  | { status: 'loading'; fileName: string; progress: LoadProgress | null }
  | { status: 'ready'; fileName: string; summary: Summary }
  | { status: 'error'; message: string }

export function useImport() {
  const [state, setState] = useState<ImportState>({ status: 'idle' })

  const start = useCallback(async (file: File) => {
    const fileName = file.name
    setState({ status: 'loading', fileName, progress: null })
    try {
      const summary = await dataApi.load(
        file,
        proxy((progress: LoadProgress) => setState({ status: 'loading', fileName, progress })),
      )
      setState({ status: 'ready', fileName, summary })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  /** After an edit, fix or undo: pull fresh counts from the worker. */
  const refreshSummary = useCallback(async () => {
    const summary = await dataApi.getSummary()
    setState((s) => (s.status === 'ready' ? { ...s, summary } : s))
  }, [])

  return { state, start, reset, refreshSummary }
}
