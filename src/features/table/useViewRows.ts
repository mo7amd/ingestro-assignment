import { useCallback, useEffect, useRef, useState } from 'react'
import { dataApi, type RowSlice, type ViewInfo, type ViewQuery } from '../../worker/client'

const PAGE = 200

/**
 * Pages rows of the current view from the worker on demand.
 * The table only ever holds the pages around what is on screen.
 *
 * `dataVersion` changes after edits: rows are re-read but the view (which rows, in
 * which order) stays put, so fixed rows don't jump away under the user.
 * Old pages stay visible until their fresh copy arrives, so nothing flickers.
 */
export function useViewRows(query: ViewQuery, dataVersion: number) {
  const [info, setInfo] = useState<ViewInfo | null>(null)
  const [, setTick] = useState(0)
  const pages = useRef(new Map<number, RowSlice[]>())
  const stale = useRef(new Set<number>())
  const pending = useRef(new Set<number>())
  const generation = useRef(0)
  const lastRange = useRef<[number, number]>([0, 0])
  const key = JSON.stringify(query)

  const fetchPages = useCallback((start: number, end: number) => {
    const gen = generation.current
    for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) {
      if ((pages.current.has(p) && !stale.current.has(p)) || pending.current.has(p)) continue
      pending.current.add(p)
      dataApi.getViewRows(p * PAGE, PAGE).then((rows) => {
        if (gen !== generation.current) return
        pending.current.delete(p)
        stale.current.delete(p)
        pages.current.set(p, rows)
        setTick((v) => v + 1)
      })
    }
  }, [])

  // New view: drop everything and ask the worker for it.
  useEffect(() => {
    const gen = ++generation.current
    pages.current = new Map()
    stale.current = new Set()
    pending.current = new Set()
    setInfo(null)
    dataApi.setView(JSON.parse(key) as ViewQuery).then((i) => {
      if (gen === generation.current) setInfo(i)
    })
  }, [key])

  // Data changed: same view, fresh values.
  useEffect(() => {
    if (dataVersion === 0) return
    generation.current++
    pending.current = new Set()
    stale.current = new Set(pages.current.keys())
    fetchPages(...lastRange.current)
  }, [dataVersion, fetchPages])

  const ensureRange = useCallback(
    (start: number, end: number) => {
      lastRange.current = [start, end]
      fetchPages(start, end)
    },
    [fetchPages],
  )

  const getRow = useCallback(
    (index: number): RowSlice | undefined => pages.current.get(Math.floor(index / PAGE))?.[index % PAGE],
    [],
  )

  return { info, ensureRange, getRow }
}
