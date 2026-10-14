/* global inject Then */
/**
 * Storyboard for @storyboard-wide-card (see
 * features/02-daily-work/storyboard-layout.feature): the layout contract of the
 * storyboard engine, on the real engine.
 *
 * The engine keeps ONE board per process and this scenario's own board is being
 * drawn, so the fixture board is rendered by a child node process from five
 * pictures of the sizes the suite produces, drawn by the browser. The card is
 * that board as a browser shows it; its twin reads the geometry the engine
 * wrote into the SVG.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { storyboardStep, capturePageFrame, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const LAYOUT_DIR = '/tmp/e2e-storyboard-layout'
const LAYOUT_FRAMES = [
  { name: 'terminal-short', w: 520, h: 120, label: 'A short terminal capture, 520 px wide' },
  { name: 'gitlab-page', w: 1440, h: 300, label: 'A whole GitLab page, 1440 px wide', page: true },
  { name: 'output-strip', w: 960, h: 70, label: 'A long output strip, 960 px wide' },
  { name: 'terminal-second', w: 520, h: 160, label: 'A second terminal capture, 520 px wide' },
  { name: 'tall-page', w: 1024, h: 2000, label: 'A page 2000 px tall', page: true }
]
const LAYOUT_NOTE = 'The note under a whole page is long on purpose. It must wrap at a width a reader ' +
  'can follow from the end of one line to the start of the next, never across the whole board, even ' +
  'though the picture above it is as wide as the board. Long lines of small grey text are where a ' +
  'reader loses their place, so the card keeps them short.'
const RENDER_LAYOUT = `
const [engine, dir, out, note, frames] = process.argv.slice(1)
const storyboard = require(engine)
storyboard.begin({ feature: 'Five pictures of the sizes the suite produces', scenario: 'The storyboard layout' })
for (const f of JSON.parse(frames)) {
  storyboard.panel(f.label, f.w === 1440 ? { note } : {})
  storyboard.frame(dir + '/' + f.name + '.png')
}
storyboard.render(out)
`
// The grid the engine draws: 32 px margin, two 708 px cards, a 24 px gap.
const LEFT = 32
const HALF = 708
const ROW = 2 * HALF + 24
const CENTRED = LEFT + (ROW - HALF) / 2

storyboardStep(Then, 'a storyboard gives a whole GitLab page a full row at its real size and keeps shorter captures two per row', async () => {
  fs.rmSync(LAYOUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(LAYOUT_DIR, { recursive: true })
  await I.resizeWindow(1600, 800)
  await I.usePlaywrightTo('draw the five pictures', async ({ page }) => {
    for (const f of LAYOUT_FRAMES) {
      const [bg, fg, edge] = f.page ? ['#fbfafd', '#28272d', '#7aa2f7'] : ['#1e1e1e', '#d4d4d4', '#9ece6a']
      await page.setContent('<body style="margin:0;background:#000">' +
        `<div id="f" style="box-sizing:border-box;width:${f.w}px;height:${f.h}px;padding:16px;` +
        `font:${f.h > 1100 ? 44 : 22}px monospace;background:${bg};color:${fg};border:3px solid ${edge}">${f.label}</div></body>`)
      await page.locator('#f').screenshot({ path: path.join(LAYOUT_DIR, f.name + '.png') })
    }
  })
  const svgFile = path.join(LAYOUT_DIR, 'board.svg')
  const engine = require.resolve('../../../../../.config/codeceptjs/storyboard')
  const drawn = spawnSync(process.execPath, ['-e', RENDER_LAYOUT, engine, LAYOUT_DIR, svgFile, LAYOUT_NOTE, JSON.stringify(LAYOUT_FRAMES)], { encoding: 'utf8' })
  if (drawn.status !== 0) throw new Error(`The engine could not draw the fixture board:\n${drawn.stdout}${drawn.stderr}`)
  const svg = fs.readFileSync(svgFile, 'utf8')

  // The twin: the geometry the engine wrote, card by card, in reading order.
  const cards = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="12" fill="#181a24"/g)]
    .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }))
  const images = [...svg.matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map(m => +m[3])
  const [shortTerm, gitlabPage, strip, secondTerm, tallPage] = cards
  const layout = JSON.stringify({ cards, images })
  if (cards.length !== 5) throw new Error(`Expected 5 cards, the engine drew ${cards.length}: ${layout}`)
  if (gitlabPage.w !== ROW || gitlabPage.x !== LEFT || images[1] !== 1440) {
    throw new Error(`Expected the GitLab page to fill a 1440 px row at its real size: ${layout}`)
  }
  if (!(shortTerm.y < gitlabPage.y && gitlabPage.y < strip.y)) {
    throw new Error(`Expected the GitLab page on a row of its own, between the short capture and the strip: ${layout}`)
  }
  if (shortTerm.w !== HALF || shortTerm.x !== CENTRED) {
    throw new Error(`Expected the short capture, alone on its row, centred in it: ${layout}`)
  }
  if ([strip, secondTerm].some(c => c.w !== HALF) || strip.y !== secondTerm.y || strip.x !== LEFT || secondTerm.x !== LEFT + HALF + 24) {
    throw new Error(`Expected the strip and the second capture to share a row of two 708 px cards: ${layout}`)
  }
  // Shown at 1100/2000 of its size, the tall page is narrower than a half row:
  // a full row would only add empty space around it.
  if (tallPage.w !== HALF || tallPage.x !== CENTRED || images[4] >= HALF) {
    throw new Error(`Expected the tall page, shrunk below a half row, centred in a half card: ${layout}`)
  }
  const noteLines = [...svg.matchAll(/<text x="50" y="([\d.]+)"[^>]*font-size="12.8"[^>]*>([^<]*)<\/text>/g)]
    .filter(m => +m[1] > gitlabPage.y && +m[1] < gitlabPage.y + gitlabPage.h).map(m => m[2])
  if (noteLines.length < 3 || noteLines.some(line => line.length > 120)) {
    throw new Error(`Expected the page's note to wrap at 120 characters at most: ${JSON.stringify(noteLines)}`)
  }

  // The card: the board itself, as a browser shows it.
  const [, width, height] = svg.match(/<svg [^>]*width="(\d+)" height="(\d+)"/).map(Number)
  await I.resizeWindow(width, height)
  await I.usePlaywrightTo('show the drawn board', async ({ page }) => {
    await page.setContent('<body style="margin:0"><img id="board" src="data:image/svg+xml;base64,' +
      Buffer.from(svg).toString('base64') + '"></body>')
    await page.waitForFunction(() => document.getElementById('board').complete)
  })
  await addStoryboardFrame(I, await capturePageFrame(I, 'storyboard-wide-card'))
  await I.resizeWindow(1024, 768)
})
