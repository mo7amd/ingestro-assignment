/**
 * Tiny URL router. The URL is the single source of truth for what the user is looking at:
 *   /dashboard                                  overview
 *   /dashboard/all | /dashboard/problems        table, all rows / rows with any problem
 *   /dashboard/country-format                   table focused on one issue
 *   ...?q=country:deutsch&sort=monthly_spend&dir=desc
 */
import { useSyncExternalStore } from 'react'
import { COLUMNS, ISSUE_TYPES, type Column } from '../domain/config'
import type { RowFilter, ViewQuery } from '../worker/client'

export type Route = { page: 'dashboard' } | ({ page: 'table' } & ViewQuery)

const toSlug = (code: string) => code.toLowerCase().replace(/_/g, '-')
const BY_SLUG = new Map(ISSUE_TYPES.map((t) => [toSlug(t.code), t.code]))

function filterSlug(f: RowFilter): string {
  if (f.kind === 'issue') return toSlug(f.code)
  return f.kind === 'any-issue' ? 'problems' : 'all'
}

function parseFilter(slug: string): RowFilter | null {
  if (slug === 'all') return { kind: 'all' }
  if (slug === 'problems') return { kind: 'any-issue' }
  const code = BY_SLUG.get(slug)
  return code ? { kind: 'issue', code } : null
}

export function routeFromLocation(loc: Location = window.location): Route {
  const [, base, slug] = loc.pathname.split('/')
  const filter = base === 'dashboard' && slug ? parseFilter(decodeURIComponent(slug)) : null
  if (!filter) return { page: 'dashboard' }
  const p = new URLSearchParams(loc.search)
  const sortCol = p.get('sort')
  const sort =
    sortCol && (COLUMNS as readonly string[]).includes(sortCol)
      ? { column: sortCol as Column, dir: p.get('dir') === 'desc' ? ('desc' as const) : ('asc' as const) }
      : undefined
  return { page: 'table', filter, search: p.get('q') ?? '', sort }
}

export function routeToUrl(route: Route): string {
  if (route.page === 'dashboard') return '/dashboard'
  const p = new URLSearchParams()
  if (route.search) p.set('q', route.search)
  if (route.sort) {
    p.set('sort', route.sort.column)
    p.set('dir', route.sort.dir)
  }
  const qs = p.toString()
  return `/dashboard/${filterSlug(route.filter)}${qs ? `?${qs}` : ''}`
}

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

/** replace = don't add a history entry (used while typing a search). */
export function navigate(route: Route, { replace = false } = {}) {
  const url = routeToUrl(route)
  if (url === window.location.pathname + window.location.search) return
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
  notify()
}

// Snapshot must be stable between changes for useSyncExternalStore.
let cachedHref = ''
let cachedRoute: Route = { page: 'dashboard' }
function snapshot(): Route {
  if (window.location.href !== cachedHref) {
    cachedHref = window.location.href
    cachedRoute = routeFromLocation()
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    snapshot,
  )
}
