# Decision Log

A running log of what we discussed and decided while building. The final design doc picks one entry from here as its ADR.

Status values: **Proposed** (open), **Accepted**, **Rejected**, **Deferred** (documented only, not built).

---

## D1. Parse the CSV in a Web Worker — Accepted
- **Context:** 200k rows. Parsing them on the main thread freezes the UI.
- **Decision:** A Web Worker streams the file in chunks with Papa Parse and posts progress back to the UI.
- **Alternatives:** Parse on the main thread with `requestIdleCallback` slicing (slower, more complex), or use a backend (out of scope).

## D2. The worker owns the data; the UI asks for the visible window — Accepted (the ADR in DESIGN.md)
- **Decision:** The worker holds the rows in columnar arrays, runs validation, and builds the issue index. It also runs search, sort and filter, and returns a `Uint32Array` view of row ids. The UI only requests the ~50 rows on screen.
- **Why:** The main thread never touches 200k objects, and structured-clone cost stays small.
- **Alternative:** Keep everything in React state. That's simpler, but every sort, filter or bulk fix would block scrolling.

## D3. Resumable loading + persistence: IndexedDB with a byte-offset checkpoint — Deferred
- **Context:** The user asked for loading that can resume after an interruption.
- **Decision:**
  - After each parsed chunk, write the rows plus a checkpoint `{fileName, size, lastModified, byteOffset, rowCount}` to IndexedDB.
  - On reload, show "Resume import of import-data.csv (62%)". The user re-selects the file, we match its fingerprint, and parsing continues with `file.slice(byteOffset)`. Papa's `meta.cursor` always lands on a row boundary.
  - If the load already finished, the dataset reopens straight from IndexedDB without parsing again.
  - Edits and the undo log are persisted the same way, so no work is lost.
- **Constraint:** After a reload the browser can't reopen a file without the user picking it again. Chromium could store a `FileSystemFileHandle` instead, but it's skipped to stay cross-browser.
- **Alternatives:**
  - *SQLite WASM on OPFS:* gives real SQL for sort, filter and search, but adds about 1MB of WASM, OPFS worker setup and a second query layer. 200k rows fit in memory, so SQL isn't needed.
  - *Memory only:* simplest, but can't resume.
- **Scope note:** This goes beyond the must-haves. Build it last, or cut it back to just "persist edits".
- **Status:** Parked by the user ("circle back later, focus on the main user journey"). Everything currently lives in worker memory only: a reload loses the edits, and the CSV on disk is never modified. `idb` is installed but unused. Lighter option still open: persist only the edit log + file fingerprint, and replay it after the user re-picks the file.

## D4. Grid: TanStack Virtual + Chakra UI — Accepted
- **Context:** The user wants minimal frameworks but not hand-written CSS for everything. Chakra UI has no virtualized table.
- **Decision:**
  - The grid is a custom grid on `@tanstack/react-virtual`: headless, about 10KB, and we fully control cell rendering for issue badges and inline editors.
  - Chakra UI handles the shell: issues panel, dialogs, bulk-fix preview and toasts. *(As built: dialogs, popovers and the toolbar; no side panel (D21) and no toasts.)*
- **Alternatives:**
  - *AG Grid Community:* full-featured but heavy, and harder to fit our issue-first UX.
  - *Glide Data Grid:* canvas, very fast, has built-in editing, but custom tooltips and explanations are harder.
  - *react-window:* similar to TanStack Virtual but less actively maintained.

## D5. Local-LLM bulk action — Deferred (proposed)
- **Context:** The user wants a bulk action backed by a local LLM, "jev". The user says its output is deterministic and known, and that it's faster than large LLMs. *Open: link/spec for jev.*
- **Grounding:** None of the must-haves need it, and every listed rule (country, plan, date, spend) can be fixed deterministically. The brief prefers simple, well-reasoned solutions.
- **Proposal:**
  1. Ship the deterministic bulk fix first.
  2. If time allows, add an `LLMSuggester` interface for the long tail of values our mappings can't resolve. It runs on **unique values**, not rows (e.g. ~50 odd country strings, not 200k rows), and its output goes through the same preview → apply → undo path.
  3. Otherwise, document it as future work.

## D6. Ambiguous dates: infer the order from the file — Accepted (the "converted from" label and the readable-date layer were not built)
- **User idea:** Use each row's country to pick the order, MM/DD for US and DD/MM elsewhere, like a dependent validation.
- **What the data shows:** 7,990 dates use slashes. In 4,545 of them the first part is greater than 12, and in none is the second part greater than 12. So the file is consistently **DD/MM/YYYY**, US rows included: 609 US rows are provably day-first. A country rule would have converted 440 US dates wrongly.
- **Decision:**
  1. Infer the order **from the whole column**. If any value proves an order and none contradicts it, apply that order to the ambiguous ones.
  2. The country is only a fallback, used if the evidence conflicts.
  3. Converted values get the label "Converted from 03/04/2024 (read as day/month)". They count as an auto-fix, not as silent truth.
  4. **Readable layer:** The grid and the editor show dates as `3 Apr 2024` next to the ISO value, so the user can spot a wrong month at a glance.
- **Why:** Use evidence over heuristics; the country rule looked plausible but was wrong for this file.

## D7. Verify with the generator's answer key — Done (results in DESIGN.md §7)
- `node generate-data.mjs --report` also writes `issues-report.json`, which holds the generator's counts of injected issues. We don't read it while building. At the end we compare our issue counts against it and report the result in the AI note.

## D8. Duplicates are resolved per group — Superseded by D23
- **User direction:** Group the duplicate rows first. Then, per group, the user either **merges** them into one row or **fixes** the rows so they stop colliding.
- **What the data shows:**
  - There are 2,917 email groups covering 5,879 rows: 2,872 pairs and 45 triples. No group is fully identical.
  - In the samples, these are *different people sharing one email*. The email matches one row's name: `yuki.lindqvist…` belongs to Yuki Lindqvist, not to Mateo O'Brien.
  - There are no customer_id duplicates, but the rule is still enforced.
- **Decision:**
  - **Duplicate groups view:** one card per group with its rows side by side and the differing fields highlighted.
  - **Hint:** "This email looks like it belongs to Yuki Lindqvist (name matches)." We suggest **Fix** for the other rows.
  - **Merge = build one row, column by column:**
    - The group card turns into a grid with one column per source row (A, B, C) and one line per field.
    - The user clicks a cell to take that field from that row. For example: email from A, country from B, everything else from A.
    - Fields where all rows agree are prefilled and collapsed ("6 fields are the same").
    - Only the conflicting fields need a choice. Each starts on the row with the *valid* value, or on row A if several are valid. Invalid values are marked, so nobody keeps a broken one by accident.
    - `customer_id` is a field like any other; the user picks which ID survives.
    - A live "Result" line shows the merged row, already validated.
    - On **Merge**, the merged row replaces the first row and the other rows are removed. This is one ChangeSet (D9) with a row-level change type `{kind:'merge', keptRow, removedRows, before}`, so undo restores all original rows exactly.
  - **Fix:** edit the email inline in the group card. The group dissolves live once it's unique.
- **Assumption:** Emails are compared trimmed and case-insensitive.

## D9. One generic bulk-fix engine — Partly built (preview → apply → undo/redo per issue and per selection; user-defined rules not built)
- **User direction:** Bulk fixes should work on any column. The user defines a rule, sees a preview, then applies it. Redo must be supported.
- **Rule model:** plain data, so the built-in suggestions and user rules share one engine.
  ```ts
  type Rule = {
    column: Column
    where: 'all-invalid' | { equals: string[] } | { contains: string }   // which rows
    transform:
      | { kind: 'map'; from: string; to: string }[]                      // value replacement
      | { kind: 'trim' | 'lowercase' | 'uppercase' }
      | { kind: 'date-to-iso' } | { kind: 'clean-number' }               // column-aware helpers
  }
  ```
- **Suggested rules are prefilled:** e.g. "Countries: 21 spellings → ISO codes", "Plan: lowercase", "Spend: remove currency symbol, use dot decimal". The user can tweak a suggestion or start a blank rule from any column header or issue.
- **No free-form regex or formulas.** The target users are non-technical; picking a value and its replacement covers their needs.
- **Preview:** the worker runs the rule as a dry run and returns:
  - affected count
  - a before → after table grouped by distinct value (e.g. `Polska → PL · 2,598 rows`), with a sample of rows to scroll
  - how many issues it resolves, and whether it creates any new ones
- **History:** every action (cell edit, bulk rule, merge) becomes one `ChangeSet {label, changes: [{row, col, before, after}]}`.
  - The undo and redo stacks hold ChangeSets.
  - A new action clears redo.
  - A history panel lists actions in plain words ("Normalized 21 country spellings · 15,407 cells").
- **Grounding:** The brief asks for one explained bulk fix. A generic engine costs little more *if* it stays this small data shape. We ship the country-name suggestion first and add the others only as prefilled rules.

## D10. Changed cells: a marker plus undo on the cell, no hover — Accepted (as built: "Undo this cell" in the cell card adds a "Restored …" entry; ⌘Z is always the global undo)
- **User direction:** No hover popovers, because they add clutter. Support undo directly on the cell.
- **Decision:**
  - A changed cell shows only a subtle marker (a small corner dot).
  - When the user **selects** the cell (click or keyboard), the details panel shows "Changed by: Normalize countries · was `Deutschland`" with **Undo this cell**. Inline, `Ctrl/Cmd+Z` while the cell is focused does the same.
  - Undoing a single cell **adds** a new ChangeSet ("Reverted 1 cell") instead of cutting into the middle of the global history. History stays linear, and global redo keeps working.
  - Undoing a cell that came from a bulk fix only touches that cell. The history entry for the rule shows "15,407 cells (1 reverted)".

## D11. Two ways to work: Focus on an issue, or Browse all — Accepted
- **Overview (default):** the issues panel always shows the live summary, like a dashboard. Counts go down as fixes land.
- **Focus mode (pick an issue):** the whole UI centers on that issue.
  - The grid filters to the affected rows and highlights only that column.
  - The details panel explains the issue and offers fixes. Bulk-fix rules start **scoped to that issue** (`where: issue = X`) and are prefilled with the suggestion.
  - Leaving focus (× clear) goes back to the overview.
- **Browse all:** the normal list, with search across all columns, sorting, and the default filters ("Rows with any problem", "Changed", per-column issue). Rules can be created here too, from a column header, starting unscoped.
- One engine underneath: focus mode is just a preset filter plus a rule template.

## D12. Jump to a problem: prev/next only — Accepted (prev/next now in the footer, D21)
- The brief asks for "a way to jump to a problem". Clicking an issue jumps to its first row, and **prev / next** buttons move between affected rows ("Row 3 of 21,034").
- **Dropped (my addition, not from the brief):**
  - **J/K keys:** a power-user pattern that doesn't suit non-technical users.
  - **Auto-advance after a fix:** it would move away from the cell before the user sees it turn valid, which works against the "immediate revalidation feedback" requirement.

## D13. Field-aware search — Accepted (typed `field:value` built; guided dropdown/chips not built)
- **User direction:** Search should know about fields. The user types `field:"value"`, e.g. `country:"Deutschland"`.
- **Decision:** One search box that accepts both forms.
  - **Typed:** `country:deutsch email:"@corp.example" smith`. The field terms and the free text are ANDed. Free text searches every column.
  - **Guided (for non-technical users):** while typing, a dropdown suggests "Search *deutsch* in: Country · Any field · …". Picking a field turns the term into a removable **chip** `Country: deutsch`.
    - Typed `field:` syntax becomes the same chip, so both paths produce the same thing.
  - Field names use friendly labels and aliases: `country`, `first name`/`firstname`, `spend`, `signup`/`date`. Unknown field names fall back to free text with a hint.
  - Matching is case-insensitive "contains". Quotes allow spaces. `field:empty` finds blanks, which is useful for "missing" problems. No other operators, to keep it simple.
- **Performance:** the query is parsed to `{field?: Column, text}[]` and runs in the worker as a linear scan over the column arrays, debounced at about 150ms. A 200k scan takes milliseconds. The worker returns a `Uint32Array` view (D2), so search, filters and sorting combine as one view.

## Pending UI validation
- **Issue order** ("We can fix these for you" first, then by count): validate against the real issues list once steps 1–2 land.

## D14. Validation rules are configuration, not code — Accepted
- **User direction:** All validation and fix rules are rule-based configuration, not hard-coded. Data formats must be part of the fix too: `de`, `germany` and `Deutschland` are all "not a 2-letter code".
- **Decision:** `src/config/rules.json` is the single source of truth. It holds the columns, the ordered checks per column, and every issue's plain-language title, explanation, example and `fixable` flag.
  - A small generic engine (`src/domain/validate.ts`) interprets seven check types:
    - `required`, `trimmed`, `pattern` (regex), `unique` (exact or ignore-case)
    - `oneOf` (allowed values + aliases, matched loosely: case, dots, accents, spaces)
    - `date` (target format + accepted formats + how to settle ambiguity: `from-file`, with a fallback on another column)
    - `number` (min, symbols to strip, separator cleanup)
  - The first failing check wins, so config order sets the priority: missing > invalid > format.
  - Fixable checks return the suggested value, which the bulk-fix engine (D9) will reuse.
  - Date ambiguity is now generic: a value that only one accepted format can read counts as evidence. If exactly one format has evidence, the file uses it.
- **The line we drew:** check *types* are code; *rules* are data. Adding a country alias, a currency, a date format or a new column is a JSON edit. A new *kind* of check is code.
- **Verified:** the counts match the earlier hard-coded version exactly (verified over 200k rows in node, ~0.9s).

## D15. Overview = KPI dashboard — Accepted
- **User direction:** The first page is a clean KPI dashboard that tells you where you stand immediately. Show cards with a title and an expandable description, and make each card clickable into the table.
- **Decision:**
  - **Health bar:** one bar with three colors, at row level. A row is *good* (no issues), *auto-fixable* (all its issues have a known fix) or *manual* (at least one needs a person). On this file: **53% / 37% / 10%** (106,559 / 73,650 / 19,791).
  - **Issue cards** in a grid, with two sections: "We can fix these for you" first, then "Needs your decision". Each card shows the column, a big count and a short title.
  - The ▾ toggle reveals the explanation, the fix or good value, and the date-reading note.
  - Clicking a card opens the table focused on that issue (D11). "Browse all rows" opens it without a focus.
- **Replaced:** the long text cards and the separate "look good / need attention" counters, which mixed rows and cells.

## Performance check: load — measured
- In the real browser on the 15MB, 200k-row file, the full load (parse + validate + cross-row checks + index) takes **~0.9s**.
- The main thread never blocked during parse/validate: the long-task observer recorded 0 tasks over 50ms. After the dashboard was added there is one ~60ms task, which is the dashboard's first render.

## D16. Routes: the URL is the state — Accepted
- **User direction:** Use real routes for navigation, with filters and sort in the URL.
- **Routes:**
  - `/dashboard`: the overview
  - `/dashboard/all`: every row
  - `/dashboard/problems`: rows with any issue
  - `/dashboard/<issue-slug>` (e.g. `/dashboard/country-format`): the table focused on one issue
  - **Query string:** `?q=<search>&sort=<column>&dir=asc|desc`
- **How:**
  - A ~70-line router (`src/app/router.ts`) built on `history.pushState` and `useSyncExternalStore`. There's no router library, because we have two pages.
  - Issue slugs are derived from the config codes.
  - Filter and sort changes push a history entry, so Back works. Typing a search *replaces* the entry after a 250ms pause, so it doesn't flood the history.
- **Deep links work:** if the data isn't loaded yet, the file picker shows, and after loading the app lands on the linked view.
- **Not in the URL:** the selected row, which is momentary.

## D17. Table — Accepted (first version; its details panel is superseded by D21)
- **Rows on demand:** the worker keeps the current view, i.e. filter → search → sort, as a `Uint32Array` of row ids. The table asks for pages of 200 rows around the visible window. Only about 30 rows are ever in the DOM.
- **Grid:** `@tanstack/react-virtual` with plain CSS cells. Chakra components per cell would be too heavy while scrolling, so Chakra is used only for the toolbar and panel. Column widths are a display hint in rules.json.
- **Focus mode:** the focused column is tinted, with the fix shown inline (`Polska → PL`). Other problem cells get only a dotted underline. A count badge per row shows how many problems it has.
- **Details panel:** what the issue means, the fix or good value, Previous/Next with "Row 3 of 67,366", and the selected row's problems with before → after.
- **Sort:** click a header to cycle asc → desc → off. Spend sorts as cleaned numbers. Blanks always go last.
- **Search:** field-aware (D13) and parsed in the worker. Field names come from the config (`key`, `label`, `searchAs`). Unknown field names fall back to plain text, with a hint.
  - Not built yet: the guided field dropdown and chips.
- **Measured in the browser:**
  - opening an issue or search view: instant
  - sorting all 200k rows by email: ~1.7s in the worker, 0 long tasks on the main thread
  - jumping to the end of 200k rows: rows render immediately
- **Dropped from cards:** the expand chevron. Cards are plain click targets, and the explanation lives in the table's details panel.

## D18. Highlighting and the details panel follow the mode — Accepted (highlighting); panel superseded by D21
- **Grid:**
  - **Focus mode:** only the issue in hand is highlighted (tinted, with the fix inline). Other problems aren't shown at all: no cell marks, and no per-row count badge (the column is removed).
  - **All rows / Problems:** every issue cell is highlighted.
- **Panel in focus mode:**
  - The focused issue comes first and gets the actions (**Apply fix**, **Edit**). Its title isn't repeated, since the header above already explains it.
  - Other problems in the row are **not shown** (user decision; this replaces the earlier "N more problems · Open →" list). They get their turn in their own focus view or in "All rows".
- **Panel in browse mode:** all of the row's problems, at equal weight, each with its actions.
- Leading and trailing spaces show as `·` in previews and the panel, so `" pro" → "pro"` doesn't look like a no-op.

## D19. Fixing: cell edits, review-then-apply, undo/redo — Accepted (panel parts superseded by D21; duplicate screens built in D23)
- **Inline edit:**
  - Double-click a cell, or press **Edit** in the panel.
  - Every keystroke is checked in the worker with the same rules as the import, including duplicates. The cell border turns green or orange, and the panel says what's wrong in plain words, offering *Use "DE"* when a fix is known.
  - Enter saves, Esc cancels, and blur saves.
- **Bulk fix:** a review dialog lists every change grouped by value (`Polska → PL · 2,598 rows`), largest first.
  - The open question is settled: **the user can untick single values** or, in the all-fixes dialog, whole issues.
  - Apply is one ChangeSet, so one undo reverts it.
  - **From the table:** "Review & fix all N" for the focused issue.
  - **From the overview:** "Review & apply all N fixes" covers every fixable issue, each with its own checkbox.
- **The view stays stable after changes:** fixed rows stay where they are and lose their highlight, while counts update everywhere. Rows are re-read in place, and old rows stay visible until the fresh ones arrive, so nothing flickers.
- **History:**
  - Undo/Redo in the header, plus Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (ignored while typing). The last action shows in plain words.
  - A new action clears redo.
  - **Undo this cell** (D10) adds a "Restored …" entry instead of cutting into history.
  - A blue corner dot marks changed cells, and the panel shows was → now.
- **Measured:** applying all automatic fixes (87,810 cells) took ~134ms, including re-checks, duplicate re-checks and recounts.
- **Not built:** a history list panel (only the last action is shown), a "Changed" filter, and the duplicate-group merge/fix screens (D8).

## D20. Output: download the fixed file — Accepted
- **Input:** the user's CSV, read once into the worker. **The file on disk is never modified.** A page can't write back to a user's file without per-file permission (the File System Access API, Chromium only).
- **Output:** "Download fixed file" in the header. The worker writes every row, with all changes applied, in the same columns and order, using `Papa.unparse`. The browser saves it as `<name>.fixed.csv`.
  - If problems remain, a confirm step says how many, and how many of those could still be fixed automatically.
  - Unfixed values are exported as they are; nothing is dropped silently.
  - Measured: 200k rows, 15.7MB, ~0.5s.
- **In production:** the output would be an import call to a backend (contract in the design doc), not a download.
- **Navigation:**
  - Edits live in the worker, so moving between issues, Overview and Back/Forward never loses them. A reload does (D3 deferred).
  - An edit in progress is tracked by row id, not by position in the list. Leaving the view mid-edit (e.g. browser Back) saves it to the right row, the same as clicking away.

### D8 update: what was built
- **Duplicates view:** a focus on a `unique` issue (e.g. `/dashboard/email-duplicate`) shows group cards instead of the grid, one per shared value. The cards are virtualized, so 2,902 groups are fine. Rows sit side by side, and fields that differ are tinted.
- **Owner hint:** the email's local part contains a row's first and last name (accents stripped or dropped, so `garca` matches García). If exactly one row matches, the card says "Looks like it belongs to Karim García", and the **email fix is pre-opened on the other rows**.
- **Actions per row:**
  - **Fix email**, checked live ("✓ Unique now"). The group dissolves on save.
  - **Keep only this one** removes the other rows. Removal is a flag in the worker, so removed rows leave views, counts, duplicate checks and the export, and undo brings them back.
- **Per-field merge picker:** documented only. In this file the groups are different people sharing an email, so merge would be rare.

## D21. No side panel: toolbar, cell cards, footer — Accepted
- **User direction:** The panel cost a third of the width for little value. Explanations should be global but not clutter the table, and navigation should go in a footer.
- **Toolbar:** filter selector · **!** · "Review & fix all N" (when fixable) · search.
  - The **!** opens a popover **on click** explaining the current filter: its meaning, the fix or good value, the date-reading note, and how to act. Hover tooltips are still avoided (D10).
- **In the cell:**
  - The `→ DE` suggestion is a button: one click applies it.
  - While editing, a small card under the cell shows the live check and *Use "DE"*.
  - A selected changed cell shows "Country was Italy · ↶ Undo this cell".
  - These cards exist only while that cell is in use. On the last columns they open leftwards so the grid edge doesn't cut them off.
- **Footer:** "Rows 1–14 of 67,366" on the left; "◀ Previous · 7 of 67,366 · Next ▶" on the right. The table keeps virtual scrolling (the performance story); the footer adds position and stepping, not page-by-page loading.

## D22. Selecting rows: mouse + keyboard — Accepted
- Click selects one row. **Cmd/Ctrl+click** toggles rows. **↑/↓** moves, **Shift+↑/↓** extends from the anchor row, **Enter** edits the active cell, **Esc** clears.
- The selection holds row ids, so it survives re-reads after edits. It resets when the view changes.
- **With 2+ rows selected**, a floating bar appears: "N selected · Apply suggested fixes · or set [column] to [value] · Clear".
  - The value is checked live with the import rules before "Set for N" is enabled.
  - Useful for "needs your decision" issues, e.g. setting 12 unknown plans to `enterprise`. Each is one undoable action.

## D23. Duplicates live in the normal table: Fix or Merge on the row — Accepted (replaces the D8 group cards)
- **User direction:** The side-by-side cards don't scale to 4–5 duplicates. Use the normal table with actions on the row itself.
- **Grouped rows:** in a duplicate focus view, with no explicit sort, the worker orders rows so each group's rows are adjacent (groups in file order of their first row). It also records each row's group number.
  - The grid draws a divider where a group starts. The footer says "Group 3 of 2,902".
  - A group of 5 is simply 5 rows.
- **On the shared-value cell:**
  - **belongs here** tag on the row whose name matches the email.
  - **Fix**: in-cell editor with the live "✓ Looks good" check. Not offered on the owner row.
  - **Merge…** opens the merge dialog for that row's group.
  - The actions show on the hovered or current row only, to keep 5,848 rows calm.
- **Select rows of one group** (click + Shift+↓) and the selection bar offers **Merge N rows…**. Rows from different groups are refused, with an explanation.
- **Merge dialog:**
  1. Which row stays (its customer ID survives). Defaults to the email's owner.
  2. Only the fields the rows disagree on, with each value as a choice, plus the fixed form of known-fixable values (`Deutschland` → `DE`).
     - The default is the kept row's value with its fix applied, so the default never swaps in another person's data.
  3. A result line checked with the import rules (ignoring the rows about to be removed).
  - One undoable action: the kept row's values plus the removals.
- **After a merge:** removed rows stay in place, struck through, labelled "Merged into row 75,639". The list doesn't jump. Undo restores them.
- **Removed:** the separate group-card view (D8 update above).
- **D23 follow-ups (user feedback):**
  - The merge dialog is now a table: the group's rows plus a **Result** row, under the same column headers. Pick the row to keep with a radio; click a cell to take its value; `→ DE` picks a fixed form.
  - The "belongs here" tag was removed. The owner check still sets the default row to keep and hides "Fix" on that row.
  - The filter help is an exclamation-mark icon.

## D24. In production, rules come from the importer's schema; users teach mappings, not rules — Accepted (documented, not built)
- **Today:** `rules.json` mixes the schema, the reference data and the UX copy in one bundled file. That's fine for the prototype, where the engine already treats it all as data.
- **Production split** (see DESIGN.md §3):
  - **Schema:** per importer, from the backend, set by the integrating admin.
  - **Reference data:** a maintained library.
  - **Messages:** translation files.
- **End users never edit rules.** They can save **mappings** ("Remember this: Holland → NL") from the bulk-fix review, plus confirmations like the date order. These are stored per customer and reused on the next import.
- **Not built:** a schema editor, the "Remember this" option, and library-based country names.

## D25. Warm Charcoal theme, with one meaning per color — Accepted
- **User direction:** Adopt the Warm Charcoal palette (theme only).
- **How:** `src/theme.ts` maps the palette onto Chakra's semantic tokens by role (`bg`, `fg`, `border`, color palettes). Components are unchanged.
- **First pass felt unintuitive.** The orange accent also colored the "we can fix automatically" segment, right next to the amber "needs your decision". Two oranges read as two warnings. The `→ IT` suggestion (light orange) also blended into the amber problem tint.
- **Fix: one meaning per color**
  - **Green:** looks good.
  - **Teal:** "we'll fix it" (the health-bar segment and the suggestion chip in a cell).
  - **Amber:** a problem that needs a person (the cell tint and the health-bar segment).
  - **Orange:** actions only (primary buttons, focus, current row), never status.
  - **Red:** errors.
  - "Download fixed file" became an outlined accent button rather than green: it's an action, not a status.
- **Contrast measured** (WCAG): body text 11.3:1, secondary 5.0–5.6:1, the suggestion chip 7.5:1, dark text on orange buttons 6.9:1. The lowest is the icon grey at 4.6:1.
- The demo stage uses the same palette.
