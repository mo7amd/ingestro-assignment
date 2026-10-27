# Ingestro: review & fix a messy import

A frontend-only prototype (React + TypeScript) that helps **non-technical users** find and fix problems in a customer file that is far too large to read: 200,000 rows that are messy, inconsistent and partly invalid. It explains each problem in plain language, fixes values one by one or in bulk with a preview, supports undo/redo, and stays responsive throughout.

- Design document: [docs/DESIGN.md](docs/DESIGN.md)
- Decision log (every decision and the discussion behind it): [docs/DECISIONS.md](docs/DECISIONS.md)

## Quick start

Requires Node 18+ (developed on Node 24).

```bash
npm install
npm run generate   # writes import-data.csv (200,000 rows)
npm run dev        # http://localhost:5173
```

Open the app and drop `import-data.csv` onto the page, or use **Choose a file**.

### The data generator

`generate-data.mjs` is the script from the assignment, unchanged. `npm run generate` runs `node generate-data.mjs` and writes `import-data.csv` with 200,000 rows. The script is deterministic (seed 42), so everybody gets the same file. The CSV is gitignored, so generate it locally.

The generator is treated as a **black box**: the rules in the assignment are the specification. Its `--report` option writes an answer key (`issues-report.json`), which was **not** used to build the validation. It is only meant for checking the counts afterwards.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run generate` | Create `import-data.csv` |
| `npm run demo` | Record a narrated walkthrough video to `demo/output/ingestro-demo.webm` using Playwright. Needs `import-data.csv`; starts its own server. |

## What you can do

- **See where you stand.** The overview shows one bar for the whole file (*look good* / *we can fix automatically* / *needs your decision*) and one card per kind of problem, biggest first.
- **Focus on one problem.** Click a card: the table shows only the affected rows and highlights only that column. The (!) icon next to the filter explains the problem and what a good value looks like.
- **Fix one value.** Click the suggestion in a cell (`Polska → PL`). Or double-click a cell to edit it: the value is checked as you type, in plain words.
- **Fix in bulk, after a preview.** **Review & fix all** lists every change grouped by value, with counts. Untick anything you want to leave alone, then apply. On the overview, **Review & apply all fixes** does this for every fixable problem at once.
- **Undo anything.** Use Undo/Redo in the header, or ⌘/Ctrl+Z and ⇧⌘/Ctrl+Z. A bulk fix is one undo step. A changed cell has a blue dot; select it to see the old value and **Undo this cell**.
- **Find and decide.** Search across all columns, or search one column with `country:deutsch`, `plan:enterprize`, `email:empty` or `spend:"€"`. Click a column header to sort. The filter, search and sort are in the URL, so a view can be bookmarked or shared.
- **Select rows.** Click, ⌘/Ctrl+click, ↑/↓ and ⇧↑/↓. With 2 or more rows selected, a bar offers **Apply suggested fixes** or **Set [column] to [value]**.
- **Resolve duplicates.** Rows that share an email sit together. On each row: **Fix** gives it its own email, or **Merge…** combines the rows into one customer. You choose the row to keep and the value for each field where the rows differ, and the result is checked.
- **Get the result out.** **Download fixed file** saves a corrected copy (`import-data.fixed.csv`). Your original file is never changed. If problems remain, you're told how many first.

> Everything stays in the browser's memory. Reloading the page starts over (see D3 in the decision log).

## How it's built (short)

- A **Web Worker** owns the data. It parses the CSV in chunks (Papa Parse), stores it column by column, runs every check, and answers queries: filter, search, sort, rows for a window, fixes, undo. The page never holds all rows; it asks for the ~50 on screen.
- The table is a **virtual grid** (`@tanstack/react-virtual`) with plain CSS cells. Chakra UI is used for the page shell.
- **Validation is configuration.** `src/config/rules.json` declares the columns, the checks per column, and the plain-language text for every issue. A small generic engine (`src/domain/validate.ts`) interprets it.
- Measured on the 200k-row file: load and check in about 0.9 s with no main-thread blocking; apply all automatic fixes (~88k cells) in about 0.15 s; sort all rows in about 1.7 s, inside the worker.

Details, trade-offs and alternatives are in the [design document](docs/DESIGN.md).

## Project structure

```
src/
  config/rules.json        validation rules + plain-language issue texts (data, not code)
  domain/                  pure logic, shared by page and worker
    config.ts              typed view of rules.json
    validate.ts            generic check engine (required, pattern, oneOf, date, number, unique…)
    search.ts              field-aware search (country:deutsch)
    hints.ts               "this email belongs to this person" heuristic
  worker/
    data.worker.ts         the data store: load, validate, views, edits, undo/redo, export
    client.ts              typed access to the worker (Comlink)
  app/router.ts            tiny URL router: /dashboard, /dashboard/<issue>?q=&sort=&dir=
  features/
    load/                  file picker + loading state
    dashboard/             health bar + issue cards
    table/                 grid, toolbar help, selection bar, footer, merge dialog
    fixes/                 review-and-apply dialog for bulk fixes
    history/               undo/redo
    export/                download the fixed file
demo/                      Playwright script + stage page for the narrated demo
docs/                      design document and decision log
generate-data.mjs          data generator from the assignment (unchanged)
```

## AI usage

This project was built with an AI coding assistant (Claude). The decision log records the back-and-forth: what was proposed, what was changed or rejected, and how it was verified. The AI note in the [design document](docs/DESIGN.md#7-ai-note) says what AI did, what was changed and how it was verified.
