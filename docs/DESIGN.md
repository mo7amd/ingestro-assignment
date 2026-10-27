# Design Document

A review-and-fix flow for a 200,000-row customer file, for non-technical users. The full reasoning behind each decision is in [DECISIONS.md](./DECISIONS.md) (D1–D25).

## 1. Architecture

```
 MAIN THREAD (React)                          WEB WORKER (owns the data)
┌──────────────────────────┐                ┌─────────────────────────────────────┐
│ Overview                 │── summary ────▶│ Streaming parser (Papa Parse)       │
│ Virtual grid (~50 rows)  │── rows 400–599▶│ Columnar store + issue code / cell  │
│ Dialogs: review · merge  │── preview, ───▶│ Rule engine  ◀── rules.json         │
│          · export        │   apply, undo  │ Views: filter → search → sort       │
└──────────────────────────┘◀── pages ──────│ Change sets: undo / redo            │
                                            └─────────────────────────────────────┘
```

The worker owns the data; React renders only what's on screen. Parsing, validation, duplicates, search, sort, bulk fixes, undo and export all run in the worker, and the page receives summaries and 200-row pages. Validation rules are data (`src/config/rules.json`), run by a generic engine with seven check types. Stack: Vite, React 19, TypeScript, `@tanstack/react-virtual` (headless, so we control the issue styling), Chakra UI for the shell only, Papa Parse, Comlink.

## 2. ADR: the data lives in a Web Worker, not in React state

**Context.** 200k rows with validation, sort, search and bulk edits; on the main thread, any of them blocks scrolling and typing.
**Decision.** One worker holds the data by column plus a per-cell issue code. Each view is a `Uint32Array` of row ids. The grid asks for the page around the visible window. Edits are change sets that re-check only the touched cells, so undo is cheap.
**Alternatives.** *React state:* simplest, but every sort or bulk fix freezes the page. *SQLite WASM on OPFS:* SQL and persistence, but about 1 MB of WASM and a second query layer for data that fits in memory. *Backend:* right for production, out of scope here.
**Consequences.** Responsive UI and pure, Node-testable domain logic. In exchange, every call is async, and a reload loses work until persistence lands (D3).

## 3. UX decisions

- **Overview first.** One bar: *looks good* / *we can fix it* / *needs you* (53 / 37 / 10%), then one card per problem, fixable ones first, since they clear about 72% of flagged cells.
- **One problem at a time.** Opening a card filters the table and highlights only that column. "All rows" highlights everything. No wall of red.
- **Plain language.** Every issue has a title, an explanation and a good example, behind an icon next to the filter. It opens on click, never on hover.
- **Fixes where the eye is.** The suggestion in a cell (`Polska → PL`) is a button. Editing shows a live check under the cell.
- **Review, then apply.** The bulk preview groups changes by value with counts. Any value can be unticked. One apply is one undo step, and fixed rows stay in place.
- **Reversible.** Undo/redo, a blue dot on changed cells with "was X · undo this cell", and merged rows left visible, struck through.
- **Duplicates in the same table.** Groups sit together, with Fix (own email) or Merge (pick values, checked result).
- **Colour carries one meaning.** Green good, teal auto-fix, amber needs a person, orange actions only.

## 4. Performance

| What | Where | Measured (200k rows, Chrome) |
|---|---|---|
| Parse, validate, duplicates, index | Worker, 1 MB chunks | ~0.9 s. Nothing blocks while reading; one ~60–150 ms task when the result first renders |
| Filter / search / sort | Worker, typed-array views | Filters instant. Sorting all rows ~1.7 s, with a "Sorting…" indicator |
| Rendering | Virtual grid, plain CSS cells | ~50 rows in the DOM |
| Bulk fix / undo | Worker, re-checks touched cells | All automatic fixes (~88k cells) ~0.13 s |
| Export | Worker builds CSV, page downloads | 15.7 MB in ~0.5 s |

**Backend in production:** storing the import and edit log, final re-validation (the client can't be trusted), schema delivery, and server-side paging for millions of rows.

## 5. Backend contract and import summary (not built)

Rules would come from the importer's schema; end users teach mappings, not rules (D24).

```
GET  /importers/:id/schema   → { columns, messages }
POST /imports/:id/changes    ← [{ row, column, before, after }]
POST /imports/:id/commit     → { accepted, rejected: [{ row, column, issue }] }
```

**Import summary screen:** rows imported, removed and still flagged; changes grouped by kind ("67,366 countries normalized"), each expandable; open issues linking back into the table; the change log as CSV.

## 6. Assumptions

- **`03/04/2024`:** the order is inferred from the whole file. 4,545 dates are only valid day-first and none month-first, so all are read day-first, including US rows (a per-country rule would misread 440). The country is a fallback only.
- **Emails:** compared case-insensitively. Invalid ones are their own issue, not duplicates.
- **Spend:** currency symbols and codes are stripped; the last of `,`/`.` is the decimal separator.
- **Fixable means exactly one clear answer.** Missing, impossible or unknown values need a person. The original file is never modified.

## 7. AI note

Built with Claude (AI coding assistant): code, docs and the demo script, with sub-agents for the first worker version and for reviews. I directed the product decisions and reversed several AI proposals, all logged in DECISIONS.md: removing the side panel, rules as configuration, duplicates inside the table, and dropping the per-country date rule. **Verified by:**
- type-check and lint
- the domain code run over the real CSV in Node
- every flow driven in a browser, with the Long Tasks API for responsiveness
- the Playwright demo, which caught a real bug
- a final comparison with the generator's answer key, not used during the build: exact matches for dates, plans, names and invalid spend. The remaining gaps are explained (plain decimals like `52.50` are valid by the rules; the generator counts injections that later ones overwrite).

## 8. Scope and trade-offs

**Beyond the must-haves, and why.** Merge, multi-row set, export, redo and URL state go past the brief's maximum. Each closes a gap a real user would hit within minutes: duplicates can't be resolved with an edit alone, the fixed data has to leave the browser, and undo without redo is easy to regret. With less time, I'd cut these first; the must-haves don't depend on them.

**Simplified.** Everything in memory. Only 8 countries in the reference data. No list of changed rows (cell markers and a last-action label instead). No automated tests. 711 kB unsplit bundle.

**Next.**
1. Persist the edit log in IndexedDB.
2. Cache sort keys (1.7 s → under 1 s).
3. Server-side paging.
4. User-defined bulk-fix rules per column.
5. More sources: URL, XLSX, JSON.
