/* global inject Given Then After */
/**
 * Storyboard for @renovate-flow (chapters 2 and 3) (see features/03-evolution/renovate.feature).
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
const { REPO, copyFramework } = require('../helpers/frameworkCopy')
const { storyboardStep, addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

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

storyboardStep(Given, 'a safe copy of the framework has every bootstrap tool regressed to an older version', async () => {
  workdir = fs.mkdtempSync('/tmp/renovate-detect-')
  cleanupDirs.push(workdir)
  copyFramework(workdir)

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

storyboardStep(Then, "Renovate's own extraction log detects every regressed tool", async () => {
  const summary = extractionSummary(runExtract(EXTRACT_HUMAN, workdir, gitEnv))
  // FORCE_COLOR=1 output keeps real ANSI colour — renderTextInBrowser
  // (ansiToHtml-capable), never renderPreFrame (plain escapeHtml only).
  await renderTextInBrowser(I, `$ ${EXTRACT}\n${summary}`, { columns: 1 })
  await addStoryboardFrame(I, await capturePageFrame(I, 'detection-summary'))
})

storyboardStep(Then, 'each tool is detected at both its config source and the install.sh pin', async () => {
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

// ---------------------------------------------------------------------------
// Chapter 3 — one dependency, one merge request
// ---------------------------------------------------------------------------
//
// A dependency update is only mergeable when it arrives alone. Renovate grouped
// EVERY dependency of the repository into one merge request for months, so a
// single broken package held all the others hostage. And the test runner's
// browser used to come from the base image tag alone, which Renovate moves
// independently of the npm package — so a Playwright bump could leave the
// runner with no browser at all.

// Three dependencies from three different ecosystems, each pinned back to a
// genuinely old version so Renovate always has something to propose. Each one
// sits on a major upstream is not about to leave (Playwright 1.x, ansible-core
// 2.x), so exactly ONE update bucket — and therefore exactly one branch — comes
// back per dependency, which keeps the picture readable.
const SPREAD = [
  {
    depName: 'playwright',
    file: '.config/codeceptjs/package.json',
    pattern: /"playwright": "[^"]+"/,
    pinned: '"playwright": "1.40.0"'
  },
  {
    depName: 'mcr.microsoft.com/playwright',
    file: '.config/codeceptjs/Dockerfile',
    pattern: /^FROM mcr\.microsoft\.com\/playwright:.*$/m,
    pinned: 'FROM mcr.microsoft.com/playwright:v1.50.0'
  },
  {
    depName: 'ansible-core',
    file: '.config/ansible/requirements.txt',
    pattern: /ansible-core==\S+/,
    pinned: 'ansible-core==2.16.0'
  }
]

const DRY_RUN = 'task renovate:dry-run'

// Renovate names a branch after the update it carries, so the branch name ends
// in the version it would move to. Masking that tail keeps the baseline stable
// across upstream releases while leaving the part under test — WHICH dependency
// each branch belongs to — fully visible. A group branch such as
// `renovate/playwright-monorepo` carries no version tail and stays verbatim.
function maskBranchVersion (branch) {
  return branch.replace(/-v?\d+(\.\d+)*(\.x)?$/, '-<version>')
}

// Map each pinned-back dependency -> the branches Renovate would open for it.
// The per-manager package files sit under `config` in the pinned renovate the
// image carries, and directly under `packageFiles` in newer ones.
function branchesByDep (json) {
  const byDep = {}
  for (const line of json.split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch (_) { continue }
    if (!entry || entry.msg !== 'packageFiles with updates') continue
    const packageFiles = entry.packageFiles || entry.config
    if (!packageFiles) continue
    for (const managerFiles of Object.values(packageFiles)) {
      if (!Array.isArray(managerFiles)) continue
      for (const pf of managerFiles) {
        for (const dep of (pf.deps || [])) {
          for (const update of (dep.updates || [])) {
            if (!update.branchName) continue
            ;(byDep[dep.depName] = byDep[dep.depName] || new Set()).add(update.branchName)
          }
        }
      }
    }
  }
  return byDep
}

storyboardStep(Then, 'Renovate gives every dependency a merge request of its own', async () => {
  const spreadDir = fs.mkdtempSync('/tmp/renovate-spread-')
  cleanupDirs.push(spreadDir)
  copyFramework(spreadDir)
  for (const dep of SPREAD) {
    const target = path.join(spreadDir, dep.file)
    const before = fs.readFileSync(target, 'utf8')
    const after = before.replace(dep.pattern, dep.pinned)
    if (after === before) {
      throw new Error(`Could not pin ${dep.depName} back in ${dep.file} — the pattern no longer matches`)
    }
    fs.writeFileSync(target, after)
  }

  // Only these three files are looked up: the framework's other dependencies
  // would drag GitHub releases into the run, and an unauthenticated GitHub is
  // rate-limited on shared runners — a flaky lookup would change the picture.
  const env = {
    ...process.env,
    LOG_FORMAT: 'json',
    RENOVATE_INCLUDE_PATHS: SPREAD.map(dep => dep.file).join(',')
  }
  const byDep = branchesByDep(runExtract(`TASK_RENOVATE_LOG_LEVEL=debug ${DRY_RUN}`, spreadDir, env))

  const owners = {}
  const rows = []
  for (const dep of SPREAD) {
    const branches = [...(byDep[dep.depName] || new Set())].sort()
    if (!branches.length) {
      throw new Error(`Renovate proposed no update for ${dep.depName}, pinned back in ${dep.file}`)
    }
    for (const branch of branches) {
      const clash = owners[branch]
      if (clash && clash !== dep.depName) {
        throw new Error(`${dep.depName} and ${clash} share the merge request branch ${branch} — one dependency, one merge request`)
      }
      owners[branch] = dep.depName
      rows.push(`${dep.depName.padEnd(30)} ${dep.file.padEnd(35)} ${maskBranchVersion(branch)}`)
    }
  }

  await renderPreFrame(I, 'one-merge-request-per-dependency', [
    `$ ${DRY_RUN}`,
    `${'dependency'.padEnd(30)} ${'pinned in'.padEnd(35)} merge request branch`,
    ...rows,
    '',
    `${SPREAD.length} dependencies, ${Object.keys(owners).length} merge requests, none shared`
  ].join('\n'))
})

storyboardStep(Then, 'the test runner already holds the browser its own Playwright asks for', async () => {
  // The build line that makes the guarantee: whatever browsers the base image
  // happened to ship, the image installs the one THIS playwright resolves to.
  const dockerfile = path.join(REPO, '.config/codeceptjs/Dockerfile')
  const buildLine = fs.readFileSync(dockerfile, 'utf8')
    .split('\n')
    .find(line => /playwright install/.test(line))
  if (!buildLine) {
    throw new Error('.config/codeceptjs/Dockerfile installs no browser: a Playwright bump would leave the runner without one')
  }

  // Asked to the runner itself, from where its dependencies are installed.
  const RESOLVE = 'node -e "console.log(require(\'playwright\').chromium.executablePath())"'
  const executable = execSync(RESOLVE, { cwd: '/app/.config/codeceptjs', encoding: 'utf8' }).trim()
  fs.accessSync(executable, fs.constants.X_OK)

  // The browser build number moves with every Playwright release; masking it
  // keeps the picture stable while still showing the file is really there.
  await renderPreFrame(I, 'browser-inside-the-runner', [
    "$ grep 'playwright install' .config/codeceptjs/Dockerfile",
    buildLine.trim(),
    '',
    `$ ${RESOLVE}`,
    executable.replace(/-\d+\//, '-<build>/'),
    '',
    'present and executable inside the test runner'
  ].join('\n'))
})
