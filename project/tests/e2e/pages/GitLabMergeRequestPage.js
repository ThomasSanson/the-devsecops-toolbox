/* global inject */
const { I } = inject()
const { assertPageVisualMatch } = require('../support/helpers/pageVisual')

/**
 * GitLab merge-request pages — visual regression of the init-framework-devsecops
 * MR opened by `task devsecops:init` (the Overview header and the Changes/diff).
 * Dynamic content (relative times, dates, avatars, the activity feed, the
 * breadcrumb's per-run random project name) is neutralised for tolerance:0.
 */
async function maskMergeRequestPage (projectName) {
  await I.executeScript((args) => {
    const projectName = args.projectName
    const DATE_RE = [
      /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/,
      /^\d{4}-\d{2}-\d{2}$/,
      /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
      /\bjust now\b/i
    ]
    const PLACEHOLDER = '—'

    document.querySelectorAll('time, .js-timeago').forEach(el => { el.textContent = PLACEHOLDER })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
    document.querySelectorAll('.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"]').forEach(el => {
      el.style.visibility = 'hidden'
    })

    // Activity / notes feed (system notes, timing, SHAs) — hide it.
    ;['#notes', '.notes', '[data-testid="notes-container"]', '.issuable-discussion'].forEach(sel => {
      const node = document.querySelector(sel)
      if (node) node.style.display = 'none'
    })

    // Top app bar: carries the GLOBAL user counters (MRs/todos), polluted by
    // other parallel scenarios, plus the session state (anonymous vs lambda).
    ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
      const node = document.querySelector(sel)
      if (node) node.style.display = 'none'
    })

    // MR tab bar: GitLab renders the tab counters (Changes N, Commits N)
    // asynchronously, so masking the numbers races; the counts also embed the
    // template's file count, which legitimately evolves. Hide the whole bar —
    // the Overview header above it carries the meaningful content.
    ;['.merge-request-tabs-container', '[data-testid="merge-request-tabs"]', '.merge-request-tabs-holder'].forEach(sel => {
      const node = document.querySelector(sel)
      if (node) node.style.display = 'none'
    })

    // Breadcrumb carries the per-run RANDOM project name + the MR iid.
    ;['[data-testid="breadcrumb-links"]', 'nav[aria-label="Breadcrumb"]', '.gl-breadcrumbs', '.breadcrumbs'].forEach(sel => {
      const node = document.querySelector(sel)
      if (node) node.style.display = 'none'
    })

    const NAME_RE = projectName
      ? new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : /e2e-journey-[0-9a-f]+/
    document.querySelectorAll('a, span, strong, li, b').forEach(el => {
      if (el.children.length === 0 && NAME_RE.test(el.textContent.trim())) {
        el.textContent = 'project'
      }
    })

    document.querySelectorAll('span, div, td, p, dd, dt').forEach(el => {
      if (el.children.length === 0 && DATE_RE.some(re => re.test(el.textContent.trim()))) {
        el.textContent = PLACEHOLDER
      }
    })

    // Best-effort mask of numeric pill badges (defensive). NOTE: GitLab renders
    // the MR tab counters (Changes N, etc.) asynchronously, so they may not be
    // caught here — the Overview baseline therefore still embeds the file count
    // (187) and must be regenerated if the template's file count changes.
    document.querySelectorAll('.gl-badge, .gl-tab-counter-badge, [class*="badge"]').forEach(el => {
      if (el.children.length === 0 && /^\d+$/.test(el.textContent.trim())) {
        el.textContent = PLACEHOLDER
      }
    })
  }, { projectName })
}

class GitLabMergeRequestPage {
  // Navigate to the MR overview and neutralise its volatile content, WITHOUT
  // asserting — the storyboard steps grab a masked frame of the page and assert
  // it against their own per-scenario baseline; verifyMergeRequestVisual adds
  // the assert on top for the flat (non-storyboard) callers.
  async gotoAndMask (projectPath, iid, projectName) {
    await I.amOnPage(`/${projectPath}/-/merge_requests/${iid}`)
    await I.waitForElement('body', 30)
    await I.wait(3)
    await maskMergeRequestPage(projectName)
    await I.moveCursorTo('body', 1, 1)
    await I.wait(1)
  }

  async verifyMergeRequestVisual (projectPath, iid, screenshotName, projectName) {
    await this.gotoAndMask(projectPath, iid, projectName)
    await assertPageVisualMatch(I, screenshotName)
  }

  // Same masked MR page, but tag its HEADER block (status "Open" + "requested
  // to merge <source> into <target>") with a stable id so the storyboard can
  // crop the frame to that content instead of the mostly-white MR sheet. Falls
  // through the known GitLab header containers and re-shows the region in case
  // the mask hid it; the storyboard's assertFrameNotEmpty catches a miss.
  async gotoAndMaskCropHeader (projectPath, iid, projectName) {
    await this.gotoAndMask(projectPath, iid, projectName)
    await I.executeScript(() => {
      const candidates = [
        '.detail-page-header',
        '[data-testid="merge-request-sticky-header"]',
        '.merge-request-details',
        '.detail-page-description',
        '.issuable-details'
      ]
      let el = null
      for (const sel of candidates) { el = document.querySelector(sel); if (el) break }
      if (!el) {
        const h1 = document.querySelector('h1')
        el = h1 ? h1.parentElement : null
      }
      if (el) {
        el.style.display = ''
        el.style.visibility = 'visible'
        el.id = 'storyboard-mr-crop'
      }
    })
  }
}

module.exports = GitLabMergeRequestPage
