/* global inject Given Then After */
/**
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
 * The pixel baseline is Renovate's OWN verbatim output — the "Dependency extraction
 * complete" summary block it prints (per-manager file/dep counts + githubDeps) — not
 * a hand-built table. The full extract log is ~700 lines, so only that genuine summary
 * block is shown. The dual-endpoint invariant (each tool in its .config source AND in
 * install.sh) is enforced programmatically from the same task's JSON output.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { assertTextVisualMatch } = require('../helpers/textRender')

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

Given('a safe copy of the framework with each bootstrap tool regressed to an older version', () => {
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

  execSync('git init -q && git add -A && git commit -qm "regress bootstrap tool versions"', { cwd: workdir, env: gitEnv })
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

Then('Renovate should detect each regressed tool at both endpoints, visually matching {string}', async (baselineName) => {
  // GENUINE visual: run the framework's real entrypoint exactly as a developer does
  // (`task renovate:dry-run`) and show Renovate's own "Dependency extraction complete"
  // summary block, verbatim (the full ~700-line extract log re-prints the resolved
  // config + every packageFile). The per-manager counts (regex = the .config/<tool>
  // pins + install.sh) and githubDeps are Renovate's, not hand-formatted.
  const summary = extractionSummary(runExtract(EXTRACT_HUMAN, workdir, gitEnv))

  // Rigorous per-endpoint invariant: the summary proves the tools are SEEN; this proves
  // each is detected at BOTH endpoints (its .config source AND the install.sh pin),
  // parsed from the same task's JSON output (the detail lives in the packageFiles dump).
  const filesByDep = trackedDepFiles(runExtract(EXTRACT_JSON, workdir, gitEnv))
  for (const tool of TOOLS) {
    const files = filesByDep[tool.depName] || new Set()
    const missing = [tool.source || tool.requirements, INSTALL_SH].filter(f => !files.has(f))
    if (missing.length) {
      throw new Error(`${tool.depName} not detected at both endpoints — missing: ${missing.join(', ')} (found in: ${[...files].join(', ') || 'nowhere'})`)
    }
  }

  // Baseline = the typed task command + Renovate's verbatim extraction summary.
  await assertTextVisualMatch(I, baselineName, `$ ${EXTRACT}\n${summary}`)
})
