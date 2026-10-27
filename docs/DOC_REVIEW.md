# Doc review: DESIGN.md + DECISIONS.md vs. code

Scope: `docs/DESIGN.md` (64 lines), `docs/DECISIONS.md` (D1–D24, 298 lines), all of `src/`, `package.json`.
Sanity checks: `npm run build` passes (main bundle 709 kB / 209 kB gzip, worker 44 kB; Vite warns about the >500 kB chunk). `npm run lint` is clean. The build rewrote `dist/`, which is gitignored.

---

## 1. What the docs say

**Architecture and data flow**
- Frontend-only Vite 6 + React 19 + TS app. Chakra UI for the shell, `@tanstack/react-virtual` for the grid, Papa Parse in a worker, Comlink for RPC (DESIGN §2).
- A single Web Worker owns the data: it streams the CSV with Papa Parse, keeps rows in columnar arrays, validates them, builds an issue index (code → row ids) and runs search, sort and filter as a `Uint32Array` view. React only asks for the rows on screen (DESIGN §1, D1, D2, D17).
- Validation is configuration: `src/config/rules.json` holds the columns, ordered checks and plain-language texts. `src/domain/validate.ts` runs 7 generic check types, and the first failing check wins (DESIGN §3, D14).
- In production the rules would come from the importer schema (`GET /importers/:id/schema`), reference data from a library, and messages from translation files. End users teach mappings, not rules. None of this is built (DESIGN §3, D24).
- Persistence and resumable loading through IndexedDB are deferred. Everything lives in worker memory, and a reload loses the edits (D3, DESIGN §2).
- Ambiguous dates: the day/month order is inferred from the whole column (this file is DD/MM). Country is only a fallback (D6, D14).

**UX flows**
- **Load:** pick a file, a progress bar runs, and the main thread doesn't block. A full load takes about 0.9 s (D1, "Performance check").
- **Dashboard (`/dashboard`):** a 3-colour health bar (good / auto-fixable / manual) plus issue cards in two sections, "We can fix these for you" and "Needs your decision". A card click opens focus mode. There is also "Review & apply all N fixes" (D15, D19).
- **Focus mode (`/dashboard/<issue-slug>`):** the grid is filtered to one issue, and only that column is highlighted, with the inline `→ fix` (D11, D17, D18).
- **Browse (`/dashboard/all`, `/dashboard/problems`):** every issue cell is highlighted, with a per-row problem count (D18).
- **Search:** field-aware `field:value` syntax, `field:empty`, AND semantics. The guided dropdown and chips aren't built (D13, D17).
- **Sort:** click a header to cycle asc → desc → off. Spend sorts numerically, and blanks go last (D17).
- **Routes:** URL holds the state (`?q=&sort=&dir=`), with a small custom router. Filter and sort changes push history entries; search replaces the entry after 250 ms (D16).
- **No side panel (D21):** toolbar with filter select, the "!" explanation popover (opens on click), "Review & fix all N" and search. In-cell cards show the live edit check, and "was X · Undo this cell" on changed cells. A footer shows "Rows a–b of N" and Previous / k of N / Next.
- **Inline edit:** double-click or Enter. Each keystroke is checked in the worker (including duplicates). Enter/blur saves, Esc cancels (D19).
- **Bulk fix:** a review dialog lists the changes grouped by value, largest first. The user can untick single values or whole issues, and one apply makes one undo step (D19).
- **Undo/redo:** a linear ChangeSet history, with header buttons and Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z. "Undo this cell" adds a new entry (D10, D19).
- **Selection:** click, Cmd/Ctrl+click, ↑/↓, Shift+↑/↓, Enter, Esc. With 2+ rows selected a floating bar offers "Apply suggested fixes" or "set [column] to [value]" (D22).
- **Duplicates (D23, which replaces the D8 cards):** rows are grouped next to each other in the normal table, with group dividers and "Group k of N" in the footer. Per-row Fix and Merge… are offered, and Fix is hidden on the row that owns the email. The merge dialog is a table with a Result row, and merged rows stay in place, struck through.
- **Export:** "Download fixed file" writes `<name>.fixed.csv`. If problems remain, a confirm step comes first. The original file is never modified (D20).

**Decisions in force:** D1, D2, D4, D6 (partly), D10 (partly), D11, D13 (typed part), D14, D15, D16, D17–D23, D24 (documented only). D3 and D5 are deferred. D8 was replaced by D23, and D9 was largely superseded by D19.

---

## 2. Mismatches (most important first)

| # | Doc location | Doc says | Code actually | Suggested doc fix |
|---|---|---|---|---|
| 1 | DESIGN §1 diagram | The main thread has an "Issues panel (counts + explanations)", and the grid asks for "rows 1200–1250". The worker has an "Edit log (patches + undo stack)". | There is no issues panel (D21). The main thread has a Dashboard (`src/features/dashboard/Dashboard.tsx:31`), a FilterInfo popover (`src/features/table/FilterInfo.tsx:8`), a MergeDialog, a SelectionBar, an ExportButton and a router (`src/app/router.ts`). Rows are fetched in pages of 200 (`src/features/table/useViewRows.ts:4`). History is two ChangeSet stacks plus an `originals` map (`src/worker/data.worker.ts:156-158`). Export (`data.worker.ts:703`) and the shared `src/domain/*` modules (also imported on the main thread, e.g. `TableView.tsx:5`, `DataGrid.tsx:4`) aren't in the diagram. | Redraw the diagram with the real modules: Router · Dashboard · TableView (DataGrid, FilterInfo, SelectionBar, MergeDialog, Footer) · FixReviewDialog · Export on the main thread; `domain/` (config, validate, search, hints) shared by both threads; worker = store + issue index + view + history + export. Label the grid arrow "pages of 200 rows". |
| 2 | D10 (L109-115) | Cmd/Ctrl+Z on a focused cell undoes that cell. The rule's history entry shows "15,407 cells (1 reverted)". The panel says "Changed by: Normalize countries". | Cmd/Ctrl+Z is always the global undo (`src/features/history/useHistory.ts:26-37`). Reverting a cell writes a separate entry, "Restored {col} in row N" (`data.worker.ts:565-569`), with no "(1 reverted)" count. The card shows only "{Column} was X · ↶ Undo this cell" and doesn't say which action made the change (`src/features/table/TableView.tsx:276-295`). | Mark D10 as partly superseded by D19/D21. State that per-cell undo is a button only, and drop the shortcut and the "(1 reverted)" text. |
| 3 | D17 (L192) "Blanks always go last" | Blank cells sort last. | For the spend column, a blank cell sorts as **0**: `Number(suggestion ?? value)` with `''` gives 0 (`data.worker.ts:386`), because a missing spend has no suggestion. Only `NaN` goes last (`:390`). Text columns do put blanks last (`:401`). | Either fix the code (treat `trim()===''` as NaN) or say "blanks go last, except empty spend sorts as 0". |
| 4 | D8 heading (L64) | "— Accepted (per-field merge: Deferred)" | Replaced by D23. The "D8 update" (L241-247) describes group cards and "Keep only this one", and neither is in the UI. The worker still exposes the unused `getDuplicateGroups` (`data.worker.ts:503`), `keepOnly` (`:613`) and `getRowIdsForIssue` (`:496`), and nothing in `src/features` calls them. | Retitle D8 to "Superseded by D23", and mark "D8 update" the same way. Optionally remove the dead worker APIs. |
| 5 | D17 (L190-191, L199) | Other problem cells get a dotted underline, there is a per-row count badge in focus mode, and there is a details panel. | Focus mode highlights only the focus column (`src/features/table/DataGrid.tsx:165`) and hides the count column (`:87`, `:14-18`). There is no panel. | Mark these lines as superseded by D18/D21, or move them under a "History" note. |
| 6 | D11 (L117-124) | The details panel explains the issue and offers fixes. Leave focus with "× clear". Default filters include "Changed". Rules can be created from a column header. | There is no panel (D21). Focus is left through "← Overview" or the filter select (`TableView.tsx:58-84`). There is no "Changed" filter (`RowFilter` = all / any-issue / issue, `data.worker.ts:68`). A header click sorts (`DataGrid.tsx:109`); there are no user rules. | Update D11 to the D21 wording, and list "Changed filter" and "rules from header" as not built. |
| 7 | D9 (L84-107) "Proposed" | A generic `Rule {column, where, transform}`. The preview shows how many issues are resolved or created. There is a history panel. | No Rule type exists. A bulk fix means "apply the per-cell suggestion for issue X" (`data.worker.ts:638-674`). The preview returns only `{total, groups, moreGroups}` (`:134-140`), with no resolved/new-issue counts. History is only the last label (`App.tsx:38-42`). The ChangeSet also has `removedRows` and `mergedInto` (`data.worker.ts:107-114`). | Set the status to "Superseded by D19 (built: suggestion-based fixes). Generic rule engine: Deferred." |
| 8 | D6 (L51-59) "Proposed" | The file-wide inference is built, and so are the "Converted from 03/04/2024 (read as day/month)" label and the readable `3 Apr 2024` layer. | The inference is built (`src/domain/validate.ts:144-152`, `data.worker.ts:278-285`), and the reading is explained in the "!" popover (`FilterInfo.tsx:52-57`). The per-cell "Converted from" label and the readable date layer **don't exist**: the grid shows raw values (`DataGrid.tsx:211`). | Set the status to "Accepted (steps 1–2). Steps 3–4: not built." |
| 9 | D2 (L14), D4 (L33), D12 (L126), D13 (L132): "Proposed" | Still open. | All four are built: worker view (`data.worker.ts:408-433`), TanStack grid (`DataGrid.tsx:72`), Prev/Next (`TableFooter.tsx:24-37`), and field search (`src/domain/search.ts`). | Mark them Accepted. D2: "UI asks for pages of 200 rows; ~50 rows in the DOM (overscan 15)". D12: the footer reads "7 of 67,366", not "Row 3 of 21,034". D13: the debounce is the URL's 250 ms (`TableView.tsx:47`), not 150 ms in the worker. |
| 10 | D19 (L228) "Not built" | The duplicate merge/fix screens (D8) aren't built. | They are built through D23 (`MergeDialog.tsx`, `DataGrid.tsx:252-287`). | Remove that item from the list. |
| 11 | D19 (L214, L226), D18 (L205-208) | "the panel says what's wrong"; "panel shows was → now"; "Panel in focus/browse mode…". | There is no panel. The edit card is at `TableView.tsx:244-272` and the changed-cell card at `:276-295`; it shows only "was". | Mark the D18 panel bullets superseded by D21, and fix the D19 wording. |
| 12 | D15 (L164) | A "▾ toggle reveals the explanation". | Cards have no toggle: they are a plain click target with the column, count and title (`src/features/dashboard/IssueCard.tsx:12-32`). D17 L199 drops the chevron but D15 doesn't say so. | Strike the line in D15 and point to D17. |
| 13 | D23 (L281) | "The default never swaps in another person's data." | If the kept row's value is broken and has no fix, the default **takes another row's valid value** (`src/features/table/MergeDialog.tsx:59`). Unique columns (ID and email) always come from the kept row (`:44-46`). | Add: "…except a broken value without a fix, which defaults to another row's valid value. ID and email always come from the kept row." |
| 14 | D22 (L264) | "The value is checked live with the import rules before Set for N". | It checks against the **first selected row only** (`src/features/table/SelectionBar.tsx:26-36`). Setting one value on N rows of a unique column (email) passes the check and then creates duplicates. | Document the limitation, or check every selected row. |
| 15 | D8 (L67), D8 update (L242), D23 (L270, L276) | 2,917 groups / 5,879 rows, then 2,902 groups, then 5,848 rows. | Only values that pass every other check take part in duplicate detection (`data.worker.ts:310-313`), which probably explains the drop. | Explain the difference once ("raw: 2,917 groups; after excluding invalid emails: 2,902"), or keep only the current numbers. |
| 16 | DESIGN §2 tech stack | Chakra gives "toasts". Papa Parse's "byte cursor (enables resume)". Grid is "headless and tiny". | No toasts are used anywhere. `meta.cursor` only feeds progress (`data.worker.ts:264-265`); resume is deferred. Chakra is v3 (`package.json:13`). The main bundle is 709 kB because of Chakra. | Say "Chakra UI v3 (dialogs, popovers, file drop-zone)". Write "byte cursor (used for progress; resume deferred, D3)". Mention the bundle size in the performance section. |
| 17 | D16 (L181) | "A ~70-line router". | 86 lines (`src/app/router.ts`). Also not documented: `/` redirects to `/dashboard` (`src/App.tsx:15`), and an unknown slug falls back to the dashboard (`router.ts:32`). | Write "~85 lines", and add the two fallbacks. |
| 18 | D17 (L188) | "Only about 30 rows are ever in the DOM". | Overscan is 15 above and below (`DataGrid.tsx:76`), so about 45–55 rows are in the DOM. | Say "~50". |
| 19 | D20 (L236) | "contract in the design doc". | DESIGN.md has no API contract. | Add one (see §3) or drop the reference. |
| 20 | D14 (L157), D7 (L61-62) | Counts verified "over 200k rows in node". Verification will be reported in the AI note. | The repo has no test script or node harness (`package.json:6-11`), and DESIGN has no AI note. | Add a small `scripts/verify.mjs` (or describe how it was done) and record the D7 comparison result. |
| 21 | "Pending UI validation" (L142-143) | Issue order still to validate. | Settled: fixable issues first, then by count (`Dashboard.tsx:34-51`, `data.worker.ts:363`), and it matches D15. | Close it, or fold it into D15. |
| 22 | D5 (L43) "Deferred (proposed)" | Mixed status. | Nothing is built. | Use one status: "Deferred". Move "jev" into the trade-offs / future work. |

**Built but not documented anywhere**
- Header-check error: "This file is missing these columns: …" when the CSV header lacks a column (`data.worker.ts:233-237`). There is also an error state followed by the file picker again (`App.tsx:71-79`).
- Drag-and-drop file zone (Chakra `FileUpload`, `src/features/load/FilePicker.tsx:9-29`).
- How load progress is split: reading 0–90 %, then cross-row checks 90–100 %, with a row estimate and updates throttled to 100 ms (`data.worker.ts:215-222`, `src/features/load/LoadingState.tsx:10-17`).
- "Load another file" resets the worker and the history (`App.tsx:52-62`).
- "✓ All fixed" in the toolbar when a focus issue reaches 0 (`TableView.tsx:91`).
- In a duplicate view, an explicit sort turns grouping off (`data.worker.ts:429-430`).
- Removed and merged rows are left out of the export (`data.worker.ts:705`), but the export confirm dialog doesn't mention this (`src/features/export/ExportButton.tsx:43-57`).
- Per-cell issue storage is a `Uint8Array` of catalog indexes (`src/domain/config.ts:91-98`, `data.worker.ts:145`). This is a key memory choice for the performance section.

**Code comments that still describe the removed panel or cards** (small, but a reviewer will notice): `IssueCard.tsx:11` ("details panel"), `src/features/table/grid.css:20` ("the details panel says what it was"), `data.worker.ts:502` ("duplicate group cards").

---

## 3. Missing for the submission

| Deliverable | Status | What to add |
|---|---|---|
| README | **Missing** (there's no README at the repo root). `import-data.csv` is gitignored (`.gitignore:3`), so a reviewer has to generate it. | Prerequisites, `npm i`, `node generate-data.mjs` (or `npm run generate`), which writes `import-data.csv` with 200k rows and seed 42, then `npm run dev`, then pick the file. Mention `--report`, the answer key used only for D7. Link to the docs. |
| ADR (decision, alternatives, why) | Missing (DESIGN L64 placeholder). | Pick **D2 (the worker owns the data, the UI pages a `Uint32Array` view)**. Alternatives: React state, SQLite-WASM/OPFS (from D3), main-thread `requestIdleCallback`. Add the measured outcome (0.9 s load, 134 ms apply-all, 0 long tasks). |
| UX decisions (complexity, validation, guidance) | Missing. Spread over D10–D23. | Half a page: Dashboard → Focus vs Browse; fixable vs needs-decision; review-then-apply with untick; in-cell cards instead of hover or a panel; plain-language texts from rules.json; duplicates handled in the table. Note that the dashboard cards show only titles, so explanations sit one click away (the "!" popover), and say why. |
| Performance approach | Missing. Only measurements in DECISIONS. | What lives where: worker = parse (1 MB chunks), columnar `string[]`, `Uint8Array` issue codes, index, view, sort, export; main = ~50 DOM rows, pages of 200. Include the measured numbers, the bundle size, and the known costs (sort by email 1.7 s; `checkValue` on unique columns is an O(n) scan per keystroke, `data.worker.ts:631`). |
| Assumptions | Missing. | Single file, fixed 8-column header; emails compared trimmed and ignoring case; the file uses one date order; ISO-2 country codes; spend ≥ 0 with a dot decimal; same-email rows are probably different people; desktop browser. |
| AI note | Missing (D7 promised the comparison). | What AI generated, what was changed (e.g. the D6 country rule was rejected based on the data, the D18 panel was reverted, D23 replaced the cards), and how it was verified (node count check, answer-key comparison, browser long-task observer). |
| Trade-offs / more time | Missing. Pieces sit in D3, D5, D9, D13, D24. | Simplified: no persistence/resume, no generic rule engine, no history list, no chips search, no readable dates, no "Changed" filter. With more time: edit-log persistence, "Remember this" mappings, the jev/LLM suggester, tests, code-splitting Chakra. |
| Import summary screen (documented only) | **Missing everywhere.** | A short spec: totals imported / fixed automatically / fixed by hand / merged or removed / still with problems (exported as-is), plus the file name, and links back to the open issues. It sits between "Download" and done. |
| API contract | Missing. D20 references it, and DESIGN §3 gives only `GET /importers/:id/schema`. | `GET /importers/:id/schema` → `{columns: ColumnConfig[]}` (same as rules.json). `POST /importers/:id/imports` with rows or CSV plus `{fileName, changes summary}` → `{importId, accepted, rejected[{row, code}]}`. Optional `GET/PUT /customers/:id/mappings`. |

**Length risk:** DESIGN.md already uses about 1 page on the diagram, the tech stack table and §3 (production rules). Adding seven sections at the same density would reach 3–4 pages, against a limit of 1–2.

---

## 4. Suggested restructure

1. **DESIGN.md (≤2 pages), in this order:** Overview + corrected diagram (½ p) → ADR (D2) → UX (bullets) → Performance (a table: what / where / why / measured) → Assumptions → AI note → Trade-offs & next steps → Import summary (5 lines) → API contract (3 endpoints).
2. **Move out of DESIGN:** the tech-stack table, reduced to one line ("Vite 6 · React 19 · Chakra v3 · TanStack Virtual · Papa Parse · Comlink; see D1/D4"); and §3 production rules, reduced to 3 sentences that link to D24, with the owner table moving to D24.
3. **DECISIONS.md hygiene:** set one status per entry (Accepted / Superseded by Dx / Deferred / Partly built), and use that same status in the heading. Mark D8, the D8 update, D9, D15 (chevron), the D17 and D18 panel parts, and D10 (shortcut) as superseded. Change D2, D4, D12 and D13 to Accepted, and number the "Performance check" and "Pending UI validation" entries or fold them in. Add a 10-line index at the top: "What's in force".
4. **Add `README.md`** (run + generator), and optionally a `npm run verify` script so the "verified in node" and D7 claims can be reproduced.
5. **Small code follow-ups that make the docs true:** blank-spend sort (`data.worker.ts:386`), the selection-bar uniqueness check (`SelectionBar.tsx:32`), removing the dead `getDuplicateGroups`/`keepOnly`/`getRowIdsForIssue`, and the stale comments.
