/* global document window NodeFilter MutationObserver */
/**
 * GitLab cards — ONE way to put a real GitLab page in a storyboard.
 *
 * A card is the WHOLE page at 1440 px (the width where GitLab unfolds its left
 * sidebar, so the reader sees where they are), as tall as the evidence needs
 * (900 by default, 1100 at most: beyond that, scroll to the evidence instead).
 * The storyboard engine gives such a frame a full 1440 px row: it reads at 100%.
 *
 *   await gitlabFrame(I, 'after-push', gitlabUrl.tree(project), {
 *     waitText: 'chore: install', projectNames: [project]
 *   })
 *
 * Everything that changes between two runs of the same story is neutralised by
 * maskGitLabPage, through ONE persistent stylesheet plus a MutationObserver, so
 * a Vue re-render after the mask cannot bring a date or a counter back.
 */
const { projectPath } = require('./gitlabApi')
const { addStoryboardFrame, baseDir, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const CARD_WIDTH = 1440
const CARD_HEIGHT = 900
const CARD_MAX_HEIGHT = 1100

// A bare project name is the lambda user's project; a path with a slash is used as is.
const isFullPath = (p) => String(p).includes('/')
const base = (p) => '/' + (isFullPath(p) ? p : projectPath(p))
// The per-run name a card must not show: the project's own path segment.
const namesOf = (project, projectNames) => projectNames || [String(project).split('/').pop()]
// The project a GitLab URL points at: the segment before "/-/", or the second
// of a bare "/namespace/project" (never one of GitLab's own top-level pages).
const GITLAB_ROUTES = ['users', 'groups', 'admin', 'dashboard', 'explore', 'help', 'search']
function projectOfUrl (url) {
  const pathname = new URL(url, 'http://gitlab').pathname // DevSkim: ignore DS137138 -- base for relative test URLs only.
  const parts = pathname.split('/-/')[0].split('/').filter(Boolean)
  if (pathname.includes('/-/')) return parts.slice(-1)
  return parts.length === 2 && !GITLAB_ROUTES.includes(parts[0]) ? [parts[1]] : []
}
const encodePath = (file) => String(file).split('/').map(encodeURIComponent).join('/')

// Pure URL formatters: every card is one gitlabFrame call on one of these.
const gitlabUrl = {
  project: (p) => base(p),
  // GitLab highlights the #L lines and scrolls to them: that is how a large page
  // frames the exact evidence inside a long file.
  file: (p, ref, file, range) =>
    `${base(p)}/-/blob/${ref}/${encodePath(file)}${range ? `#L${range[0]}-${range[1] || range[0]}` : ''}`,
  tree: (p, ref = 'main', dir = '') => `${base(p)}/-/tree/${ref}${dir ? '/' + encodePath(dir) : ''}`,
  commits: (p, ref = 'main') => `${base(p)}/-/commits/${ref}`,
  commit: (p, sha) => `${base(p)}/-/commit/${sha}`,
  compare: (p, from, to) => `${base(p)}/-/compare/${from}...${to}`,
  branches: (p) => `${base(p)}/-/branches`,
  tags: (p) => `${base(p)}/-/tags`,
  releases: (p) => `${base(p)}/-/releases`,
  // tab: '' (overview), 'diffs', 'commits' or 'pipelines'
  mr: (p, iid, tab = '') => `${base(p)}/-/merge_requests/${iid}${tab ? '/' + tab : ''}`,
  pipeline: (p, id) => `${base(p)}/-/pipelines/${id}`,
  job: (p, id) => `${base(p)}/-/jobs/${id}`,
  ciEditor: (p, ref = 'main') => `${base(p)}/-/ci/editor?branch_name=${encodeURIComponent(ref)}`,
  ciSettings: (p) => `${base(p)}/-/settings/ci_cd`,
  repoSettings: (p) => `${base(p)}/-/settings/repository`,
  mergeSettings: (p) => `${base(p)}/-/settings/merge_requests`,
  accessTokens: (p) => `${base(p)}/-/settings/access_tokens`
}

// Wait until the page stops changing (no DOM mutation for quietMs), then for its
// web fonts. GitLab fills a page in pieces (sidebar, last commit, file list), and
// a capture that lands between two pieces is a coin toss at tolerance 0.
async function settlePage (I, { quietMs = 800, timeoutMs = 15000 } = {}) {
  await I.executeScript((args) => new Promise((resolve) => {
    let timer = null
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(done, args.quietMs)
    })
    function done () {
      observer.disconnect()
      clearTimeout(timer)
      resolve(true)
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
    timer = setTimeout(done, args.quietMs)
    setTimeout(done, args.timeoutMs)
  }), { quietMs, timeoutMs })
  await I.executeScript(() => document.fonts.ready.then(() => true))
}

/**
 * The ONE GitLab mask. Hides or blanks what differs between two runs of the same
 * story and is not what the card is about:
 *   - motion: every transition AND animation (GitLab 19.3's "More features" item
 *     carries a moving gradient), spinners;
 *   - the SESSION row on top of the page (search, the counters other scenarios
 *     move, the user avatar); with keepContext (default) the breadcrumb stays,
 *     so the reader knows where they are, and without it the breadcrumb goes too;
 *   - avatars (their colour derives from a per-run id), never content images;
 *   - tooltips, popovers and "new feature" callouts, the focus ring, the pointer;
 *   - dates, relative times, SHAs, #ids, durations, the runner "#id (token)":
 *     blanked to nothing, never replaced by a sign GitLab could have printed;
 *   - the per-run project names, replaced by "project" everywhere;
 *   - the reader's own to-do and notification buttons on a merge request.
 * `hide` adds page-specific selectors (display: none), `textMasks` adds
 * [RegExp, replacement] pairs applied to every text node. Page CONTENT (a file,
 * a diff, a job log, rendered markdown, the pipeline editor) keeps its words:
 * only the per-run project names and the caller's textMasks reach inside it.
 */
async function maskGitLabPage (I, { projectNames = [], keepContext = true, textMasks = [], hide = [] } = {}) {
  await I.executeScript((args) => {
    const PLACEHOLDER = ''
    const LEAF_RE = [
      /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/, //               "Jul 20, 2026"
      /^\d{4}-\d{2}-\d{2}$/, //                           "2026-07-20"
      /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
      /\bjust now\b/i,
      /^[0-9a-f]{7,40}$/i, //                             commit SHA
      /^#\d+$/, //                                        pipeline / job id badge
      /^\d{1,2}:\d{2}(:\d{2})?$/, //                      duration 0:42 / 00:01:07
      /^\d+ (second|minute|hour)s?$/ //                   "42 seconds"
    ]
    // Durations inside composed sentences ("8 minutes 4 seconds, queued for 51
    // seconds"), and the runner the job page names: "#113 (7ulK8s5G) null".
    const SUB_RE = [
      /\d+ minutes? \d+ seconds?/g,
      /queued for \d+ (seconds?|minutes?)/g,
      /\b\d+ minutes?\b/g,
      /\b\d+ seconds?\b/g,
      /\b\d{2}:\d{2}:\d{2}\b/g,
      /#\d+ \([^)]*\)(\s+null)?/g
    ]
    const CONTENT = '.file-content, .blob-viewer, .diff-file, .diff-content, [data-testid="job-log-content"], .md, .description, pre, ' +
      '.monaco-editor, [data-testid="source-editor-container"]'
    // GitLab 19.4: the session row is header.super-topbar; the breadcrumb lives
    // in the page panel, outside any header, so the row goes away whole and
    // leaves no empty band. Other <header>s are page content (the commit list's
    // filter bar, the job's name and status).
    const SESSION = '.super-topbar, [data-testid="top-bar"]'
    const CRUMB = '[data-testid="breadcrumb-links"], nav[aria-label="Breadcrumb"], .gl-breadcrumbs'
    const READER_CHROME_RE = /to-?do|mark as done|notification|subscribe/i
    const names = args.names
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(n => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
    const masks = args.textMasks.map(m => [new RegExp(m.source, m.flags), m.to])

    if (window.__e2eMaskObserver) window.__e2eMaskObserver.disconnect()
    const old = document.getElementById('e2e-gitlab-mask')
    if (old) old.remove()
    const style = document.createElement('style')
    style.id = 'e2e-gitlab-mask'
    style.textContent = [
      '*, *::before, *::after { transition: none !important; animation: none !important }',
      '.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"] { visibility: hidden !important }',
      // A labelled avatar ("Started by Lambda User" on a job) keeps its name:
      // visibility, unlike display, can be given back to a child.
      '.gl-avatar-labeled-labels, .gl-avatar-labeled-labels * { visibility: visible !important }',
      '.gl-avatar-labeled > .gl-avatar { display: none !important }',
      // The white tile behind the sidebar's project avatar, the author's avatar
      // before the last commit (a gap otherwise), and the SHA button with its
      // copy button (an empty box once its SHA is blanked).
      '.gl-nav-item-slot:has(.gl-avatar), .js-commit-sha-group, .js-commit-sha-group * { visibility: hidden !important }',
      '.project-last-commit .user-avatar-link { display: none !important }',
      '.gl-spinner, [class*="spinner"] { visibility: hidden !important }',
      // Popovers by their own classes only: "js-user-popover" is the author's
      // name on a commit, the trigger of a popover, not one.
      '[role="tooltip"], .tooltip, .gl-tooltip, .popover, .gl-popover, .user-callout, [data-testid*="callout"] { display: none !important }',
      // display, not visibility: a child carrying its own visibility:visible
      // (status icons do) would override an inherited hidden.
      '[data-e2e-mask] { display: none !important }',
      '[data-e2e-blank] { visibility: hidden !important }',
      `${args.keepContext ? SESSION : `${SESSION}, ${CRUMB}`} { display: none !important }`,
      ...args.hide.map(sel => `${sel} { display: none !important }`)
    ].join('\n')
    document.head.appendChild(style)

    const setText = (node, value) => { if (node.nodeValue !== value) node.nodeValue = value }
    function mask () {
      document.querySelectorAll('button, a[role="button"]').forEach(el => {
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`
        if (READER_CHROME_RE.test(label)) el.setAttribute('data-e2e-mask', '')
      })
      document.querySelectorAll('time, .js-timeago').forEach(el => {
        if (el.textContent !== PLACEHOLDER) el.textContent = PLACEHOLDER
      })
      document.querySelectorAll('a, span, strong, li, b, td, div, code, small, p, dd, dt, button').forEach(el => {
        if (el.children.length !== 0 || el.closest(CONTENT)) return
        const text = el.textContent.trim()
        if (text !== PLACEHOLDER && LEAF_RE.some(re => re.test(text))) el.textContent = PLACEHOLDER
      })
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      nodes.forEach(n => {
        let v = n.nodeValue
        names.forEach(re => { v = v.replace(re, 'project') })
        masks.forEach(([re, to]) => { v = v.replace(re, to) })
        if (!(n.parentElement && n.parentElement.closest(CONTENT))) {
          SUB_RE.forEach(re => { v = v.replace(re, PLACEHOLDER) })
        }
        setText(n, v)
      })
    }
    mask()
    // Our own writes trigger the observer once more and then find nothing to
    // change, so this settles by itself.
    window.__e2eMaskObserver = new MutationObserver(mask)
    window.__e2eMaskObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
  }, {
    names: projectNames,
    keepContext,
    hide,
    textMasks: textMasks.map(([re, to]) => ({ source: re.source, flags: re.flags.includes('g') ? re.flags : re.flags + 'g', to }))
  })
  await I.usePlaywrightTo('park the pointer outside the content', async ({ page }) => {
    await page.mouse.move(1, 1)
  })
  await settlePage(I, { quietMs: 300 })
}

// GitLab 19 scrolls inside its panels, not only the window: reset them all.
async function scrollPage (I, target) {
  if (target === 'keep') return
  if (typeof target === 'function') return target()
  await I.executeScript((selector) => {
    if (selector) {
      const el = document.querySelector(selector)
      if (!el) throw new Error(`gitlabFrame: nothing to scroll to at ${selector}`)
      el.scrollIntoView({ block: 'center' })
      return
    }
    window.scrollTo(0, 0)
    document.querySelectorAll('main, .content-wrapper, .layout-page, .js-static-panel-inner, .job-log, [data-testid="job-log-content"]')
      .forEach(el => { el.scrollTop = 0 })
  }, target || null)
  await settlePage(I, { quietMs: 300 })
}

/**
 * Capture one GitLab page as a storyboard frame: 1440 x height, load, wait for
 * `waitText`, `prepare()` (open a tab, unfold a section), settle, mask, scroll
 * (top by default; `scrollTo` = a selector to centre, 'keep', or a function;
 * a URL with a #L anchor keeps GitLab's own scroll), capture, assert, and give
 * the window back at the size it had, even when a step above throws (a
 * terminal tab keeps its own height). `projectNames` defaults to the project the
 * URL points at (its path segment), so a per-run name never reaches a baseline;
 * pass the display name too when it differs from the path, or [] to keep it.
 */
async function gitlabFrame (I, frameName, url, {
  waitText = null,
  height = CARD_HEIGHT,
  projectNames = null,
  keepContext = true,
  textMasks = [],
  hide = [],
  prepare = null,
  scrollTo = null
} = {}) {
  if (height > CARD_MAX_HEIGHT) {
    throw new Error(`gitlabFrame "${frameName}": ${height} px is taller than ${CARD_MAX_HEIGHT}; scroll to the evidence instead`)
  }
  if (!projectNames) projectNames = projectOfUrl(url)
  const before = await I.usePlaywrightTo('read the window size', async ({ page }) => page.viewportSize())
  await I.resizeWindow(CARD_WIDTH, height)
  try {
    await I.amOnPage(url)
    if (waitText) await I.waitForText(waitText, 60)
    await settlePage(I)
    if (prepare) {
      await prepare()
      await settlePage(I)
    }
    await maskGitLabPage(I, { projectNames, keepContext, textMasks, hide })
    await scrollPage(I, scrollTo || (url.includes('#') ? 'keep' : null))
    // In the story's own folder, as captureTerminalFrame does.
    await addStoryboardFrame(I, await capturePageFrame(I, `${baseDir()}/${frameName}`))
  } finally {
    if (before) await I.resizeWindow(before.width, before.height)
  }
}

// Volatile values a job log prints, whatever the job: commit SHAs, the runner's
// name and system id, uuids and request ids, the per-run runner container.
const JOB_LOG_MASKS = [
  [/\b[0-9a-f]{8,}\b/g, '<sha>'],
  [/(\bon )[^,\n]+(, system ID: )\S+/g, '$1<runner>$2<system>'],
  [/UUID: [\w<>-]+/g, 'UUID: <uuid>'],
  [/\bcorrelation_id=\S+/g, 'correlation_id=<id>'],
  [/(correlation ID: )\S+/g, '$1<id>'],
  [/\bid=\d+/g, 'id=<job>'],
  [/\btoken=\S+/g, 'token=<masked>'],
  [/\brunner-[\w-]+-project-\d+-concurrent-[\w-]+/g, '<runner>']
]

/**
 * A job page as a card, its log reduced to what the sentence is about:
 *   - from: string or RegExp; every log line before the first match is hidden,
 *     except `lead` lines of context (the way a reader scrolls past the
 *     runner's boilerplate);
 *   - fold / unfold: GitLab's own collapsible sections, by header text;
 *   - masks: extra [RegExp, replacement] pairs on top of JOB_LOG_MASKS, applied
 *     ACROSS the coloured spans of a line, so every span keeps its colour;
 *   - sortScannerLines: re-order the lines concurrent scanners print in any
 *     order (OSV's "Scanned … packages" lines, MegaLinter's reporter lines);
 *   - focus: a log text to bring into view instead of the top of the page.
 * The gutter (line numbers, timestamps, section durations), the runner's
 * cleanup line ("…runner-<token>… disconnected from network") and git's
 * "warning: redirecting to" (CI runners print it, local ones do not) always go, and
 * projectNames (default: the project's path segment) are replaced inside the
 * log before the SHA mask runs. The masks are applied across spans once, then
 * kept by maskGitLabPage's observer, text node by text node, should GitLab
 * redraw a line afterwards.
 */
async function jobLogFrame (I, frameName, project, jobId, {
  from = null,
  lead = 0,
  fold = [],
  unfold = [],
  masks = [],
  focus = null,
  sortScannerLines = false,
  height = CARD_HEIGHT,
  projectNames = null,
  waitText = null
} = {}) {
  projectNames = namesOf(project, projectNames)
  const log = '[data-testid="job-log-content"]'
  await gitlabFrame(I, frameName, gitlabUrl.job(project, jobId), {
    height,
    projectNames,
    waitText,
    textMasks: [...JOB_LOG_MASKS, ...masks],
    prepare: async () => {
      await I.waitForElement(log, 60)
      // Sections first: a line inside a folded section is not drawn until it opens.
      await I.executeScript((args) => {
        const toggle = (texts, wantOpen) => document.querySelectorAll('.job-log-line-header').forEach(header => {
          if (!texts.some(t => header.textContent.includes(t))) return
          const open = Boolean(header.querySelector('[data-testid="chevron-lg-down-icon"]'))
          if (open !== wantOpen) header.click()
        })
        toggle(args.unfold, true)
        toggle(args.fold, false)
      }, { fold, unfold })
      // The masks below are written once, so the sections must be done redrawing.
      await settlePage(I)
      if (typeof from === 'string') await I.waitForText(from, 60, log)
      if (sortScannerLines) {
        const { stableJobLog } = require('./stableJobLog')
        await I.executeScript(stableJobLog)
      }
      await I.executeScript((args) => {
        const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
        if (args.from) {
          const re = args.from.regex ? new RegExp(args.from.source, args.from.flags) : null
          const start = lines.findIndex(l => re ? re.test(l.textContent) : l.textContent.includes(args.from.text))
          if (start === -1) throw new Error(`jobLogFrame: no log line matches ${args.from.source || args.from.text}`)
          lines.slice(0, Math.max(0, start - args.lead)).forEach(l => l.setAttribute('data-e2e-mask', ''))
        }
        const CLEANUP = /runner-\S+.*disconnected from network|Possibly zombie container|warning: redirecting to /i
        lines.forEach(l => { if (CLEANUP.test(l.textContent)) l.setAttribute('data-e2e-mask', '') })
        // Line numbers are blanked, not removed: a section's chevron sits in
        // their column and would cover the section's first letter.
        document.querySelectorAll('.job-log-line-number, .job-log-line-header .badge')
          .forEach(el => el.setAttribute('data-e2e-blank', ''))
        document.querySelectorAll('.job-log-time, [class*="log-line-timestamp"], [class*="line-timestamp"]')
          .forEach(el => el.setAttribute('data-e2e-mask', ''))
        // Fractional line heights round differently from one run to the next.
        const box = document.querySelector('.job-log')
        if (box) box.style.lineHeight = `${Math.ceil(parseFloat(window.getComputedStyle(box).lineHeight))}px`
        // A log line is split into coloured spans: match the line's whole text,
        // then rewrite only the characters of each match, span by span.
        function maskLine (line, re, to) {
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
          const parts = []
          let text = ''
          while (walker.nextNode()) {
            parts.push({ node: walker.currentNode, start: text.length })
            text += walker.currentNode.nodeValue
          }
          for (const match of [...text.matchAll(re)].reverse()) {
            const start = match.index
            const end = start + match[0].length
            const masked = match[0].replace(new RegExp(re.source, re.flags.replace('g', '')), to)
            for (const part of parts) {
              const length = part.node.nodeValue.length
              const left = Math.max(0, start - part.start)
              const right = Math.min(length, end - part.start)
              if (left >= right) continue
              part.node.nodeValue = part.node.nodeValue.slice(0, left) +
                (part.start <= start ? masked : '') + part.node.nodeValue.slice(right)
            }
          }
        }
        const res = args.masks.map(m => [new RegExp(m.source, m.flags), m.to])
        lines.forEach(line => res.forEach(([re, to]) => maskLine(line, re, to)))
      }, {
        from: from === null ? null : from instanceof RegExp ? { regex: true, source: from.source, flags: from.flags } : { text: from },
        lead,
        // Project names first: the SHA mask would otherwise eat their hex suffix.
        masks: [
          ...projectNames.map(n => [new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'project']),
          ...JOB_LOG_MASKS,
          ...masks
        ].map(([re, to]) => ({ source: re.source, flags: re.flags.includes('g') ? re.flags : re.flags + 'g', to }))
      })
    },
    // GitLab scrolls a finished log to its bottom on its own: back to the top
    // (the job's name and status), or to the line the card is about.
    scrollTo: focus
      ? async () => {
        await scrollPage(I, null)
        await I.executeScript((text) => {
          const line = Array.from(document.querySelectorAll('.js-log-line.job-log-line')).find(l => l.textContent.includes(text))
          if (!line) throw new Error(`jobLogFrame: no log line contains ${text}`)
          line.scrollIntoView({ block: 'center' })
        }, focus)
        await settlePage(I, { quietMs: 300 })
      }
      : null
  })
}

/** The pipeline editor of a branch: GitLab's own "Pipeline syntax is correct" verdict over the chosen tab (Edit, Visualize, Validate or Full configuration on 19.4). Needs a logged-in member. */
async function ciEditorFrame (I, frameName, project, { ref = 'main', tab = 'Visualize', height = CARD_HEIGHT, projectNames = null } = {}) {
  await gitlabFrame(I, frameName, gitlabUrl.ciEditor(project, ref), {
    height,
    projectNames,
    waitText: 'Pipeline syntax is correct',
    // gitlabFrame settles the page once the chosen tab is the selected one.
    prepare: async () => {
      if (!tab || tab === 'Edit') return
      await I.executeScript((name) => {
        const el = Array.from(document.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === name)
        if (!el) throw new Error(`ciEditorFrame: no "${name}" tab`)
        el.click()
      }, tab)
      // waitForFunction hands its argument array over as ONE argument.
      await I.waitForFunction(([name]) => Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]'))
        .some(t => t.textContent.trim() === name), [tab], 30)
    }
  })
}

/** CI/CD settings, its Variables section open and its table in view: keys and their masked/protected flags. Needs a logged-in maintainer. */
async function ciVariablesFrame (I, frameName, project, { height = CARD_HEIGHT, projectNames = null } = {}) {
  const table = '[data-testid="ci-variable-table"]'
  await gitlabFrame(I, frameName, gitlabUrl.ciSettings(project), {
    height,
    projectNames,
    prepare: async () => {
      // A folded section still lays its table out, so ask the section itself.
      const open = '#js-cicd-variables-settings.expanded'
      if (!await I.grabNumberOfVisibleElements(open)) await I.click('Expand', '#js-cicd-variables-settings')
      await I.waitForElement(open, 30)
      await I.waitForVisible(table, 30)
    },
    scrollTo: table
  })
}

/**
 * Unfold folders in the Files panel of a repository page (GitLab 19.4), the
 * way a reader clicks their chevrons, each one waited until its children are
 * listed. `folders` are the names as the panel shows them, outermost first.
 * Use as a gitlabFrame `prepare`.
 */
async function unfoldFileTree (I, folders) {
  const items = 'nav.repository-tree-list [role="treeitem"]'
  for (const name of folders) {
    const toggle = `nav.repository-tree-list button[aria-label="Expand ${name} directory"]`
    await I.waitForElement(toggle, 30)
    const before = await I.executeScript((selector) => document.querySelectorAll(selector).length, items)
    await I.click(toggle)
    // waitForFunction hands its argument array over as ONE argument.
    await I.waitForFunction(([selector, count]) => document.querySelectorAll(selector).length > count, [items, before], 30)
  }
}

/**
 * Run fn in a second browser tab, then close it. A terminal story keeps its
 * bash session (and the terminal tab its own window size) while a GitLab card
 * is taken next to it: resizeWindow is per tab, and the session cookie is shared.
 */
async function inNewTab (I, fn) {
  await I.openNewTab()
  try {
    return await fn()
  } finally {
    await I.closeCurrentTab()
  }
}

module.exports = {
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_MAX_HEIGHT,
  JOB_LOG_MASKS,
  gitlabUrl,
  settlePage,
  maskGitLabPage,
  gitlabFrame,
  jobLogFrame,
  ciEditorFrame,
  ciVariablesFrame,
  unfoldFileTree,
  inNewTab
}
