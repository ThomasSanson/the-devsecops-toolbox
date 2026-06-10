/* global inject NodeFilter */
const { I } = inject()
const { assertPageVisualMatch } = require('../support/helpers/pageVisual')

/**
 * GitLab project SETTINGS pages configured by `task devsecops:init` —
 * merge-request settings (fast-forward) and protected branches. These are
 * logged-in pages, so the dynamic top app bar (To-Do / Merge requests / Issues
 * counters, which reflect global user state) is hidden, along with the per-run
 * random project name, dates and avatars, for tolerance:0 reproducibility.
 */
async function maskLoggedInChrome (projectName) {
  await I.executeScript((args) => {
    const projectName = args.projectName
    const PLACEHOLDER = '—'
    const DATE_RE = [
      /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/,
      /^\d{4}-\d{2}-\d{2}$/,
      /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
      /\bjust now\b/i
    ]
    const NAME_RE = projectName
      ? new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : /e2e-journey-[0-9a-f]+/

    // Top app bar: user shortcuts carry GLOBAL counters that vary across runs.
    ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
      const n = document.querySelector(sel)
      if (n) n.style.visibility = 'hidden'
    })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
    document.querySelectorAll('.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"]').forEach(el => {
      el.style.visibility = 'hidden'
    })

    document.querySelectorAll('span, div, td, p, dd, dt, code').forEach(el => {
      if (el.children.length === 0 && DATE_RE.some(re => re.test(el.textContent.trim()))) {
        el.textContent = PLACEHOLDER
      }
    })

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    textNodes.forEach(n => {
      if (NAME_RE.test(n.nodeValue)) {
        n.nodeValue = n.nodeValue.replace(new RegExp(NAME_RE.source, 'g'), 'project')
      }
    })
  }, { projectName })
}

class GitLabSettingsPage {
  async verifyMergeSettingsVisual (projectPath, projectName, screenshotName) {
    await I.amOnPage(`/${projectPath}/-/settings/merge_requests`)
    await I.waitForElement('body', 30)
    await I.wait(2)
    await maskLoggedInChrome(projectName)
    await I.moveCursorTo('body', 1, 1)
    await I.wait(0.5)
    await assertPageVisualMatch(I, screenshotName)
  }

  async verifyProtectedBranchVisual (projectPath, projectName, screenshotName) {
    await I.amOnPage(`/${projectPath}/-/settings/repository`)
    await I.waitForElement('body', 30)
    await I.wait(2)
    // Expand + scroll to the "Protected branches" section (long settings page).
    await I.executeScript(() => {
      const headers = Array.from(document.querySelectorAll('h2, h3, h4, span'))
      const target = headers.find(el => el.textContent.trim() === 'Protected branches')
      const section = target
        ? (target.closest('section') || target.closest('div[id*="protected-branches"]'))
        : (document.querySelector('#js-protected-branches-settings') || document.querySelector('#protected-branches-settings'))
      if (section) {
        section.classList.add('expanded')
        section.scrollIntoView({ behavior: 'instant', block: 'start' })
      } else if (target) {
        target.scrollIntoView({ behavior: 'instant', block: 'start' })
      }
    })
    await I.wait(2)
    await maskLoggedInChrome(projectName)
    await I.moveCursorTo('body', 1, 1)
    await I.wait(0.5)
    await assertPageVisualMatch(I, screenshotName)
  }
}

module.exports = GitLabSettingsPage
