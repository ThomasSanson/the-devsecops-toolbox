/**
 * Every toolbox storyboard is a Markdown page (issue #363). GitLab refused
 * to show the heaviest SVG boards and shrank the others into one picture
 * whose notes and commands nobody could read, search or copy. A Markdown page
 * is shown as a document, with the screenshots as WebP images beside it.
 *
 * The page must still tell the whole story: each sentence of its scenario,
 * each `# Note:` and each `# Copy:` command, as text. This test reads the
 * .feature files on their own, so a sentence the engine drops cannot pass
 * unnoticed. It runs on the host, outside the e2e suite, so an update run
 * can still rebuild the pages it checks:
 *
 *   node --test project/tests/integration/storyboard-markdown.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const E2E = path.join(__dirname, '..', 'e2e')

const filesUnder = (dir, extension) =>
  fs.readdirSync(path.join(E2E, dir), { recursive: true }).filter(file => file.endsWith(extension)).sort()

// Each scenario of a feature: its last tag (the board's name) and the texts
// its board must show, sentences, notes and commands.
function scenarios (file) {
  const found = []
  let tags = []
  let current = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n').map(text => text.trim())) {
    if (line.startsWith('@')) {
      tags = line.split(/\s+/)
    } else if (line.startsWith('Scenario:')) {
      current = { tag: tags[tags.length - 1].slice(1), texts: [] }
      found.push(current)
    } else if (current) {
      const comment = line.match(/^#\s*(?:Note|Copy):\s?(.*)$/)
      const sentence = line.match(/^(?:Given|When|Then|And|But)\s+(.*)$/)
      if (comment || sentence) current.texts.push((comment || sentence)[1])
    }
  }
  return found
}

// Markdown escapes the characters it would read as markup; read them back.
const plain = (markdown) => markdown
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\\([\\`*_{}[\]|~=#+\-.)!])/g, '$1')

test('@storyboard-markdown-pages every storyboard is a Markdown page that tells its whole scenario', () => {
  assert.deepEqual(filesUnder('storyboards', '.svg'), [], 'an SVG board is left')
  const stories = fs.readdirSync(path.join(E2E, 'screenshots', 'base'))
    .flatMap(act => fs.readdirSync(path.join(E2E, 'screenshots', 'base', act)).map(story => path.join(act, story)))
  const checked = []
  for (const feature of filesUnder('features', '.feature')) {
    const act = path.dirname(feature)
    for (const scenario of scenarios(path.join(E2E, 'features', feature))) {
      const story = path.join(act, scenario.tag)
      if (!stories.includes(story)) continue
      const board = path.join('storyboards', `${story}.md`)
      assert.ok(fs.existsSync(path.join(E2E, board)), `${board} is missing`)
      const markdown = fs.readFileSync(path.join(E2E, board), 'utf8')
      for (const text of scenario.texts) {
        assert.ok(markdown.includes(text) || plain(markdown).includes(text), `${board} does not show: ${text}`)
      }
      checked.push(story)
    }
  }
  assert.deepEqual(checked.sort(), stories.sort(), 'every captured story has its Markdown page')
})
