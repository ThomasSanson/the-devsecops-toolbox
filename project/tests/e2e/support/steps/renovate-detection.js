/* global inject Given Then After */
/**
 * Storyboard for @e2e-renovate-detection (see features/04-evolution/renovate.feature).
 *
 * Proves the framework's OWN Renovate wiring detects every bootstrap tool at
 * BOTH endpoints (the canonical .config/<tool> source AND the install.sh pin),
 * so a new release is bumped in both places (one grouped PR), never just one.
 *
 * It does NOT call renovate by hand — it runs the framework's real entrypoint,
 * `task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract`, inside a throwaway full
 * copy of the framework (the "safe zone") where each tool has been regressed to
 * an older version. So the task wiring, the config path it resolves, and the
 * Renovate config are ALL exercised together — not a renovate command run on the
 * side. Extract mode is offline (no datasource lookup), and the task prefers the
 * pinned, baked `renovate` over npx, so the run is deterministic and CI-safe.
 *
 * ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline, asserted
 * inside the step (tolerance: 0): the regression stage, Renovate's own
 * "Dependency extraction complete" summary block (verbatim — not a hand-built
 * table), and the dual-endpoint mapping itself, made visible.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { renderTextInBrowser } = require('../helpers/textRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()
const REPO = '/workspace'

// Dual-endpoint bootstrap tools, each regressed to a genuinely older version in
// BOTH its canonical source and the install.sh pin.
const TOOLS = [
  { depName: 'go-task/task', old: '3.40.0', source: '.config/task/version', pinVar: 'TASK_VERSION' },
  { depName: 'copier', old: '9.0.0', requirements: '.config/copier/requirements.txt', pinVar: 'COPIER_VERSION', pinPrefix: 'copier==' },
  { depName: 'charmbracelet/gum', old: '0.14.0', source: '.config/gum/version', pinVar: 'GUM_VERSION' },
  { depName: 'charmbracelet/glow', old: '2.0.0', source: '.config/glow/version', pinVar: 'GLOW_VERSION' }
]
const TRACKED = TOOLS.map(tool => tool.depName)

let workdir = null
let gitEnv = null
const cleanupDirs = []

After(() => {
  for (const dir of cleanupDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
  }
  workdir = null
  gitEnv = null
})

storyboardStep(Given, 'a safe copy of the framework has every bootstrap tool regressed to an older version', {
  note: 'Off-camera: a full throwaway copy of the framework, git-pristine first. Each bootstrap tool is then pinned OLDER in both its canonical .config source and the install.sh bootstrap pin — the real git diff shows every OLD to regressed move.',
  copy: 'git diff'
}, async () => {
  workdir = fs.mkdtempSync('/tmp/renovate-detect-')
  cleanupDirs.push(workdir)
  // Full framework copy (task needs the root Taskfile + every include); drop the
  // heavy, irrelevant trees so the copy stays light.
  execSync(
    `tar -C ${REPO} --exclude=.git --exclude=node_modules --exclude=.cache --exclude=tmp ` +
    '--exclude=megalinter-reports --exclude="project/tests/e2e/screenshots" ' +
    `--exclude="project/tests/e2e/_output" -cf - . | tar -C ${workdir} -xf -`
  )

  // The tar keeps the host uid, so git would refuse "dubious ownership". Use an
  // isolated global git config (safe.directory + identity) — never touches the
  // shared ~/.gitconfig, so there is no lock race with parallel workers.
  const gitConfig = path.join(workdir, '.gitconfig.e2e')
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig }
  execSync('git init -q && git add -A && git commit -qm "pristine"', { cwd: workdir, env: gitEnv })

  const installSh = path.join(workdir, '.config/devsecops/install.sh')
  let sh = fs.readFileSync(installSh, 'utf8')
  for (const tool of TOOLS) {
    if (tool.source) {
      fs.writeFileSync(path.join(workdir, tool.source), tool.old + '\n')
    }
    if (tool.requirements) {
      const reqPath = path.join(workdir, tool.requirements)
      fs.writeFileSync(reqPath, fs.readFileSync(reqPath, 'utf8').replace(/copier==[0-9][0-9.]*/, 'copier==' + tool.old))
    }
    const value = (tool.pinPrefix || '') + tool.old
    sh = sh.replace(new RegExp(`(${tool.pinVar}=")[^"]+(")`), `$1${value}$2`)
  }
  fs.writeFileSync(installSh, sh)

  // The downgrade as a real, readable git diff: colours kept (color.ui=always), -U0,
  // and git's internal plumbing lines (`diff --git …`, `index …`) dropped so every
  // OLD → regressed move is visible without per-file boilerplate.
  const diff = execSync('git -c color.ui=always diff -U0', { cwd: workdir, env: gitEnv, encoding: 'utf8' })
    .split('\n')
    .filter(line => {
      const plain = stripAnsiEscapeSequences(line)
      return !plain.startsWith('diff --git ') && !plain.startsWith('index ')
    })
    .map(l => l.replace(/[ \t]+$/, '')).join('\n').trim()

  execSync('git add -A && git commit -qm "regress bootstrap tool versions"', { cwd: workdir, env: gitEnv })

  await renderTextInBrowser(I, `$ git diff\n${diff}`, { columns: 2 })
  await addStoryboardFrame(I, await capturePageFrame(I, 'detection-regressed'))
})

// EXTRACT is the command a developer actually types (shown in the baseline). FORCE_COLOR
// keeps go-task + renovate's real terminal colours for the visual (a real tty would too);
// the JSON run (for the colour-agnostic per-endpoint assertion) stays plain.
const EXTRACT = 'task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract'
const EXTRACT_HUMAN = `FORCE_COLOR=1 ${EXTRACT}`
const EXTRACT_JSON = `LOG_FORMAT=json ${EXTRACT}`
const INSTALL_SH = '.config/devsecops/install.sh'

// Run the real task; return its captured output even if the exit code is non-zero.
function runExtract (cmd, cwd, env) {
  try {
    return execSync(cmd, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000, maxBuffer: 256 * 1024 * 1024 })
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '')
  }
}

// Renovate's own "Dependency extraction complete" summary block, verbatim — ANSI colours
// kept (the renderer converts them); only trailing spaces trimmed.
function extractionSummary (human) {
  const lines = human.split('\n').map(l => l.replace(/[ \t]+$/, ''))
  const start = lines.findIndex(l => l.includes('Dependency extraction complete'))
  const end = lines.findIndex((l, i) => i > start && l.includes('Extracted dependencies'))
  if (start < 0 || end < 0) {
    throw new Error(`Could not locate Renovate's extraction summary in:\n${human}`)
  }
  return lines.slice(start, end).join('\n')
}

// Map each tracked depName -> set of package files Renovate extracted it from.
function trackedDepFiles (json) {
  const filesByDep = {}
  for (const line of json.split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch (_) { continue }
    if (!entry || entry.msg !== 'Extracted dependencies' || !entry.packageFiles) continue
    for (const managerFiles of Object.values(entry.packageFiles)) {
      for (const pf of managerFiles) {
        for (const dep of (pf.deps || [])) {
          if (TRACKED.includes(dep.depName)) (filesByDep[dep.depName] = filesByDep[dep.depName] || new Set()).add(pf.packageFile)
        }
      }
    }
  }
  return filesByDep
}

storyboardStep(Then, "Renovate's own extraction log detects every regressed tool", {
  note: 'The framework\'s real entrypoint runs against the regressed copy; Renovate\'s own "Dependency extraction complete" summary block (verbatim) lists every regex/pip manager hit plus githubDeps — not a hand-built table.',
  copy: EXTRACT
}, async () => {
  const summary = extractionSummary(runExtract(EXTRACT_HUMAN, workdir, gitEnv))
  // FORCE_COLOR=1 output keeps real ANSI colour — renderTextInBrowser
  // (ansiToHtml-capable), never renderPreFrame (plain escapeHtml only).
  await renderTextInBrowser(I, `$ ${EXTRACT}\n${summary}`, { columns: 1 })
  await addStoryboardFrame(I, await capturePageFrame(I, 'detection-summary'))
})

storyboardStep(Then, 'each tool is detected at both its config source and the install.sh pin', {
  note: 'The rule made visible: every tracked tool is reported from its canonical .config source AND install.sh, so one Renovate PR touches both files, never only one.',
  copy: EXTRACT
}, async () => {
  const filesByDep = trackedDepFiles(runExtract(EXTRACT_JSON, workdir, gitEnv))
  const rows = []
  for (const tool of TOOLS) {
    const files = filesByDep[tool.depName] || new Set()
    const endpoint = tool.source || tool.requirements
    const missing = [endpoint, INSTALL_SH].filter(f => !files.has(f))
    if (missing.length) {
      throw new Error(`${tool.depName} not detected at both endpoints — missing: ${missing.join(', ')} (found in: ${[...files].join(', ') || 'nowhere'})`)
    }
    rows.push(`${tool.depName.padEnd(20)} ${endpoint.padEnd(38)} detected`)
    rows.push(`${''.padEnd(20)} ${INSTALL_SH.padEnd(38)} detected`)
  }
  await renderPreFrame(I, 'detection-endpoints', `$ ${EXTRACT}  (per-endpoint)\n${rows.join('\n')}`)
})
