/**
 * Records a narrated demo of the app: `npm run demo` → demo/output/ingestro-demo.mp4
 *
 * Starts its own Vite dev server and drives the app full screen from the user's point of view.
 * A small chapter tag marks each step (your cue to pause and talk; see demo/TRANSCRIPT.md).
 *
 * Quality: Playwright's built-in recorder uses a low, fixed bitrate. Instead, frames come
 * straight from Chrome (DevTools screencast) at 2× pixel density and are encoded with ffmpeg:
 * H.264 .mp4 when a full ffmpeg is installed, otherwise VP9 .webm with Playwright's ffmpeg.
 *
 * Needs import-data.csv in the repo root (`npm run generate`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = join(ROOT, 'import-data.csv')
const OUT = join(ROOT, 'demo', 'output')
const FRAMES = join(OUT, 'frames')
const VIEWPORT = { width: 1600, height: 900 } // rendered at 2× → 3200×1800, encoded at 2560×1440
const OUTPUT = { width: 2560, height: 1440 }
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
// One tag per step: where we are, and what the user wants. The talking is in TRANSCRIPT.md.

const STEPS = [
  {
    kicker: 'The situation',
    title: '“I have to import 200,000 customers, and the file is a mess.”',
  },
  {
    kicker: '1 · Load',
    title: '“I drop the file in.”',
  },
  {
    kicker: '2 · Overview',
    title: '“Where do I stand?”',
  },
  {
    kicker: '3 · Understand',
    title: '“What’s wrong with the countries?”',
  },
  {
    kicker: '4 · Fix one',
    title: '“This one is easy, just fix it.”',
  },
  {
    kicker: '5 · Correct by hand',
    title: '“30 February? That date doesn’t exist.”',
  },
  {
    kicker: '6 · Fix in bulk',
    title: '“Fix all the country spellings, but let me check first.”',
  },
  {
    kicker: '7 · Find & decide',
    title: '“These unknown plans are typos of enterprise.”',
  },
  {
    kicker: '8 · Duplicates',
    title: '“Two customers share one email.”',
  },
  {
    kicker: '9 · Finish',
    title: '“Fix everything that’s safe, then give me the file.”',
  },
  {
    kicker: 'Recap',
    title: 'Find it, understand it, fix it, with confidence.',
  },
]

// ---------- helpers ----------

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const BASE = `http://localhost:${PORT}`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, acceptDownloads: true })
const page = await context.newPage()
const app = page

// Demo overlay in every page: a visible cursor and the chapter tag. Never takes pointer events.
await context.addInitScript(() => {
  const ACCENT = '236,135,67'
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent = `
      #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
        background: rgba(${ACCENT},.2); border: 2.5px solid rgb(${ACCENT}); pointer-events: none; z-index: 2147483647;
        transition: transform .45s cubic-bezier(.3,.7,.4,1); }
      #demo-cursor.click { animation: demo-click .35s ease-out; }
      @keyframes demo-click { 0% { box-shadow: 0 0 0 0 rgba(${ACCENT},.6) } 100% { box-shadow: 0 0 0 22px rgba(${ACCENT},0) } }
      #demo-tag { position: fixed; top: 14px; left: 50%; transform: translate(-50%, -8px); opacity: 0; pointer-events: none; z-index: 2147483646;
        display: flex; align-items: baseline; gap: 12px; padding: 10px 18px; border-radius: 8px; max-width: 70vw;
        background: #3a3935; border: 1px solid #59564c; box-shadow: 0 8px 24px rgba(0,0,0,.45);
        font: 500 16px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; color: #ede1bb;
        transition: opacity .2s ease, transform .2s ease; }
      #demo-tag.on { opacity: 1; transform: translate(-50%, 0); }
      #demo-tag b { color: #f3c8a4; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }`
    document.head.append(style)
    const cursor = Object.assign(document.createElement('div'), { id: 'demo-cursor' })
    cursor.style.transform = 'translate(-100px, -100px)'
    const tag = Object.assign(document.createElement('div'), { id: 'demo-tag' })
    document.body.append(cursor, tag)
    let hide
    window.__demo = {
      move: (x, y) => (cursor.style.transform = `translate(${x}px, ${y}px)`),
      click: () => {
        cursor.classList.remove('click')
        void cursor.offsetWidth
        cursor.classList.add('click')
      },
      tag: (kicker, title, ms) => {
        clearTimeout(hide)
        tag.innerHTML = `<b>${kicker}</b><span>${title}</span>`
        tag.classList.add('on')
        hide = setTimeout(() => tag.classList.remove('on'), ms)
      },
    }
  })
})

// ---------- capture: frames from Chrome at 2× ----------

const cdp = await context.newCDPSession(page)
const frames = [] // { file, t } with t in seconds
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  frames.push({ file, t: metadata.timestamp })
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
async function startCapture() {
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 3200, maxHeight: 1800, everyNthFrame: 1 })
}
async function stopCapture() {
  await cdp.send('Page.stopScreencast').catch(() => {})
}

const wait = (ms) => page.waitForTimeout(ms)
let stepIndex = -1
/** Next chapter: show its tag, give it a moment. */
async function step(hold = READ + 600) {
  stepIndex++
  const { kicker, title } = STEPS[stepIndex]
  await page.evaluate(([k, t, ms]) => window.__demo.tag(k, t, ms), [kicker, title, hold])
  await wait(READ)
}

/** Glide the visible cursor (and the real mouse, for hover) to an element's centre. */
async function pointAt(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element not visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.evaluate(([cx, cy]) => window.__demo.move(cx, cy), [x, y])
  await page.mouse.move(x, y, { steps: 10 })
  await wait(420)
}

async function click(locator) {
  await pointAt(locator)
  await page.evaluate(() => window.__demo.click())
  await locator.click()
  await wait(BEAT)
}

async function dblclick(locator) {
  await pointAt(locator)
  await locator.dblclick()
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
  await page.goto(`${BASE}/dashboard`)
  await app.getByText('Drop your customer file here').waitFor()
  await startCapture()

  await step(LONG) // situation

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
  await dblclick(dateCell)
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
  await app.locator('.grid').focus()
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
  await click(first.locator('.cell.issue .value'))
  await click(first.getByRole('button', { name: 'Fix', exact: true }))
  const emailEditor = app.locator('.cell.editing input')
  await emailEditor.press('ControlOrMeta+a')
  await type(emailEditor, 'mateo.obrien@mail.test')
  await wait(BEAT)
  await emailEditor.press('Enter')
  await wait(READ)
  const karim = rows().filter({ hasText: 'C-0075639' })
  await click(karim.locator('.cell.issue .value'))
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

  await step(LONG) // recap
  await wait(LONG)
} catch (e) {
  await page.screenshot({ path: join(OUT, 'failure.png') })
  await stopCapture()
  console.error(e)
  await browser.close()
  await server.close()
  process.exit(1)
}

// ---------- save: encode the frames ----------

await stopCapture()
await context.close()
await browser.close()
await server.close()

/** A full ffmpeg with H.264 if installed, else Playwright's bundled one (VP9 only). */
function findFfmpeg() {
  const candidates = ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  for (const bin of candidates) {
    try {
      if (execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libx264')) return { bin, h264: true }
    } catch {
      /* not this one */
    }
  }
  const dir = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const bundled = readdirSync(dir).filter((d) => d.startsWith('ffmpeg')).map((d) => join(dir, d))
  const bin = bundled.flatMap((d) => readdirSync(d).filter((f) => f.startsWith('ffmpeg')).map((f) => join(d, f)))[0]
  return { bin, h264: false }
}

// Screencast frames arrive only when something changes: give each one its real on-screen time.
const list = frames
  .map((f, i) => `file '${f.file}'\nduration ${(((frames[i + 1]?.t ?? f.t + 1) - f.t) || 0.001).toFixed(4)}`)
  .join('\n')
writeFileSync(join(OUT, 'frames.txt'), `${list}\nfile '${frames[frames.length - 1].file}'\n`)

const { bin, h264 } = findFfmpeg()
const target = join(OUT, h264 ? 'ingestro-demo.mp4' : 'ingestro-demo.webm')
const filters = `fps=30,scale=${OUTPUT.width}:${OUTPUT.height}:flags=lanczos,format=yuv420p`
const codec = h264
  ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart']
  : ['-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', '-row-mt', '1']
execFileSync(bin, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(OUT, 'frames.txt'), '-vf', filters, ...codec, target], {
  stdio: 'inherit',
})
rmSync(FRAMES, { recursive: true, force: true })
rmSync(join(OUT, 'frames.txt'), { force: true })
console.log(`Saved ${target} (${frames.length} frames${h264 ? '' : '; install ffmpeg for .mp4'})`)
