import { useCallback, useEffect, useState } from 'react'
import { dataApi, type HistoryState } from '../../worker/client'

/**
 * Every change goes through here, so the app refreshes the same way after
 * an edit, a bulk fix, an undo or a redo.
 */
export function useHistory(onChanged: () => void) {
  const [history, setHistory] = useState<HistoryState>({})
  /** Bumped after each change; views use it to re-read their rows. */
  const [version, setVersion] = useState(0)

  const run = useCallback(
    async (action: () => Promise<HistoryState>) => {
      setHistory(await action())
      setVersion((v) => v + 1)
      onChanged()
    },
    [onChanged],
  )

  const undo = useCallback(() => run(() => dataApi.undo()), [run])
  const redo = useCallback(() => run(() => dataApi.redo()), [run])

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const reset = useCallback(() => {
    setHistory({})
    setVersion(0)
  }, [])

  return { history, version, run, undo, redo, reset }
}

export type History = ReturnType<typeof useHistory>
