/* global inject MutationObserver */
const { I } = inject()
const { assertPageVisualMatch } = require('../support/helpers/pageVisual')

/**
 * GitLab merge-request pages — visual regression of the MR Overview as a real
 * page: header, description and (when its state is stable) the merge widget.
 * Dynamic content (relative times, dates, avatars, pipeline/job ids, SHAs,
 * durations, the activity feed, the breadcrumb's per-run random project name)
 * is neutralised for tolerance:0.
 *
 * DOM contract (GitLab 18.11): `.issuable-discussion` is the WHOLE Overview
 * body — description, award emojis, `.mr-state-widget` AND the notes feed —
 * so only the feed (`ul.main-notes-list`) is hidden, never the container.
 * The merge widget is hidden on demand (`hideMergeWidget`): a freshly opened
 * MR renders it mid-transition (no pipeline yet / checking), while a green or
 * merged MR shows a stable state worth keeping on the card.
 */
async function maskMergeRequestPage (projectName, { hideMergeWidget = false, keepContext = false } = {}) {
  await I.executeScript((args) => {
    const projectName = args.projectName
    const DATE_RE = [
      /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/,
      /^\d{4}-\d{2}-\d{2}$/,
      /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
      /\bjust now\b/i,
      /^#\d+$/, //                          pipeline / job id badge (#123)
      /^[0-9a-f]{7,40}$/i, //               commit SHA
      /^\d{1,2}:\d{2}(:\d{2})?$/, //        duration 0:42 / 00:01:07
      /^\d+ (second|minute|hour)s?$/ //     "42 seconds"
    ]
    if (!args.keepContext) DATE_RE.push(/^!\d+$/) //  MR reference badge (!1)
    const PLACEHOLDER = '—'

    document.querySelectorAll('time, .js-timeago').forEach(el => { el.textContent = PLACEHOLDER })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
    document.querySelectorAll('.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"]').forEach(el => {
      el.style.visibility = 'hidden'
    })

    // Persistent CSS, not one-shot inline styles: the merge widget is a Vue
    // subtree that re-renders on its own polling cycle, so a node styled once
    // can be replaced (or appear) AFTER this script ran. A stylesheet holds
    // through any re-render.
    // - the activity feed carries SHAs and timestamps (its `.issuable-discussion`
    //   ancestor is the WHOLE Overview body — never hide that);
    // - spinner icons freeze at a different rotation angle on every screenshot;
    // - [data-e2e-mask] rows are marked volatile below.
    const style = document.createElement('style')
    style.textContent = [
      'ul.main-notes-list { display: none !important }',
      '.gl-spinner, [class*="spinner"] { visibility: hidden !important }',
      // display, not visibility: children carrying their own visibility:visible
      // (status icons do) would override an inherited hidden.
      '[data-e2e-mask] { display: none !important }',
      args.hideMergeWidget ? '.mr-state-widget { display: none !important }' : ''
    ].join('\n')
    document.head.appendChild(style)

    // The post-merge "Pipeline <status> for — on <branch>" row: the fresh
    // pipeline schedules DURING the capture window (created → pending →
    // running), repainting its text and mini-graph — so hide the whole row.
    // Marking runs once now AND on every DOM mutation: Vue re-renders the
    // widget with fresh nodes, so a one-shot mark can vanish (or arrive too
    // early). The length guard keeps the mark on the row itself, never on a
    // wider widget ancestor; the "Merge request pipeline" row (a finished,
    // stable state) never matches.
    const markVolatileRows = () => {
      document.querySelectorAll('div, section, li').forEach(el => {
        if (/Pipeline\s+(?:[—#]\S*\s+)?(created|pending|running|waiting)/.test(el.textContent) &&
            !/Merge request pipeline/.test(el.textContent) &&
            el.textContent.trim().length < 200) {
          el.setAttribute('data-e2e-mask', '')
          // Climb to the whole row box (its status icon repaints with the
          // pipeline state, and SVG <title> tooltips pollute textContent
          // comparisons): mark every ancestor until one also spans a stable
          // widget section — the last one marked is the full row.
          let up = el.parentElement
          while (up && up !== document.body &&
            !/Merge request pipeline|Merged by|Approval/.test(up.textContent)) {
            up.setAttribute('data-e2e-mask', '')
            up = up.parentElement
          }
        }
      })
    }
    markVolatileRows()
    new MutationObserver(markVolatileRows).observe(document.body, { childList: true, subtree: true })

    // Top app bar: carries the project breadcrumb (context the reader needs) but
    // also the GLOBAL user counters, polluted by other parallel scenarios. With
    // keepContext the bar stays and only its counters are neutralised.
    if (args.keepContext) {
      // Keep the breadcrumb, drop everything else the top bar carries: the
      // search box, the create menu and the user avatar all belong to the
      // SESSION, and their counters move whenever a parallel scenario opens a
      // merge request. Hiding by structure (every top-bar child that does not
      // contain the breadcrumb) survives GitLab moving its own test ids.
      const CRUMB = '[data-testid="breadcrumb-links"], nav[aria-label="Breadcrumb"], .gl-breadcrumbs, .breadcrumbs'
      ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
        document.querySelectorAll(sel).forEach(bar => {
          const crumb = bar.querySelector(CRUMB)
          if (!crumb) { bar.style.visibility = 'hidden'; return }
          Array.from(bar.children).forEach(child => {
            if (!child.contains(crumb)) child.style.visibility = 'hidden'
          })
        })
      })
    } else {
      ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
        const node = document.querySelector(sel)
        if (node) node.style.display = 'none'
      })
    }

    // MR tab bar and breadcrumb: hidden by default because the tab counters
    // render asynchronously (they embed the template's file count) and the
    // breadcrumb carries a per-run RANDOM project name. A story whose project
    // name and file counts are FIXED asks for keepContext: the reader then sees
    // where they are — the project path, and which tab is open.
    if (!args.keepContext) {
      ;['.merge-request-tabs-container', '[data-testid="merge-request-tabs"]', '.merge-request-tabs-holder'].forEach(sel => {
        const node = document.querySelector(sel)
        if (node) node.style.display = 'none'
      })
      ;['[data-testid="breadcrumb-links"]', 'nav[aria-label="Breadcrumb"]', '.gl-breadcrumbs', '.breadcrumbs'].forEach(sel => {
        const node = document.querySelector(sel)
        if (node) node.style.display = 'none'
      })
    }

    // A story whose project name is FIXED keeps it: the breadcrumb then names the
    // real project, like the sidebar right beside it.
    if (!args.keepContext) {
      const NAME_RE = projectName
        ? new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : /e2e-journey-[0-9a-f]+/
      document.querySelectorAll('a, span, strong, li, b').forEach(el => {
        if (el.children.length === 0 && NAME_RE.test(el.textContent.trim())) {
          el.textContent = 'project'
        }
      })
    }

    document.querySelectorAll('a, span, strong, li, b, div, td, p, dd, dt, code, small').forEach(el => {
      if (el.children.length !== 0) return
      // Issue references inside the MR DESCRIPTION ("Closes #1") are
      // deterministic here — every story recreates its project, so its first
      // issue is always #1. Pipeline/job id badges live outside it.
      if (el.closest('.description')) return
      if (DATE_RE.some(re => re.test(el.textContent.trim()))) {
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
  }, { projectName, hideMergeWidget, keepContext })
}

class GitLabMergeRequestPage {
  // Navigate to the MR overview and neutralise its volatile content, WITHOUT
  // asserting — the storyboard steps grab a masked frame of the page and assert
  // it against their own per-scenario baseline; verifyMergeRequestVisual adds
  // the assert on top for the flat (non-storyboard) callers.
  //
  // opts.hideMergeWidget (default true): a freshly opened MR renders the merge
  // widget mid-transition (no pipeline yet / checking) — hide it unless the MR
  // reached a stable state worth showing (pipeline passed, merged).
  // opts.waitText: settle text awaited BEFORE the mask, so an async widget
  // state ("passed", "Merged") is fully rendered when its volatile bits get
  // neutralised — masking a widget that finishes rendering afterwards would
  // leave unmasked ids/SHAs on the card.
  async gotoAndMask (projectPath, iid, projectName, { hideMergeWidget = true, waitText = null, keepContext = false } = {}) {
    await I.amOnPage(`/${projectPath}/-/merge_requests/${iid}`)
    await I.waitForElement('body', 30)
    if (waitText) await I.waitForText(waitText, 30)
    await I.wait(3)
    await maskMergeRequestPage(projectName, { hideMergeWidget, keepContext })
    await I.moveCursorTo('body', 1, 1)
    await I.wait(1)
  }

  async verifyMergeRequestVisual (projectPath, iid, screenshotName, projectName) {
    await this.gotoAndMask(projectPath, iid, projectName)
    await assertPageVisualMatch(I, screenshotName)
  }

  // The Changes tab — the page a reviewer opens to see WHICH files a merge
  // request touches. Waits for a known path to be rendered (the diff list is
  // built asynchronously) before neutralising the same volatile chrome as the
  // Overview.
  async gotoChangesAndMask (projectPath, iid, projectName, waitPath, { keepContext = true } = {}) {
    await I.amOnPage(`/${projectPath}/-/merge_requests/${iid}/diffs`)
    await I.waitForElement('body', 30)
    if (waitPath) await I.waitForText(waitPath, 60)
    // The file-tree panel on the left is part of what the reviewer reads. GitLab
    // collapses it for a single-file diff, so open it: every Changes card then
    // shows the same layout, and the tree itself says how many files are in play.
    await I.executeScript(() => {
      const open = document.querySelector('[data-testid="file-tree-container"], .diff-tree-list, [class*="tree-list-holder"]')
      if (open) return
      const toggle = Array.from(document.querySelectorAll('button')).find(b =>
        /file browser|file tree|hide files|show files/i.test(`${b.getAttribute('aria-label') || ''} ${b.title || ''}`)
      )
      if (toggle) toggle.click()
    })
    await I.wait(3)
    await maskMergeRequestPage(projectName, { hideMergeWidget: true, keepContext })
    await I.moveCursorTo('body', 1, 1)
    await I.wait(1)
  }

  // The MERGED MR overview, kept whole: the merge widget IS the proof (the
  // "Merged" state and the pipeline that passed), so keep it visible and wait
  // for it before masking.
  async gotoAndMaskMerged (projectPath, iid, projectName) {
    await this.gotoAndMask(projectPath, iid, projectName, { hideMergeWidget: false, waitText: 'Merged' })
  }
}

module.exports = GitLabMergeRequestPage
