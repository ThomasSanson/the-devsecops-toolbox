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
 * side. Extract mode performs no datasource lookup; the task downloads the
 * framework's pinned Renovate release through npx.
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
const TRACKED = [...TOOLS.map(tool => tool.depName), 'oxsecurity/megalinter']

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
  // What each tool is pinned at TODAY, read before the downgrade. Every one of
  // these numbers moves whenever Renovate bumps that tool — and each one is
  // printed on the removed side of the diff below.
  const current = []
  for (const tool of TOOLS) {
    if (tool.source) {
      const file = path.join(workdir, tool.source)
      current.push(fs.readFileSync(file, 'utf8').trim())
      fs.writeFileSync(file, tool.old + '\n')
    }
    if (tool.requirements) {
      const reqPath = path.join(workdir, tool.requirements)
      const text = fs.readFileSync(reqPath, 'utf8')
      current.push(text.match(/copier==([0-9][0-9.]*)/)[1])
      fs.writeFileSync(reqPath, text.replace(/copier==[0-9][0-9.]*/, 'copier==' + tool.old))
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

  // What this picture proves is that BOTH endpoints of every tool were knocked
  // back, so Renovate has something to find at each of them. The number they
  // were knocked back FROM is today's pin, and it changes on every release of
  // task, copier, gum or glow — four dependencies Renovate moves constantly,
  // each bump otherwise regenerating a baseline that says nothing new. So the
  // current pin is masked; the regressed value it moved to is fixed by this
  // test and stays spelled out, which is the half the reader needs.
  const shown = current.reduce((text, version) => text.split(version).join('<version>'), diff)

  await renderTextInBrowser(I, `$ git diff\n${shown}`, { columns: 2 })
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

storyboardStep(Then, 'Renovate tracks the MegaLinter release in both local and CI execution', async () => {
  const expected = ['.config/megalinter/package.json', '.config/gitlab/ci/devsecops/code.yml', '.config/gitlab/ci/devsecops/code.yml.jinja']
  const files = trackedDepFiles(runExtract(EXTRACT_JSON, workdir, gitEnv))['oxsecurity/megalinter'] || new Set()
  for (const file of expected) {
    if (!files.has(file)) throw new Error(`Renovate must track the MegaLinter version in ${file}`)
  }
  const command = [
    'grep -H -E "mega-linter-runner|ghcr.io/oxsecurity/megalinter:"',
    ...expected.map(file => '  ' + file)
  ].join(' \\\n')
  const output = execSync(command, { cwd: workdir, env: gitEnv, encoding: 'utf8' })
    .replace(/\b(v?)[0-9]+\.[0-9]+\.[0-9]+\b/g, '$1<version>')
  await renderPreFrame(I, 'megalinter-local-and-ci-pins', `$ ${command}\n${output}`)
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

// Four dependencies from four different ecosystems, each pinned back to a
// genuinely old version so Renovate always has something to propose. A
// dependency whose upstream has just moved to a new major comes back in two
// buckets (the minor one and the major one) — both under the same masked
// branch name, so the picture stays one row per dependency either way.
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
  },
  // MegaLinter earns its row by being the trap: one number in a package.json
  // that is spent as a DOCKER tag (`oxsecurity/megalinter:v<number>`), never as
  // an npm version. Follow npm and Renovate proposes a tag Docker Hub cannot
  // serve — `manifest unknown`, the whole pipeline dead. The branch below must
  // therefore be attributed to `oxsecurity/megalinter`: if it ever comes back
  // under `mega-linter-runner`, Renovate is reading npm again and this story
  // says so before a merge request does.
  {
    depName: 'oxsecurity/megalinter',
    file: '.config/megalinter/package.json',
    pattern: /"mega-linter-runner": "[^"]+"/,
    pinned: '"mega-linter-runner": "9.1.0"'
  }
]

// MegaLinter left Docker Hub: v9.4.0 (2026-02-28) is the last image published
// there, while ghcr.io went on to v9.5.0 and v9.6.0. Reading the abandoned
// registry fails silently — Renovate keeps answering "already up to date" and
// the framework quietly stops receiving MegaLinter releases forever. So the
// update it proposes has to be one Docker Hub does not carry.
const DOCKER_HUB_LAST_MEGALINTER = '9.4.0'

// Numeric compare, no semver dependency for a plain `a > b` on release tags.
function isNewerThan (version, floor) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number)
  const bar = floor.split('.').map(Number)
  for (let i = 0; i < Math.max(parts.length, bar.length); i++) {
    const a = parts[i] || 0
    const b = bar[i] || 0
    if (a !== b) return a > b
  }
  return false
}

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
// The per-manager package files sit under `config` in the pinned Renovate
// release, and directly under `packageFiles` in newer ones.
// Renovate nests its findings four deep — manager, package file, dependency,
// update — and reading that nest is a separate job from finding the one log
// line that holds it. Split accordingly: this walks the nest, the caller finds
// the line.
function collectBranches (packageFiles, byDep) {
  for (const managerFiles of Object.values(packageFiles)) {
    if (!Array.isArray(managerFiles)) continue
    for (const pf of managerFiles) {
      for (const dep of (pf.deps || [])) {
        for (const update of (dep.updates || [])) {
          if (!update.branchName) continue
          ;(byDep[dep.depName] = byDep[dep.depName] || []).push({
            branch: update.branchName,
            // The branch name only carries the major (`-9.x`), so the version
            // actually proposed has to be read from the update itself.
            version: update.newVersion || update.newValue
          })
        }
      }
    }
  }
}

function branchesByDep (json) {
  const byDep = {}
  for (const line of json.split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch (_) { continue }
    if (!entry || entry.msg !== 'packageFiles with updates') continue
    const packageFiles = entry.packageFiles || entry.config
    if (packageFiles) collectBranches(packageFiles, byDep)
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
  // The lockfile is not part of the question. Renovate reads it for the version
  // npm actually installed, so a lockfile still holding the NEWEST release makes
  // it answer "already up to date" to a package.json this test just pinned back
  // — and the story fails on the very merge request that brought that release.
  // Dropping it from the throwaway copy leaves the pin-back as the only truth.
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
    fs.rmSync(path.join(spreadDir, '.config/codeceptjs', lock), { force: true })
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
    const updates = byDep[dep.depName] || []
    const branches = [...new Set(updates.map(u => u.branch))].sort()
    if (!branches.length) {
      throw new Error(`Renovate proposed no update for ${dep.depName}, pinned back in ${dep.file}`)
    }
    if (dep.depName === 'oxsecurity/megalinter') {
      const proposed = updates.map(u => u.version).filter(Boolean)
      if (!proposed.some(v => isNewerThan(v, DOCKER_HUB_LAST_MEGALINTER))) {
        throw new Error(
          `Renovate offers MegaLinter ${proposed.join(', ') || 'nothing'}, none newer than ` +
          `${DOCKER_HUB_LAST_MEGALINTER} — it is reading Docker Hub, abandoned since 2026-02-28, ` +
          'instead of ghcr.io where the releases now land'
        )
      }
    }
    for (const branch of branches) {
      const clash = owners[branch]
      if (clash && clash !== dep.depName) {
        throw new Error(`${dep.depName} and ${clash} share the merge request branch ${branch} — one dependency, one merge request`)
      }
      owners[branch] = dep.depName
    }
    // The day upstream publishes a new major, one dependency comes back in two
    // update buckets — `renovate/oxsecurity-megalinter-9.x` AND `-10.x` — and
    // that is Renovate working as designed: a major travels in its own merge
    // request, never grafted onto the minor one. Both branches carry the same
    // masked name, so the row is written once. What this picture answers is
    // WHICH dependency owns a branch name; how many majors upstream happens to
    // offer this month is not the question, and must not move the baseline.
    for (const name of [...new Set(branches.map(maskBranchVersion))]) {
      rows.push(`${dep.depName.padEnd(30)} ${dep.file.padEnd(35)} ${name}`)
    }
  }

  await renderPreFrame(I, 'one-merge-request-per-dependency', [
    `$ ${DRY_RUN}`,
    `${'dependency'.padEnd(30)} ${'pinned in'.padEnd(35)} merge request branch`,
    ...rows,
    '',
    `${SPREAD.length} dependencies, no two sharing a merge request branch`
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

  // Browser build numbers and platform directories differ between runners.
  // Mask them so the baseline proves availability, not the host architecture.
  const displayedExecutable = executable
    .replace(/-\d+\//, '-<build>/')
    .replace(/\/chrome-[^/]+\//, '/chrome-<platform>/')

  await renderPreFrame(I, 'browser-inside-the-runner', [
    "$ grep 'playwright install' .config/codeceptjs/Dockerfile",
    buildLine.trim(),
    '',
    `$ ${RESOLVE}`,
    displayedExecutable,
    '',
    'present and executable inside the test runner'
  ].join('\n'))
})
