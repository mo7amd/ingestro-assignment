# Design Document

A review-and-fix flow for a 200,000-row customer file, for non-technical users. Every decision and the discussion behind it is logged in [DECISIONS.md](./DECISIONS.md) (D1–D24); this document is the short version.

## 1. Architecture overview

```mermaid
flowchart LR
  subgraph Main["Main thread · React"]
    R[Router<br/>URL = filter, search, sort]
    D[Overview<br/>health bar + issue cards]
    T[Virtual grid<br/>~50 rows in the DOM]
    M[Dialogs<br/>bulk review · merge · export]
  end
  subgraph W["Web Worker · owns the data"]
    P[Streaming parser<br/>Papa Parse, 1 MB chunks]
    S[(Columnar store<br/>string[] per column<br/>Uint8Array issue per cell)]
    V[Rule engine]
    Q[Views<br/>filter → search → sort<br/>= Uint32Array of row ids]
    H[Change sets<br/>undo / redo, removed rows]
  end
  C[(rules.json<br/>columns, checks, texts)]
  F[import-data.csv] --> P --> S --> V
  C --> V
  T -- "rows 400–599 of view" --> Q --> S
  D -- summary --> V
  M -- preview / apply / undo --> H --> S
  H -. re-check touched cells .-> V
```

- **The worker owns the data; React renders only what's on screen.** Parsing, validation, duplicate detection, search, sort, bulk fixes, undo and export all run in one worker. The page talks to it through Comlink and receives summaries and 200-row pages.
- **Rules are data.** `src/config/rules.json` lists the columns, the ordered checks per column and every issue's plain-language text. A generic engine runs seven check types: required, trimmed, pattern, unique, oneOf with aliases, date, and number.
- **Stack:**
  - Vite + React 19 + TypeScript
  - `@tanstack/react-virtual`: a headless virtual grid, so we control how issues look
  - Chakra UI: the shell and dialogs only, never per cell
  - Papa Parse: streaming
  - Comlink: typed worker calls
  - No router library: about 80 lines on `history.pushState`

## 2. ADR: the data lives in a Web Worker, not in React state

**Context.** 200k rows × 8 columns, with validation, sorting, search and bulk changes. Any of these on the main thread blocks scrolling and typing.

**Decision.** One worker owns the dataset, stored by column, plus a per-cell issue code. Each view (filter → search → sort) is a `Uint32Array` of row ids kept in the worker. The grid asks for the page around the visible window. Edits go to the worker as change sets, which re-check only the touched cells (plus duplicates), so undo and redo are cheap.

**Alternatives considered.**
- **React state with `useMemo`:** simplest, but every sort, filter or bulk fix freezes the page, and 200k objects churn the garbage collector.
- **SQLite (WASM) on OPFS:** real SQL and persistence, but about 1 MB of WASM, OPFS setup, and a second query language. The data fits in memory, so SQL buys little.
- **Backend:** the right home for production imports, but out of scope for this prototype.

**Consequences.** The UI stays responsive (measured below), and the domain logic is pure and testable in Node. In exchange: every interaction is async, there's one place where state lives, and a reload loses work until persistence is added (D3, deferred).

## 3. UX decisions

- **Overview first, like a KPI dashboard.**
  - One bar answers "where do I stand?": *look good* / *we can fix automatically* / *needs your decision*. On this file: 53% / 37% / 10%.
  - Below it, one card per problem, biggest first.
  - The fixable problems come first because one bulk fix clears about 72% of all flagged cells.
- **One problem at a time, never a wall of red.**
  - **Focus mode** (click a card) filters the table to the affected rows and highlights only that column. The row counter and other problems are hidden.
  - **Browse mode** (all rows / rows with problems) highlights everything.
- **Plain language everywhere.** Every issue has a title ("Country not a 2-letter code"), an explanation, and an example of a good value. They sit behind an icon next to the filter and open on click, never on hover.
- **Fixes sit where the eye already is.** The suggestion in a cell (`Polska → PL`) is a button. Editing in place shows a small check under the cell as you type ("⚠ Unknown country · Use DE").
- **Bulk fix = review, then apply.**
  - The preview groups every change by value, with counts (`USA → US · 2,755 rows`).
  - Any value or whole issue can be unticked.
  - Applying is one undo step. The list stays stable afterwards (fixed rows don't jump away), and counts update everywhere.
- **Confidence through reversibility.** Undo/redo with shortcuts, a last-action label, a blue dot on changed cells, "was X · Undo this cell", and merged rows left visible but struck through.
- **Duplicates stay in the same table.** Rows of a group sit together. Each row offers **Fix** (give it its own email) or **Merge…**. The merge dialog is a small table: pick the row to keep, click the value to keep per field, and see a checked result row. Defaults never swap in another person's data.
- **Navigable and shareable.** Filter, search (`country:deutsch`, `email:empty`) and sort live in the URL. The footer shows the position, with Previous/Next. Keyboard: ↑/↓, Shift+↑/↓, ⌘/Ctrl+click, Enter to edit, Esc.

## 4. Performance approach

| What | Where | Why | Measured (200k rows, Chrome) |
|---|---|---|---|
| Parse + validate + duplicates + index | Worker, streamed in 1 MB chunks | Never blocks the page | ~0.9 s total, 0 long tasks on the main thread |
| Filter / search / sort | Worker → `Uint32Array` view | Linear scans and typed arrays are fast; no copying to React | Open a filter: instant. Sort all rows by email: ~1.7 s (worker) |
| Rendering | Main thread, virtual grid, plain CSS cells | Only visible rows exist | ~50 rows in the DOM; jumping to row 200,000 is instant |
| Fetching rows | 200-row pages around the window, kept until fresh ones arrive | No flicker after edits | – |
| Bulk fix / undo | Worker re-checks only the touched cells | Proportional to the change, not the file | Apply all automatic fixes (~88k cells): ~0.13 s |
| Export | Worker builds the CSV, page downloads a Blob | Same as above | 15.7 MB in ~0.5 s |

What we'd expect from a backend in production: storing the import and its edit log, the final validated import (the receiving system re-validates, since the client can't be trusted), schema delivery, and very large files (millions of rows) via server-side paging.

## 5. Where the rules come from in production

In the prototype, `rules.json` mixes three owners. In production it would split:
- **Schema:** columns, required/unique, allowed values, formats. Owned by whoever sets up the importer, and served per importer.
- **Reference data:** country names in every language, currencies, date formats. Owned by the product and kept in a library.
- **Messages:** translation files.

End users never edit rules; they can only teach **mappings** ("Remember: Holland → NL") from the bulk review, saved per customer (D24).

**Assumed API contract:**

```
GET  /importers/:id/schema     → { columns: [{ key, label, checks: [...] }], messages: {...} }
POST /imports                  → { importId }                       (file metadata, schema version)
POST /imports/:id/changes      ← [{ row, column, before, after }]    (edit log, idempotent per change id)
POST /imports/:id/mappings     ← [{ column, from, to }]              ("remember this")
POST /imports/:id/commit       → { accepted, rejected: [{ row, column, issue }] }
```

**Import summary screen (documented, not built).** Shown after "Download" or "Commit":
- Rows imported / removed (merged) / still flagged.
- Changes grouped by kind ("67,366 countries normalized", "2 duplicates merged"), each expandable to the before → after values.
- What's still open, by issue, with a link back into the table.
- One button to download the change log as CSV for auditing.

## 6. Assumptions

- **Dates like `03/04/2024`:** the order is inferred from the whole file. 4,545 dates can only be day-first and none only month-first, so all are read **day-first**, including US rows. A per-country rule would have misread 440 US dates. The country is only a fallback if the evidence conflicts.
- **Emails:** compared trimmed and case-insensitive. Invalid emails don't take part in duplicate checks; they're their own issue. A duplicate email is usually *different people*, so Fix is offered before Merge.
- **Spend:** `€`, `$`, `£`, `EUR`, `USD`, `GBP` and spaces are stripped. When both `,` and `.` appear, the last one is the decimal separator. Plain `52.50` is valid, and blank sorts last.
- **Names:** stray spaces are an automatic fix (trim). Empty after trimming means missing.
- **Fixes never invent data:** only issues with one clear answer are "fixable". Missing, impossible or unknown values need a person.
- **The original file is never modified;** the output is a new `.fixed.csv`.

## 7. AI note

**What AI did.** The code and docs were written with Claude (an AI coding assistant), in one long conversation. The scaffold, the worker, the rule engine, the grid, the dialogs and the demo script were generated by Claude; a sub-agent wrote the first worker and validation version; another sub-agent reviewed these docs against the code.

**What I changed.** I directed the product decisions, and several AI proposals were reversed. All of it is logged in DECISIONS.md:
- dropping hover popovers and then the whole side panel
- focus mode showing only the issue in hand
- rules as configuration instead of code
- routes, with filters and sort in the URL
- duplicates moved back into the table
- the merge dialog shaped as a table
- cutting keyboard shortcuts and auto-advance that the AI had added on its own
- dropping the per-country date rule once the data showed it would misread 440 US dates

**How it was verified.**
- Type-check and lint on every change.
- The pure domain code was run over the real CSV in Node, and the config-driven engine reproduced the hand-written version's counts exactly.
- Every flow was driven in a real browser.
- Responsiveness was measured with the Long Tasks API.
- The Playwright demo replays all flows end to end, and it caught a real bug: the table showed "No rows" after any edit followed by navigation.
- At the end, our counts were compared with the generator's answer key, which wasn't used during the build:
  - exact matches for dates (13,917 format + 3,052 missing + 2,950 impossible), plans (2,124), names (2,966 + 1,531), non-numeric (808) and negative (608) spend
  - spend format differs by 719, of which 692 are plain decimals like `52.50` that the rules call valid
  - email and country counts differ because the generator counts injections, and later injections overwrite earlier ones on the same cell

## 8. Trade-offs and what I'd do next

**Simplified.**
- Everything is held in memory (a reload loses work).
- One worker and one table.
- Only 8 countries in the reference data.
- The bundle is 709 kB unsplit.

**Next.**
1. Persist the edit log in IndexedDB and replay it after re-picking the file (D3).
2. Sorting with a precomputed key cache (1.7 s → well under 1 s).
3. Server-side paging for files beyond a few million rows.
4. User defined rules for bulk fixes per col.
5. Support mutli sources for data like URL, xlsx, json
