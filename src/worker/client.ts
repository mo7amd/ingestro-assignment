import * as Comlink from 'comlink'
import type { DataApi } from './data.worker'

export type { DataApi, LoadProgress, Summary, IssueCount, RowSlice, Ambiguity, RowFilter, ViewQuery, ViewInfo, HistoryState, ValueCheck, FixPreview, FixGroup } from './data.worker'

const worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' })

/** The single data worker, wrapped so its functions can be awaited. */
export const dataApi = Comlink.wrap<DataApi>(worker)

export { proxy } from 'comlink'
