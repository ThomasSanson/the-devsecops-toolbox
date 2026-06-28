/* global inject Given When Then Before After */
/**
 * Template-matrix + copier-update steps.
 *
 * Renders the WORKING-BRANCH template inside the codeceptjs container with
 * non-default Copier answers and asserts the generated files — the coverage
 * layer the visual journey (all-default answers) cannot provide. The
 * "configuration layout" pixel baselines show the real rendered tree
 * (`ls -1A` of the project root and .config) so a structural regression is
 * visible at a glance, in the same visual-first spirit as the journey.
 */
const { I } = inject()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const {
  renderProject,
  prepareVersionedTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered
} = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { assertTextVisualMatch } = require('../helpers/textRender')

// Per-scenario state. Worker processes run scenarios sequentially, so
// module-level state is safe; the Before hook resets it for every scenario.
let rendered = null
let template = null
let cleanupDirs = []
let renovateResult = null

Before(() => {
  rendered = null
  template = null
  cleanupDirs = []
  renovateResult = null
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
})

function renderedPath (relative) {
  if (!rendered) throw new Error('No rendered project in this scenario — missing the Given step?')
  return path.join(rendered, relative)
}

function readRendered (relative) {
  const file = renderedPath(relative)
  if (!fs.existsSync(file)) {
    throw new Error(`Rendered file "${relative}" does not exist in ${rendered}`)
  }
  return fs.readFileSync(file, 'utf8')
}

function parseAnswers (answersSpec) {
  const answers = {}
  answersSpec.split(/\s+/).filter(Boolean).forEach(token => {
    const eq = token.indexOf('=')
    if (eq < 0) throw new Error(`Invalid answer token "${token}" (expected key=value)`)
    answers[token.slice(0, eq)] = token.slice(eq + 1)
  })
  return answers
}

function toolboxPackageRule () {
  const config = JSON.parse(readRendered('.config/renovate/config.json'))
  const rule = (config.packageRules || []).find(r => JSON.stringify(r).includes('DevSecOps Toolbox'))
  if (!rule) {
    throw new Error('No packageRules entry matching "DevSecOps Toolbox" in the rendered renovate config')
  }
  return rule
}

// ============================================
// GIVEN — render the template
// ============================================

Given('a project rendered from the working-branch template with default answers', () => {
  rendered = renderProject()
  cleanupDirs.push(rendered)
})

Given('a project rendered from the working-branch template with answers {string}', (answersSpec) => {
  rendered = renderProject(parseAnswers(answersSpec))
  cleanupDirs.push(rendered)
})

Given('a versioned working-branch template with releases {string} and {string}', (v1, v2) => {
  if (v1 !== '1.0.0' || v2 !== '1.0.1') {
    throw new Error('The versioned template fixture publishes exactly releases 1.0.0 and 1.0.1')
  }
  template = prepareVersionedTemplate()
  cleanupDirs.push(template)
})

Given('a project generated from the template at release {string}', (vcsRef) => {
  rendered = renderProjectFromTemplate(template, vcsRef)
  cleanupDirs.push(rendered)
})

Given('the project file {string} is customized with the marker {string}', (relative, marker) => {
  fs.appendFileSync(renderedPath(relative), `\n${marker}\n`)
  execSync(`git add -A && git commit --quiet --no-verify -m "test: customize ${relative}"`, { cwd: rendered })
})

// ============================================
// WHEN — copier update
// ============================================

When('the project is updated to template release {string}', (vcsRef) => {
  updateProject(rendered, vcsRef)
})

When('the project is updated to template release {string} with answers {string}', (vcsRef, answersSpec) => {
  updateProject(rendered, vcsRef, parseAnswers(answersSpec))
})

// ============================================
// THEN — rendered tree assertions
// ============================================

Then('the rendered path {string} should exist', (relative) => {
  if (!fs.existsSync(renderedPath(relative))) {
    throw new Error(`Expected rendered path "${relative}" to exist in ${rendered}`)
  }
})

// Centralization invariant (visual): .config tooling is owned by THIS framework
// repo. Generated/downstream projects must NOT receive per-tool Renovate MRs —
// only the framework-evolution MR (the copier manager on .copier-answers.yml,
// which runs `task copier:update`). The pixel baseline shows the actual rendered
// downstream renovate config: a customManagers list bumping .config/<tool>/version
// would be plainly visible (and regress the baseline).
Then('the rendered renovate config should visually match {string}', async (baselineName) => {
  // columns:2 so the whole rendered config fits the viewport — a full-page
  // screenshot only captures what's above the fold, and a re-added per-tool
  // customManager (top-level, after packageRules) would otherwise hide below it.
  await assertTextVisualMatch(I, baselineName, readRendered('.config/renovate/config.json').trimEnd(), { columns: 2 })
})

// Behavioural proof from the DOWNSTREAM (templatized) side: run the framework's
// own `task renovate:dry-run` INSIDE a freshly generated project. The framework owns
// .config, so a generated project's renovate must IGNORE .config/<tool> pins yet track
// its OWN project/** deps. Two focused tests prove each half, both via the real task
// and its verbatim output (durationMs masked, like the validator baseline's render dir).
let lastExtract = null
let configDowngradeDiff = null
let projectDependency = null
let frameworkDir = null
const frameworkDirs = []
const EXTRACT_CMD = 'task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract'

After(() => {
  for (const dir of frameworkDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {}
  }
})

// Isolated git global config in `dir`: safe.directory (copied files may carry the host
// uid) + identity, without touching the shared ~/.gitconfig (no lock race).
function isolatedGitEnv (dir) {
  const gitConfig = path.join(dir, '.gitconfig.e2e')
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  return { ...process.env, GIT_CONFIG_GLOBAL: gitConfig }
}

// A throwaway full checkout of the framework (the real repo minus heavy/irrelevant trees)
// so renovate can run against it without touching /workspace.
function frameworkCheckout () {
  const dir = fs.mkdtempSync('/tmp/renovate-framework-')
  frameworkDirs.push(dir)
  execSync(
    'tar -C /workspace --exclude=.git --exclude=node_modules --exclude=.cache --exclude=tmp ' +
    '--exclude=megalinter-reports --exclude="project/tests/e2e/screenshots" ' +
    `--exclude="project/tests/e2e/_output" -cf - . | tar -C ${dir} -xf -`
  )
  return dir
}

// Run the framework's REAL entrypoint exactly as a developer does — `task
// renovate:dry-run` — in `dir`, capturing its COMPLETE output verbatim. FORCE_COLOR keeps
// the real terminal colours; we mask only the volatile durationMs and strip ANSI just for
// the (colour-agnostic) packageFiles assertion.
function runRenovateExtract (dir, gitEnv) {
  let raw
  try {
    raw = execSync(`FORCE_COLOR=1 ${EXTRACT_CMD} 2>&1`, {
      cwd: dir, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000, maxBuffer: 256 * 1024 * 1024
    })
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '')
  }
  const clean = stripAnsiEscapeSequences(raw)
  return {
    output: raw.replace(/("durationMs":\s*)\d+/g, '$1<ms>').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').trim(),
    packageFiles: [...new Set([...clean.matchAll(/"packageFile":\s*"([^"]+)"/g)].map(m => m[1]))].sort()
  }
}

// Renovate's own "Dependency extraction complete" summary block. The framework's full
// extract log is ~700 lines (it re-prints the resolved config + every packageFile), so we
// show that genuine block — fileCount/managers + githubDeps — not the whole dump.
function extractionSummary (output) {
  const lines = output.split('\n')
  const start = lines.findIndex(l => l.includes('Dependency extraction complete'))
  const end = lines.findIndex((l, i) => i > start && l.includes('Extracted dependencies'))
  return start < 0 || end < 0 ? output : lines.slice(start, end).join('\n')
}

// Downgrade EVERY framework-owned version pin under .config in `dir` to a stale value —
// every `.config/<tool>/version`, the copier requirement, and the install.sh pins.
function downgradeConfigVersions (dir) {
  const versionFiles = execSync('find .config -type f -name version', { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const vf of versionFiles) fs.writeFileSync(path.join(dir, vf), '0.0.1\n')
  const req = path.join(dir, '.config/copier/requirements.txt')
  if (fs.existsSync(req)) fs.writeFileSync(req, fs.readFileSync(req, 'utf8').replace(/copier==[0-9][0-9.]*/, 'copier==0.0.1'))
  const installSh = path.join(dir, '.config/devsecops/install.sh')
  if (fs.existsSync(installSh)) fs.writeFileSync(installSh, fs.readFileSync(installSh, 'utf8').replace(/(_VERSION="(?:copier==)?)[0-9][0-9.]*(")/g, '$10.0.1$2'))
}

// The downgrade as a real, readable git diff: colours kept (color.ui=always), -U0, and
// git's internal plumbing lines (`diff --git …`, `index …`) dropped so every OLD → 0.0.1
// is visible without per-file boilerplate. Not invented prose — the real diff lines.
function captureConfigDiff (dir, gitEnv) {
  return execSync('git -c color.ui=always diff -U0', { cwd: dir, env: gitEnv, encoding: 'utf8' })
    .split('\n')
    .filter(line => {
      const plain = stripAnsiEscapeSequences(line)
      return !plain.startsWith('diff --git ') && !plain.startsWith('index ')
    })
    .map(l => l.replace(/[ \t]+$/, '')).join('\n').trim()
}

// Commit a pristine tree, downgrade every .config pin, capture the diff, commit, run
// renovate. Shared by the downstream (ignores .config) and framework (tracks it) tests.
function downgradeConfigAndExtract (dir) {
  const gitEnv = isolatedGitEnv(dir)
  execSync('git init -q && git add -A && git commit -qm "pristine"', { cwd: dir, env: gitEnv })
  downgradeConfigVersions(dir)
  configDowngradeDiff = captureConfigDiff(dir, gitEnv)
  execSync('git add -A && git commit -qm "downgrade every .config version"', { cwd: dir, env: gitEnv })
  lastExtract = runRenovateExtract(dir, gitEnv)
}

When('I downgrade every framework-owned .config version and run renovate in the rendered project', () => {
  // Generated project: project/ left empty, so the only thing renovate COULD report is a
  // .config pin — a clean "nothing found" proves .config is out of scope downstream.
  downgradeConfigAndExtract(rendered)
})

Given('a throwaway checkout of the framework', () => {
  frameworkDir = frameworkCheckout()
})

When('I downgrade every framework-owned .config version and run renovate in the framework checkout', () => {
  // SAME downgrade, but in a framework checkout — here renovate MUST detect the .config
  // pins (the framework owns .config and tracks its tool versions). The mirror image.
  downgradeConfigAndExtract(frameworkDir)
})

When('I add an outdated dependency inside the project tree and run renovate in the rendered project', () => {
  const gitEnv = isolatedGitEnv(rendered)
  // The generated project's OWN dependency: an outdated base image in a project/
  // Dockerfile. project/** is in scope, so renovate must detect it (and in a networked
  // run would propose the bump). .config is left untouched — this half is about project/.
  fs.writeFileSync(renderedPath('project/Dockerfile'), 'FROM node:18.0.0\n')
  projectDependency = execSync('cat project/Dockerfile', { cwd: rendered, encoding: 'utf8' }).replace(/\s+$/, '')
  execSync('git init -q && git add -A && git commit -qm "add outdated project dependency"', { cwd: rendered, env: gitEnv })
  lastExtract = runRenovateExtract(rendered, gitEnv)
})

Then('the .config version downgrade should visually match {string}', async (baselineName) => {
  // SETUP proof (an image is worth a thousand words): the real git diff showing every
  // framework-owned pin moved to a stale 0.0.1 — so the "nothing found" below is
  // unambiguous, not an artefact of forgetting to downgrade.
  await assertTextVisualMatch(I, baselineName, `$ git diff\n${configDowngradeDiff}`, { columns: 2 })
})

Then('renovate should detect no framework-owned .config update, matching {string}', async (baselineName) => {
  // Invariant (the visual is the proof, not the test): with every .config pin regressed,
  // renovate must report NO dependency whose package file is a framework-owned .config
  // pin. If it does, the downstream config wrongly re-tracks a framework-owned tool.
  const frameworkOwned = lastExtract.packageFiles
    .filter(f => f.startsWith('.config/') && f !== '.config/devsecops/.copier-answers.yml')
  if (frameworkOwned.length) {
    throw new Error(`Downstream Renovate scanned framework-owned .config files: ${frameworkOwned.join(', ')}`)
  }
  await assertTextVisualMatch(I, baselineName, `$ ${EXTRACT_CMD}\n${lastExtract.output}`)
})

Then('the added project dependency should visually match {string}', async (baselineName) => {
  // SETUP proof: the project/ Dockerfile we created, with its outdated pinned image.
  await assertTextVisualMatch(I, baselineName, `$ cat project/Dockerfile\n${projectDependency}`)
})

Then('renovate should detect the project dependency, matching {string}', async (baselineName) => {
  // Invariant: renovate must report the project's own dependency (project/Dockerfile),
  // proving project/** is exactly what a generated project's renovate tracks.
  if (!lastExtract.packageFiles.includes('project/Dockerfile')) {
    throw new Error(`Downstream Renovate did not detect the project/ dependency; scanned: ${lastExtract.packageFiles.join(', ') || 'nothing'}`)
  }
  await assertTextVisualMatch(I, baselineName, `$ ${EXTRACT_CMD}\n${lastExtract.output}`)
})

Then('renovate should detect the framework-owned .config updates, matching {string}', async (baselineName) => {
  // Positive MIRROR of downstream-config-ignored: the SAME .config downgrade, run in a
  // framework checkout, MUST be detected — renovate reports framework-owned .config pins.
  // If it found none, the framework would silently stop tracking its own tool versions.
  const configDetected = lastExtract.packageFiles
    .filter(f => f.startsWith('.config/') && f !== '.config/devsecops/.copier-answers.yml')
  if (!configDetected.length) {
    throw new Error(`Framework Renovate detected no .config update; scanned: ${lastExtract.packageFiles.join(', ') || 'nothing'}`)
  }
  // The framework extract log is ~700 lines, so show Renovate's own "Dependency extraction
  // complete" summary (fileCount > 0, the regex/pip managers + githubDeps) — the mirror of
  // the downstream "fileCount 0".
  await assertTextVisualMatch(I, baselineName, `$ ${EXTRACT_CMD}\n${extractionSummary(lastExtract.output)}`)
})

Then('the rendered path {string} should not exist', (relative) => {
  if (fs.existsSync(renderedPath(relative))) {
    throw new Error(`Expected rendered path "${relative}" to NOT exist in ${rendered}`)
  }
})

Then('the rendered file {string} should contain {string}', (relative, expected) => {
  const content = readRendered(relative)
  if (!content.includes(expected)) {
    throw new Error(`Expected rendered "${relative}" to contain "${expected}"`)
  }
})

// ============================================
// cspell override seam (issue #162) — a generated project's own vocabulary
// lives in a skip-if-exists override (.config/cspell/config.project.json) that
// copier update never clobbers; the framework base imports it so the two word
// lists merge. Proven by running the project's REAL linter exactly as a developer
// does — `cd <project> && task megalinter` (unmodified) — and keeping MegaLinter's
// own coloured cspell verdict (green = recognised, red = unknown word).
// ============================================

const CSPELL_OVERRIDE = '.config/cspell/config.project.json'
const CSPELL_SAMPLE = 'cspell-sample.md'
let spellOutput = null
let megalinterSeq = 0

// MegaLinter lists the files to analyse via git, so the project must be a repo
// (the sample itself need not be committed — MegaLinter scans the whole tree).
function ensureGitRepo (dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return
  execSync('git init -q && git config user.email e2e@test.local && git config user.name e2e && git add -A && git commit -q --no-verify -m "test: pristine render"', { cwd: dir })
}

// Run the project's REAL linter from inside `dir` — `task megalinter`, the exact
// command a developer types from their project root — and keep MegaLinter's own
// coloured cspell verdict: the "[cspell]" summary line (green ✅ / red ❌) plus any
// "Unknown word" finding. MegaLinter runs every linter; we keep only the cspell
// lines and mask the elapsed time it prints (the sole volatile bit). MegaLinter
// exits non-zero when any linter fails — the cspell verdict is still in its
// output, which is all this test reads. A per-run container name isolates workers.
function runMegalinterCspell (dir) {
  // MegaLinter runs as a heavy (~multi-GB) docker image. In CI's EPHEMERAL dind the
  // image is re-pulled per scenario (≈17×/job) and a pull occasionally stalls/fails,
  // leaving the run dead mid "Pull complete …" with NO [cspell] verdict — proven by
  // the surfaced tail on CI job 15048336134 (migration died at the image pull, 199s;
  // survival, image warm, completed at 322s). Local never sees this: the host socket
  // is mounted so the image is already cached. Retry once — the second attempt finds
  // the image warm from the first — then fail loudly with MegaLinter's own tail.
  let raw = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const container = `ml-cspell-${process.pid}-${megalinterSeq++}`
    try {
      raw = execSync(`FORCE_COLOR=1 task megalinter TASK_MEGALINTER_CONTAINER_NAME=${container} 2>&1`, {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 900000, maxBuffer: 256 * 1024 * 1024
      })
    } catch (e) {
      raw = (e.stdout || '') + (e.stderr || '')
    }
    if (/with \[cspell\]/.test(stripAnsiEscapeSequences(raw))) break
  }
  const plainRaw = stripAnsiEscapeSequences(raw)
  // Still no "[cspell]" verdict after the retry: MegaLinter never ran cspell (0 files,
  // or the image pull kept stalling under dind). That is an ENVIRONMENT failure, NOT
  // "the project word was unrecognised" — returning empty here would make the contrast
  // guard throw a LYING "Expected only X flagged". Fail loudly with MegaLinter's own
  // tail so CI shows the real cause (pull stall, kept-files count, missing config).
  if (!/with \[cspell\]/.test(plainRaw)) {
    const lines = plainRaw.split('\n').filter(l => l.trim())
    // Surface what MegaLinter actually DID after the (successful) image pull: its
    // file-listing / linter summary (so we can tell "0 files" from a crash from a
    // config error), then a wide tail. The earlier 40-line tail stopped at the docker
    // pull (>40 layer lines) and hid the real cause.
    const signals = lines.filter(l => /linted|files?\b|kept|\[spell\]|cspell|error|cannot connect|no such|fatal:|workspace|config/i.test(l)).slice(-50)
    const tail = lines.slice(-60)
    throw new Error(`MegaLinter produced no [cspell] verdict in ${dir} after 2 attempts — it ran but never emitted the cspell summary (0 files? crash? config not found?).\n--- MegaLinter signals ---\n${signals.join('\n')}\n--- MegaLinter tail ---\n${tail.join('\n')}`)
  }
  return raw.split('\n')
    .filter(line => /with \[cspell\]|Unknown word/.test(stripAnsiEscapeSequences(line)))
    .map(line => line.replace(/ - \([0-9.]+m?s\)/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .trim()
}

// The sample carries the project's OWN word AND an unregistered control word, so
// the cspell run is a CONTRAST: the project word must be recognised (absent from
// the errors) while the control is flagged. A bare green "successfully" would not
// prove the project word specifically was the thing recognised.
// cspell:ignore Zzunknownword
const CSPELL_CONTROL = 'Zzunknownword'
let cspellProjectWord = null

function writeCspellSample (dir, word) {
  cspellProjectWord = word
  fs.writeFileSync(path.join(dir, CSPELL_SAMPLE), `${word}\n${CSPELL_CONTROL}\n`)
}

Given('the generated project carries a file with the unknown word {string}', (word) => {
  writeCspellSample(rendered, word)
  ensureGitRepo(rendered)
})

// Setup proof ("une image vaut mille mots"): the actual file MegaLinter is about
// to spell-check, so the red verdict below is unambiguous — like renovate's
// `$ cat project/Dockerfile` before its detection baseline.
Then('the file under spell-check should visually match {string}', async (baselineName) => {
  await assertTextVisualMatch(I, baselineName, `$ cat ${CSPELL_SAMPLE}\n${readRendered(CSPELL_SAMPLE).trimEnd()}`)
})

When('MegaLinter runs on the generated project', () => {
  spellOutput = runMegalinterCspell(rendered)
})

// Setup proof for the survival half: the project-owned override AFTER copier
// update — its own word is still there, so the green verdict below means "the
// surviving word is recognised", not "the override was reset to empty".
Then("the project's surviving cspell override should visually match {string}", async (baselineName) => {
  await assertTextVisualMatch(I, baselineName, `$ cat ${CSPELL_OVERRIDE}\n${readRendered(CSPELL_OVERRIDE).trimEnd()}`)
})

Given('the project registers its own word {string} in its cspell override', (word) => {
  const file = renderedPath(CSPELL_OVERRIDE)
  if (!fs.existsSync(file)) {
    throw new Error(`Project override "${CSPELL_OVERRIDE}" is missing from the generated project — the framework must ship it as a skip-if-exists seam`)
  }
  const override = JSON.parse(fs.readFileSync(file, 'utf8'))
  override.words = [...new Set([...(override.words || []), word])]
  fs.writeFileSync(file, JSON.stringify(override, null, 2) + '\n')
  writeCspellSample(rendered, word)
  execSync('git add -A && git commit --quiet --no-verify -m "test: register project cspell word"', { cwd: rendered })
})

When('MegaLinter runs on the updated project', () => {
  spellOutput = runMegalinterCspell(rendered)
})

Then('MegaLinter\'s cspell should flag it, matching {string}', async (baselineName) => {
  // Teeth: MegaLinter's cspell must actually report the unknown word — else the
  // survival proof below (no spelling error) would be meaningless.
  if (!/Unknown word/.test(stripAnsiEscapeSequences(spellOutput))) {
    throw new Error(`Expected MegaLinter's cspell to flag an unknown word, got:\n${spellOutput}`)
  }
  await assertTextVisualMatch(I, baselineName, spellOutput)
})

Then('cspell should recognise the project word and flag only the control, matching {string}', async (baselineName) => {
  // Contrast: the unregistered control MUST be flagged AND the project's own word
  // must NOT be — proving the project word is genuinely recognised, not that
  // cspell ignores everything. The baseline shows the input file and that verdict
  // together, so the recognition reads at a glance.
  const plain = stripAnsiEscapeSequences(spellOutput)
  if (!plain.includes(`Unknown word (${CSPELL_CONTROL})`) || plain.includes(`Unknown word (${cspellProjectWord})`)) {
    throw new Error(`Expected only "${CSPELL_CONTROL}" flagged and "${cspellProjectWord}" recognised, got:\n${spellOutput}`)
  }
  const sample = readRendered(CSPELL_SAMPLE).trimEnd()
  await assertTextVisualMatch(I, baselineName, `$ cat ${CSPELL_SAMPLE}\n${sample}\n\n${spellOutput}`)
})

Then('the rendered root Taskfile should reference {string}', (taskfileRef) => {
  const content = readRendered('Taskfile.yml')
  if (!content.includes(taskfileRef)) {
    throw new Error(`Expected the rendered root Taskfile to reference "${taskfileRef}"`)
  }
})

Then('the rendered root Taskfile should not reference {string}', (taskfileRef) => {
  const content = readRendered('Taskfile.yml')
  if (content.includes(taskfileRef)) {
    throw new Error(`Expected the rendered root Taskfile to NOT reference "${taskfileRef}"`)
  }
})

Then('the rendered CI variables should contain {string}', (expected) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (!content.includes(expected)) {
    throw new Error(`Expected rendered CI variables to contain "${expected}"`)
  }
})

Then('the rendered CI variables should not contain {string}', (unexpected) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (content.includes(unexpected)) {
    throw new Error(`Expected rendered CI variables to NOT contain "${unexpected}"`)
  }
})

Then('the rendered CI variables should set {string} to an empty value', (variableName) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (!content.includes(`${variableName}: ""`)) {
    throw new Error(`Expected rendered CI variables to set ${variableName} to an empty value`)
  }
})

Then('the rendered renovate config should be valid JSON', () => {
  JSON.parse(readRendered('.config/renovate/config.json'))
})

Then('the rendered toolbox package rule should enable fast-forward automerge', () => {
  const rule = toolboxPackageRule()
  if (rule.automerge !== true || rule.automergeStrategy !== 'fast-forward') {
    throw new Error(`Expected toolbox package rule to enable fast-forward automerge, got: ${JSON.stringify(rule)}`)
  }
})

Then('the rendered toolbox package rule should not enable automerge', () => {
  const rule = toolboxPackageRule()
  if ('automerge' in rule || 'automergeStrategy' in rule || 'automergeType' in rule || 'platformAutomerge' in rule) {
    throw new Error(`Expected toolbox package rule to NOT carry automerge properties, got: ${JSON.stringify(rule)}`)
  }
})

// ============================================
// Renovate — the REAL validator on the rendered config
// ============================================

When('I run the renovate config validation in the rendered project', () => {
  // The runner image bakes a pinned renovate (see .config/codeceptjs/
  // Dockerfile), so the REAL validator runs offline. The template's own
  // `task renovate:validate` wiring (npx) stays covered by the toolbox's
  // code:renovate-validate CI job; going through npx here re-resolves
  // "latest" from the registry on every call, which flakes on throttled
  // shared-runner egress.
  try {
    const output = execSync(
      'LOG_LEVEL=info renovate-config-validator ".config/renovate/config.json" 2>&1',
      {
        cwd: rendered,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300000
      }
    )
    renovateResult = { exitCode: 0, output }
  } catch (error) {
    renovateResult = {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
})

Then('the renovate validation should succeed', () => {
  if (renovateResult.exitCode !== 0) {
    throw new Error(`Expected renovate validation to succeed, exit=${renovateResult.exitCode}\n${renovateResult.output}`)
  }
})

Then('the renovate validation output should contain {string}', (expected) => {
  if (!renovateResult.output.includes(expected)) {
    throw new Error(`Expected renovate validation output to contain "${expected}"\n${renovateResult.output}`)
  }
})

// Verdict = the validator's own progress/verdict lines, the stable contract;
// npm/npx download noise above them is volatile. The per-run render dir is
// masked in case the validator echoes absolute paths.
Then('the renovate validation verdict should visually match {string}', async (baselineName) => {
  const lines = stripAnsiEscapeSequences(renovateResult.output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('Validating ') || line.includes('Config validated successfully'))
    .map(line => line.replace(/\/tmp\/e2e-render-[0-9a-f]+/g, '<render-dir>'))
  if (lines.length === 0) {
    throw new Error(`No validator verdict lines found in output:\n${renovateResult.output}`)
  }
  await assertTextVisualMatch(I, baselineName, lines.join('\n'))
})

// ============================================
// THEN — visual proof of the rendered layout
// ============================================

Then('the rendered configuration layout should visually match {string}', async (baselineName) => {
  const listing = execSync('echo "$ ls -1A"; ls -1A; echo; echo "$ ls -1A .config"; ls -1A .config', {
    cwd: rendered,
    encoding: 'utf8'
  })
  await assertTextVisualMatch(I, baselineName, listing.trimEnd(), { columns: 2 })
})
