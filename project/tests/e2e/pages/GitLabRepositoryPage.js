/* global inject NodeFilter */
const { I } = inject()
const { assertPageVisualMatch } = require('../support/helpers/pageVisual')

/**
 * GitLab repository views along the init journey — visual regression of the
 * blank project, the bootstrapped main (README), and the branches list.
 *
 * Dynamic content (the per-run random project name e2e-journey-<hex>, short
 * commit SHAs, relative times/dates, avatars) is neutralised so baselines are
 * reproducible at tolerance:0.
 */
class GitLabRepositoryPage {
  async _captureMasked (projectName, screenshotName) {
    await this.maskVolatile(projectName)
    await assertPageVisualMatch(I, screenshotName)
  }

  // Neutralise the dynamic content only (no assert) — reused by the agent-mode
  // storyboard, which grabs a masked PNG of the page as one panel of a larger
  // stitched image instead of asserting the page on its own.
  async maskVolatile (projectName) {
    await I.waitForElement('body', 30)
    await I.wait(2)
    await I.executeScript((args) => {
      const projectName = args.projectName
      const PLACEHOLDER = '—'
      const DATE_RE = [
        /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/,
        /^\d{4}-\d{2}-\d{2}$/,
        /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
        /\bjust now\b/i
      ]
      const SHA_RE = /^[0-9a-f]{7,40}$/i
      const NAME_RE = projectName
        ? new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : /e2e-journey-[0-9a-f]+/

      // Top app bar: carries the GLOBAL user counters (MRs/todos) and the
      // session state (anonymous vs lambda) — both vary across scenarios.
      ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
        const node = document.querySelector(sel)
        if (node) node.style.display = 'none'
      })

      // Project-stats bar (N Commits / Branches / Tags / KiB Project Storage):
      // the commit count updates ASYNCHRONOUSLY after a push/merge (races the
      // capture) and the storage size drifts with every template change — the
      // numbers live in <strong> children, so hide the whole container.
      ;['.project-stats', '[data-testid="project-stats"]'].forEach(sel => {
        const node = document.querySelector(sel)
        if (node) node.style.display = 'none'
      })

      // Pipeline status icon next to the last commit: right after a merge the
      // commit's pipeline is still running, so the icon repaints (running →
      // passed) during the capture window.
      document.querySelectorAll('[data-testid="ci-icon"], .ci-status-link, [class*="ci-status"]').forEach(el => {
        el.style.visibility = 'hidden'
      })

      // Repository language bar: segment widths derive from per-language byte
      // counts, so ANY content change shifts a segment boundary by a pixel
      // (caught at tolerance:0 between the local working tree and the CI
      // checkout).
      document.querySelectorAll('[class*="repository-language"], [data-testid="repository-language-bar"]').forEach(el => {
        el.style.display = 'none'
      })

      document.querySelectorAll('time, .js-timeago').forEach(el => { el.textContent = PLACEHOLDER })
      document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
      // Letter-avatars are CSS-coloured divs whose background is derived from the
      // project id (varies per run) — hide them (visibility keeps the layout).
      document.querySelectorAll('.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"]').forEach(el => {
        el.style.visibility = 'hidden'
      })

      document.querySelectorAll('a, span, strong, li, b, td, div, code').forEach(el => {
        if (el.children.length !== 0) return
        const text = el.textContent.trim()
        if (SHA_RE.test(text)) { el.textContent = PLACEHOLDER; return }
        if (DATE_RE.some(re => re.test(text))) { el.textContent = PLACEHOLDER }
      })

      // Replace the random project name in ALL text nodes (e.g. the project
      // title H1, which has an icon child and is not a leaf element).
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const textNodes = []
      while (walker.nextNode()) textNodes.push(walker.currentNode)
      textNodes.forEach(n => {
        if (NAME_RE.test(n.nodeValue)) {
          n.nodeValue = n.nodeValue.replace(new RegExp(NAME_RE.source, 'g'), 'project')
        }
      })
    }, { projectName })
    await I.moveCursorTo('body', 1, 1)
    await I.wait(0.5)
  }

  async verifyEmptyProjectVisual (projectPath, projectName, screenshotName) {
    await I.amOnPage(`/${projectPath}`)
    await this._captureMasked(projectName, screenshotName)
  }

  async verifyProjectHomeVisual (projectPath, projectName, screenshotName) {
    await I.amOnPage(`/${projectPath}`)
    await this._captureMasked(projectName, screenshotName)
  }

  async verifyBranchesVisual (projectPath, projectName, screenshotName) {
    await I.amOnPage(`/${projectPath}/-/branches`)
    await this._captureMasked(projectName, screenshotName)
  }
}

module.exports = GitLabRepositoryPage
