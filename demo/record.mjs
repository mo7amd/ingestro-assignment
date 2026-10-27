/**
 * Records a narrated demo of the app: `npm run demo` → demo/output/ingestro-demo.webm
 *
 * Starts its own Vite dev server, opens demo/stage.html (app on the left, narration card
 * on the right) and walks through the flows from the user's point of view. Brisk on purpose:
 * pause the video while you talk.
 *
 * Needs import-data.csv in the repo root (`npm run generate`).
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = join(ROOT, 'import-data.csv')
const OUT = join(ROOT, 'demo', 'output')
const SIZE = { width: 1920, height: 1080 }
const PORT = 5199

// Brisk pacing (ms).
const BEAT = 700
const READ = 1800
const LONG = 2800

if (!existsSync(CSV)) {
  console.error('import-data.csv not found. Run `npm run generate` first.')
  process.exit(1)
}

// ---------- the story ----------
// Every chapter starts from what the user wants, then what the app does, then (small) how.

const STEPS = [
  {
    kicker: 'The situation',
    title: '“I have to import 200,000 customers, and the file is a mess.”',
    bullets: ['Too big to read, full of problems', 'No idea what “ISO 3166” means', 'Needs to be right before it goes in'],
  },
  {
    kicker: '1 · Load',
    title: '“I drop the file in.”',
    bullets: ['Read and checked in about a second', 'The page never freezes', 'The file on disk is never changed'],
    how: '<b>Under the hood:</b> parsing and every check run in a Web Worker; the page only gets a summary.',
  },
  {
    kicker: '2 · Overview',
    title: '“Where do I stand?”',
    bullets: [
      'One bar: <b>good</b> · <b>we can fix it</b> · <b>needs you</b>',
      'Problems as cards, biggest first',
      'Fixable ones first: early, big wins',
    ],
    how: '<b>Why:</b> one bulk fix clears most of the problems, so it leads.',
  },
  {
    kicker: '3 · Understand',
    title: '“What’s wrong with the countries?”',
    bullets: ['Open a card: only that problem is highlighted', 'The <b>!</b> explains it in plain words', 'Each cell shows the fix it would make'],
    how: '<b>Why:</b> no wall of red; one problem at a time.',
  },
  {
    kicker: '4 · Fix one',
    title: '“This one is easy, just fix it.”',
    bullets: ['Click the suggestion in the cell', 'A blue dot marks what you changed', 'Changed your mind? Undo just that cell'],
  },
  {
    kicker: '5 · Correct by hand',
    title: '“30 February? That date doesn’t exist.”',
    bullets: ['Double-click to edit in place', 'Checked as you type, in plain words', 'Enter saves, Esc cancels'],
    how: '<b>Same rules</b> as the import check, run live in the worker.',
  },
  {
    kicker: '6 · Fix in bulk',
    title: '“Fix all the country spellings, but let me check first.”',
    bullets: ['Every change grouped by value, with counts', 'Untick anything you’re unsure about', 'One click applies; one undo reverts it all'],
  },
  {
    kicker: '7 · Find & decide',
    title: '“These unknown plans are typos of enterprise.”',
    bullets: [
      'Search one column: <b>plan:enterprize</b>',
      'Sort, select with click and Shift+↓',
      'Set one value for all selected rows',
    ],
    how: '<b>Shareable:</b> filter, search and sort live in the URL.',
  },
  {
    kicker: '8 · Duplicates',
    title: '“Two customers share one email.”',
    bullets: ['Rows of a group sit together', '<b>Fix</b>: give the other person their own email', '<b>Merge…</b>: same person, pick the values to keep'],
    how: '<b>Safe:</b> merged rows stay visible, struck through; undo brings them back.',
  },
  {
    kicker: '9 · Finish',
    title: '“Fix everything that’s safe, then give me the file.”',
    bullets: ['Review & apply all automatic fixes', 'The bar shows what’s left', 'Download a fixed copy of the file'],
  },
  {
    kicker: 'Recap',
    title: 'Find it, understand it, fix it, with confidence.',
    bullets: [
      'Fast: 200k rows, worker + virtual grid',
      'Clear: one problem at a time, plain words',
      'Safe: preview, undo, nothing silent',
      'Rules are configuration, not code',
    ],
  },
]

// ---------- helpers ----------

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const BASE = `http://localhost:${PORT}`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, acceptDownloads: true })
const page = await context.newPage()
await page.goto(`${BASE}/demo/stage.html`)
const app = page.frameLocator('#app')

const wait = (ms) => page.waitForTimeout(ms)
let stepIndex = -1
async function step() {
  stepIndex++
  await page.evaluate((s) => window.setStep(s), { ...STEPS[stepIndex], index: stepIndex, total: STEPS.length })
  await wait(READ)
}

/** Move the visible cursor (and the real mouse) to an element's centre. */
async function pointAt(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element not visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.evaluate(([cx, cy]) => window.cursorTo(cx, cy), [x, y])
  await page.mouse.move(x, y, { steps: 12 })
  await wait(450)
}

async function click(locator, options = {}) {
  await pointAt(locator)
  await page.evaluate(() => window.cursorClick())
  await locator.click(options)
  await wait(BEAT)
}

async function type(locator, text) {
  await locator.pressSequentially(text, { delay: 45 })
  await wait(BEAT)
}

const button = (name, exact = false) => app.getByRole('button', { name, exact })
const rows = () => app.locator('.grid-row.body')
const filterSelect = () => app.locator('select').first()

// ---------- the run ----------

try {
  await page.evaluate((src) => (document.getElementById('app').src = src), `${BASE}/dashboard`)
  await app.getByText('Drop your customer file here').waitFor()

  await step() // situation
  await wait(LONG)

  await step() // load
  await pointAt(app.getByText('Drop your customer file here'))
  await app.locator('input[type=file]').setInputFiles(CSV)
  await app.getByText('customers checked').waitFor()
  await wait(BEAT)

  await step() // overview
  await pointAt(app.getByText('We can fix these for you'))
  await wait(BEAT)
  await pointAt(app.getByText('Needs your decision').first())
  await wait(BEAT)

  await step() // understand
  await click(app.getByText('Country not a 2-letter code').first())
  await rows().first().locator('.fix').waitFor()
  await click(button('What does this filter mean?'))
  await wait(LONG)
  await page.keyboard.press('Escape')
  await wait(BEAT)

  await step() // fix one
  const firstFix = rows().first().locator('.fix')
  await click(firstFix)
  await click(rows().first().locator('.cell.changed'))
  await wait(READ)
  await click(button('↶ Undo this cell'))
  await wait(BEAT)

  await step() // correct by hand
  await filterSelect().selectOption({ value: 'DATE_NOT_REAL' })
  await rows().first().locator('.cell.issue').waitFor()
  const dateCell = rows().first().locator('.cell.issue')
  await pointAt(dateCell)
  await dateCell.dblclick()
  const editor = app.locator('.cell.editing input')
  await editor.press('ControlOrMeta+a')
  await type(editor, '2025-02-31')
  await wait(READ)
  await editor.press('ControlOrMeta+a')
  await type(editor, '2025-02-28')
  await wait(BEAT)
  await editor.press('Enter')
  await wait(READ)

  await step() // bulk
  await filterSelect().selectOption({ value: 'COUNTRY_FORMAT' })
  await click(button(/Review & fix all/))
  const dialog = app.getByRole('dialog')
  await dialog.getByRole('button', { name: /^Apply .* changes$/ }).waitFor()
  await wait(READ)
  const polska = dialog.locator('label', { hasText: 'Polska' })
  if ((await polska.count()) === 0) await click(dialog.getByRole('button', { name: /^Show all/ }))
  await click(polska.locator('input'))
  await wait(BEAT)
  await click(dialog.getByRole('button', { name: /^Apply .* changes$/ }))
  await wait(READ)
  await click(button('↶ Undo', true))
  await wait(BEAT)
  await click(button('↷ Redo', true))
  await wait(BEAT)

  await step() // find & decide
  await filterSelect().selectOption({ value: 'PLAN_UNKNOWN' })
  const search = app.getByPlaceholder(/^Search/)
  await click(search)
  await type(search, 'plan:enterprize')
  await wait(READ)
  await click(app.locator('.head .cell', { hasText: 'Monthly spend' }))
  await wait(BEAT)
  await click(rows().first().locator('.cell').nth(1))
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+ArrowDown')
    await wait(180)
  }
  await wait(BEAT)
  const newValue = app.getByPlaceholder('new value')
  await click(newValue)
  await type(newValue, 'enterprise')
  await click(button(/^Set for/))
  await wait(READ)

  await step() // duplicates
  await click(button('← Overview'))
  await click(app.getByText('Email shared by several customers').first())
  await rows().first().waitFor()
  await wait(READ)
  const first = rows().first()
  await pointAt(first.locator('.cell.issue'))
  await click(first.getByRole('button', { name: 'Fix', exact: true }))
  const emailEditor = app.locator('.cell.editing input')
  await emailEditor.press('ControlOrMeta+a')
  await type(emailEditor, 'mateo.obrien@mail.test')
  await wait(BEAT)
  await emailEditor.press('Enter')
  await wait(READ)
  const karim = rows().filter({ hasText: 'C-0075639' })
  await pointAt(karim.locator('.cell.issue'))
  await click(karim.getByRole('button', { name: 'Merge…' }))
  const merge = app.getByRole('dialog').filter({ hasText: 'Merge into one customer' })
  await merge.getByText('Result').waitFor()
  await wait(LONG)
  await click(merge.getByRole('button', { name: /^Merge \d+ rows into one$/ }))
  await wait(READ)

  await step() // finish
  await click(button('← Overview'))
  await click(button(/Review & apply all/))
  await app.getByRole('dialog').getByRole('button', { name: /^Apply .* changes$/ }).waitFor()
  await wait(READ)
  await click(app.getByRole('dialog').getByRole('button', { name: /^Apply .* changes$/ }))
  await wait(READ)
  await click(button('Download fixed file'))
  await wait(READ)
  const download = page.waitForEvent('download')
  await click(button('Download anyway'))
  await download
  await wait(READ)

  await step() // recap
  await wait(LONG)
} catch (e) {
  await page.screenshot({ path: join(OUT, 'failure.png') })
  console.error(e)
  await browser.close()
  await server.close()
  process.exit(1)
}

// ---------- save ----------

await context.close() // flushes the video
await browser.close()
await server.close()

const video = readdirSync(OUT).find((f) => f.endsWith('.webm'))
const target = join(OUT, 'ingestro-demo.webm')
renameSync(join(OUT, video), target)
console.log(`Saved ${target}`)
