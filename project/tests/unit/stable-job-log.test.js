/* global document */
const test = require('node:test')
const assert = require('node:assert/strict')
const { chromium } = require('../../../.config/codeceptjs/node_modules/playwright')
const { stableJobLog } = require('../e2e/support/helpers/stableJobLog')

// MegaLinter's reporters run concurrently with its summary. Moving only
// their order still leaves the whole summary jumping by two rows in GitLab.
test('@stable-job-log reporter timing changes neither the capture nor its evidence', async (t) => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const reporters = [
    '[Gitlab Comment Reporter] No merge request has been found, so no comment has been posted',
    '[Updated Sources Reporter] No source file has been formatted or fixed'
  ]
  for (const verdict of ['✅ Successfully linted all files without errors', '❌ Error(s) have been found during linting']) {
    const output = ['Scanner findings', '+----SUMMARY---+', 'Linter verdict and counts', 'Flavor suggestions', verdict, 'Job finished']
    const expected = [...output.slice(0, 4), ...reporters, ...output.slice(4)]
    for (const positions of [[1, 1], [1, 4], [4, 1], [4, 4]]) {
      const rows = output.flatMap((line, index) => [
        ...reporters.filter((_, reporter) => positions[reporter] === index).reverse(), line
      ])
      await page.evaluate((rows) => {
        document.body.replaceChildren(...rows.map((text, index) => {
          const row = document.createElement('div')
          row.className = 'js-log-line job-log-line'
          row.dataset.original = index
          row.textContent = text
          return row
        }))
      }, rows)
      await page.evaluate(stableJobLog)
      const actual = await page.locator('.js-log-line.job-log-line').allTextContents()
      assert.deepEqual(actual, expected, `Reporter positions ${positions}: ${verdict}`)
      assert.deepEqual([...actual].sort(), [...rows].sort(), 'Every original message must remain unchanged')
      assert.equal(await page.locator('[data-original]').count(), rows.length, 'Keep every native log row')
      await page.evaluate(stableJobLog)
      assert.deepEqual(await page.locator('.js-log-line.job-log-line').allTextContents(), actual, 'A second pass must leave the log unchanged')
    }
  }
})
