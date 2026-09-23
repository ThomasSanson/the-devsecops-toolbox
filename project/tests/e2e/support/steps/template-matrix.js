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
const { pathToFileURL } = require('url')
const {
  renderProject,
  prepareVersionedTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered,
  UPDATE_MARKER_FILE,
  UPDATE_MARKER
} = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { assertTextVisualMatch, renderTextInBrowser, ansiToHtml } = require('../helpers/textRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep, addStoryboardFrame, capturePageFrame, captureElementFrame } = require('../../../../../.config/codeceptjs/storyboard')

// Per-scenario state. Worker processes run scenarios sequentially, so
// module-level state is safe; the Before hook resets it for every scenario.
let rendered = null
let template = null
let cleanupDirs = []
let renovateEnv = ''
let renovateResult = null

Before(() => {
  rendered = null
  template = null
  cleanupDirs = []
  renovateResult = null
  renovateEnv = ''
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

// Behavioural proof from the DOWNSTREAM (templatized) side: run the framework's
// own `task renovate:dry-run` INSIDE a freshly generated project. The framework owns
// .config, so a generated project's renovate must IGNORE .config/<tool> pins yet track
// its OWN project/** deps. Two focused tests prove each half, both via the real task
// and its verbatim output (durationMs masked, like the validator baseline's render dir).
let lastExtract = null
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

// Commit a pristine tree, downgrade every .config pin, commit, run renovate.
// Shared by the downstream (ignores .config) and framework (tracks it) tests.
function downgradeConfigAndExtract (dir) {
  const gitEnv = isolatedGitEnv(dir)
  execSync('git init -q && git add -A && git commit -qm "pristine"', { cwd: dir, env: gitEnv })
  downgradeConfigVersions(dir)
  execSync('git add -A && git commit -qm "downgrade every .config version"', { cwd: dir, env: gitEnv })
  lastExtract = runRenovateExtract(dir, gitEnv)
}

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

// ============================================
// Renovate — the REAL validator on the rendered config. Shared by the
// renovate-contract storyboard below: runs renovate-config-validator (the
// runner image bakes a pinned copy, so it runs offline) exactly as CI's
// code:renovate-validate job does, and keeps only its stable verdict lines
// (the npm/npx download noise above them is volatile).
// ============================================

function runRenovateValidator (dir) {
  try {
    const output = execSync(
      'LOG_LEVEL=info renovate-config-validator ".config/renovate/config.json" 2>&1',
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', timeout: 300000 }
    )
    return { exitCode: 0, output }
  } catch (error) {
    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
}

function validatorVerdictLines (output) {
  return stripAnsiEscapeSequences(output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('Validating ') || line.includes('Config validated successfully'))
    .map(line => line.replace(/\/tmp\/e2e-render-[0-9a-f]+/g, '<render-dir>'))
    .join('\n')
}

// ============================================
// Renovate-flow storyboard — @renovate-flow (chapter 1). Absorbs the 6
// former flat renovate.feature scenarios (validate-default,
// validate-automerge-off, centralized, downstream-config-ignored,
// downstream-project-tracked, framework-config-tracked) into ONE journey:
// the rendered config is real, valid config (on/off automerge), then the
// centralization contract itself, both ways — a downstream project's
// Renovate ignores stale framework-owned .config drift yet tracks its own
// project/** dependency, while the FRAMEWORK repo's Renovate detects that
// very same .config drift.
// ============================================

// Coloured (FORCE_COLOR=1) output rendered into a content-HUGGING box and
// element-cropped, exactly like renderPreFrame but ANSI-aware: a short summary
// (e.g. downstream "managers: {}") yields a small frame, never a mostly-empty
// viewport that would trip the empty-frame guard. renderPreFrame (plain
// escapeHtml) can't be reused here — it would print the raw escape codes.
async function renderColorFrame (frameName, text) {
  I.resizeWindow(1024, 640)
  await I.usePlaywrightTo('render coloured output in browser', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0">' +
      '<div id="task-output-box" style="display:inline-block;background:#1e1e1e;padding:16px 22px 16px 16px;max-width:992px">' +
      '<pre id="task-output" style="margin:0;color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-all">' +
      ansiToHtml(text) +
      '</pre></div></body></html>'
    )
  })
  await I.wait(0.5)
  await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#task-output-box'))
  I.resizeWindow(1024, 768)
}

storyboardStep(Given, "a generated project carries the framework's centralized renovate config", async () => {
  rendered = renderProject()
  cleanupDirs.push(rendered)
  // columns:2 so the whole rendered config fits the viewport — a full-page
  // screenshot only captures what's above the fold.
  await renderTextInBrowser(I, readRendered('.config/renovate/config.json').trimEnd(), { columns: 2 })
  await addStoryboardFrame(I, await capturePageFrame(I, 'contract-config'))
})

storyboardStep(When, 'the config passes the real renovate validator', async () => {
  renovateResult = runRenovateValidator(rendered)
  if (renovateResult.exitCode !== 0 || !renovateResult.output.includes('Config validated successfully')) {
    throw new Error(`Expected renovate validation to succeed, exit=${renovateResult.exitCode}\n${renovateResult.output}`)
  }
  await renderPreFrame(I, 'contract-validate-default', validatorVerdictLines(renovateResult.output))
})

storyboardStep(Then, 'turning automerge off still passes the same validator', async () => {
  const dir = renderProject(parseAnswers('devsecops_automerge=false'))
  cleanupDirs.push(dir)
  const result = runRenovateValidator(dir)
  if (result.exitCode !== 0 || !result.output.includes('Config validated successfully')) {
    throw new Error(`Expected renovate validation to succeed, exit=${result.exitCode}\n${result.output}`)
  }
  await renderPreFrame(I, 'contract-validate-automerge-off', validatorVerdictLines(result.output))
})

// Copier refuses this template without --trust (it declares tasks). Renovate's
// copier manager only adds --trust when BOTH the run allows scripts (allowScripts,
// a self-hosted option, exported by `task renovate`) AND the project's config opts
// in (ignoreScripts: false). allowedCommands is self-hosted as well: written in
// the project config it was silently ignored, so the postUpgradeTasks fallback
// never ran either. Proof reads Renovate's own debug "Env config" block — the
// global config it resolved from the framework's real entrypoint — plus the
// rendered project config.
// The task sets LOG_LEVEL itself from TASK_RENOVATE_LOG_LEVEL, so the level is a task variable, not a shell export.
const DEBUG_EXTRACT_CMD = 'task renovate:dry-run TASK_RENOVATE_DRY_RUN=extract TASK_RENOVATE_LOG_LEVEL=debug'

function renovateEnvConfig (dir, gitEnv) {
  let raw
  try {
    raw = execSync(`${DEBUG_EXTRACT_CMD} 2>&1`, {
      cwd: dir, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000, maxBuffer: 256 * 1024 * 1024
    })
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '')
  }
  const lines = stripAnsiEscapeSequences(raw).split('\n')
  const start = lines.findIndex(l => l.includes('DEBUG: Env config'))
  const end = lines.findIndex((l, i) => i > start && /DEBUG: /.test(l))
  return start < 0 ? '' : lines.slice(start, end < 0 ? undefined : end).join('\n')
}

storyboardStep(Then, 'a generated project lets Renovate run Copier with --trust', async () => {
  const dir = renderProject()
  cleanupDirs.push(dir)
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.config/renovate/config.json'), 'utf8'))
  const rule = (config.packageRules || []).find(r => JSON.stringify(r).includes('DevSecOps Toolbox'))
  if (!rule) throw new Error('No packageRules entry matching "DevSecOps Toolbox" in the rendered renovate config')
  if (rule.ignoreScripts !== false) {
    throw new Error('The toolbox rule must set "ignoreScripts": false — without it Renovate never passes --trust to Copier')
  }
  if ('allowedCommands' in config) {
    throw new Error('allowedCommands is a self-hosted option: Renovate ignores it in a project config, it belongs to the run (task renovate)')
  }
  const gitEnv = isolatedGitEnv(dir)
  execSync('git init -q && git add -A && git commit -qm "pristine"', { cwd: dir, env: gitEnv })
  const envConfig = renovateEnvConfig(dir, gitEnv)
  renovateEnv = envConfig
  if (!/"allowScripts":\s*true/.test(envConfig)) {
    throw new Error(`task renovate must export allowScripts=true, Renovate resolved:\n${envConfig}`)
  }
  if (!/"allowedCommands":\s*\[[^\]]*devsecops:code:sync-templates[^\]]*\]/.test(envConfig)) {
    throw new Error(`task renovate must export allowedCommands covering task devsecops:code:sync-templates, Renovate resolved:\n${envConfig}`)
  }
  await renderPreFrame(I, 'contract-copier-trust', [
    'project config (toolbox rule)  ignoreScripts: false   -> Copier runs with --trust',
    'project config                 allowedCommands: absent (self-hosted option)',
    'task renovate, as Renovate resolved it:',
    envConfig
  ].join('\n'))
})

// Renovate hands a post-upgrade command to its own executor, which splits it
// with shlex and starts the first word with shell: false (the default of
// allowShellExecutorForPostUpgradeCommands), under a short list of inherited
// variables. The same code runs it here, from the Renovate the test image
// pins, so a command that only works in a shell fails here as it does there.
async function renovateInternals () {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
  const load = file => import(pathToFileURL(path.join(root, 'renovate/dist', file)).href)
  const [{ rawExec }, { getChildProcessEnv }, { regEx }] = await Promise.all([
    load('util/exec/common.js'), load('util/exec/env.js'), load('util/regex.js')
  ])
  return { rawExec, getChildProcessEnv, regEx }
}

// What stays on the card: git clean naming what it removed, and the task's own
// start and end lines. Copier's file-by-file report and uv's download lines
// carry versions and timings, and go to stderr anyway.
const POST_UPGRADE_LINES = [/^Removing /, /^🔄 /, /^🎉 /]

storyboardStep(Then, "Renovate's post-upgrade command runs without a shell and brings the new release in", async () => {
  const tpl = prepareVersionedTemplate()
  cleanupDirs.push(tpl)
  const dir = renderProjectFromTemplate(tpl, '1.0.0')
  cleanupDirs.push(dir)
  // What Renovate's own Copier run leaves in the branch for 1.0.1, working from
  // .config/devsecops/: the version line bumped, a stray VERSION, nothing else.
  const answers = path.join(dir, '.config/devsecops/.copier-answers.yml')
  fs.writeFileSync(answers, fs.readFileSync(answers, 'utf8').replace(/^_commit: 1\.0\.0$/m, '_commit: 1.0.1'))
  fs.writeFileSync(path.join(dir, '.config/devsecops/VERSION'), '0.1.0\n')

  const config = JSON.parse(fs.readFileSync(path.join(dir, '.config/renovate/config.json'), 'utf8'))
  const rule = (config.packageRules || []).find(r => JSON.stringify(r).includes('DevSecOps Toolbox'))
  const commands = ((rule || {}).postUpgradeTasks || {}).commands || []
  if (commands.length === 0) throw new Error('The toolbox rule carries no postUpgradeTasks command')
  const allowed = JSON.parse((renovateEnv.match(/"allowedCommands":\s*(\[[^\]]*\])/) || [])[1] || '[]')

  const { rawExec, getChildProcessEnv, regEx } = await renovateInternals()
  const shown = []
  for (const cmd of commands) {
    const compiled = cmd.replace('{{{newVersion}}}', '1.0.1')
    // Twin: Renovate skips a command no allowedCommands pattern matches, and
    // reports it as an artifact error.
    if (!allowed.some(pattern => regEx(pattern).test(compiled))) {
      throw new Error(`Renovate would refuse "${compiled}": no allowedCommands pattern matches it. Resolved: ${JSON.stringify(allowed)}`)
    }
    let run
    try {
      run = await rawExec(compiled, { shell: false, cwd: dir, env: getChildProcessEnv(), encoding: 'utf-8' })
    } catch (e) {
      throw new Error(`Renovate's post-upgrade command failed without a shell, exit=${e.exitCode}\n$ ${compiled}\n${e.stderr || e.message}`)
    }
    shown.push(`$ ${compiled}`, ...run.stdout.split('\n').map(l => l.trim()).filter(l => POST_UPGRADE_LINES.some(re => re.test(l))))
  }

  // Twins: the stray file is gone, and the release really landed.
  if (fs.existsSync(path.join(dir, '.config/devsecops/VERSION'))) {
    throw new Error('The stray .config/devsecops/VERSION Renovate left behind is still there')
  }
  if (!/^_commit: 1\.0\.1$/m.test(fs.readFileSync(answers, 'utf8'))) {
    throw new Error('Expected the answers file to record release 1.0.1 after the update')
  }
  if (!fs.readFileSync(path.join(dir, UPDATE_MARKER_FILE), 'utf8').includes(UPDATE_MARKER)) {
    throw new Error(`Expected release 1.0.1's change (${UPDATE_MARKER} in ${UPDATE_MARKER_FILE}) in the project`)
  }
  const status = execSync('git status --short', { cwd: dir, encoding: 'utf8' }).trimEnd()
  await renderPreFrame(I, 'contract-post-upgrade', [...shown, '', '$ git status --short', status].join('\n'))
})

storyboardStep(Then, "a downstream project's renovate ignores stale framework-owned .config drift", async () => {
  const dir = renderProject()
  cleanupDirs.push(dir)
  rendered = dir
  downgradeConfigAndExtract(dir)
  const frameworkOwned = lastExtract.packageFiles
    .filter(f => f.startsWith('.config/') && f !== '.config/devsecops/.copier-answers.yml')
  if (frameworkOwned.length) {
    throw new Error(`Downstream Renovate scanned framework-owned .config files: ${frameworkOwned.join(', ')}`)
  }
  await renderColorFrame('contract-downstream-ignores', `$ ${EXTRACT_CMD}\n${extractionSummary(lastExtract.output)}`)
})

storyboardStep(Then, "a downstream project's renovate tracks its own outdated project dependency", async () => {
  const dir = renderProject()
  cleanupDirs.push(dir)
  rendered = dir
  const gitEnv = isolatedGitEnv(dir)
  fs.writeFileSync(renderedPath('project/Dockerfile'), 'FROM node:18.0.0\n')
  execSync('git init -q && git add -A && git commit -qm "add outdated project dependency"', { cwd: dir, env: gitEnv })
  lastExtract = runRenovateExtract(dir, gitEnv)
  if (!lastExtract.packageFiles.includes('project/Dockerfile')) {
    throw new Error(`Downstream Renovate did not detect the project/ dependency; scanned: ${lastExtract.packageFiles.join(', ') || 'nothing'}`)
  }
  await renderColorFrame('contract-downstream-tracks', `$ ${EXTRACT_CMD}\n${extractionSummary(lastExtract.output)}`)
})

storyboardStep(Then, "the framework repo's own renovate detects that same stale .config drift", async () => {
  frameworkDir = frameworkCheckout()
  downgradeConfigAndExtract(frameworkDir)
  const configDetected = lastExtract.packageFiles
    .filter(f => f.startsWith('.config/') && f !== '.config/devsecops/.copier-answers.yml')
  if (!configDetected.length) {
    throw new Error(`Framework Renovate detected no .config update; scanned: ${lastExtract.packageFiles.join(', ') || 'nothing'}`)
  }
  await renderColorFrame('contract-framework-tracks', `$ ${EXTRACT_CMD}\n${extractionSummary(lastExtract.output)}`)
})

// ============================================
// Render-matrix storyboard — @render-matrix (chapters 1 + 2).
// Absorbs the 8 former flat
// @e2e-template-matrix-* scenarios: the anchor tells the default render as
// one journey (its full tree, then the manifests every FS assert below used
// to prove in isolation); the second tells what EACH non-default Copier
// answer changes, one card per answer, each still paired with its original
// FS assert. Every listing/grep shown is the REAL command run against the
// real render — no composed output.
// ============================================

// Run `cmd` inside `dir` and return its REAL combined stdout+stderr, trimmed —
// including a failing `ls`'s own "No such file or directory", which is exactly
// the telling half of a render diff (what disappeared).
function runCaptured (cmd, dir) {
  try {
    return execSync(`${cmd} 2>&1`, { cwd: dir, encoding: 'utf8' }).trimEnd()
  } catch (e) {
    return `${e.stdout || ''}${e.stderr || ''}`.trimEnd()
  }
}

async function captureRenderedTree (frameName) {
  const listing = execSync('echo "$ ls -1A"; ls -1A; echo; echo "$ ls -1A .config"; ls -1A .config', {
    cwd: rendered,
    encoding: 'utf8'
  })
  await renderTextInBrowser(I, listing.trimEnd(), { columns: 2 })
  await addStoryboardFrame(I, await capturePageFrame(I, frameName))
}

storyboardStep(Given, 'a project is rendered from the working-branch template with every default Copier answer', async () => {
  rendered = renderProject()
  cleanupDirs.push(rendered)
  await renderPreFrame(I, 'defaults-answers', `$ cat .config/devsecops/.copier-answers.yml\n${readRendered('.config/devsecops/.copier-answers.yml').trimEnd()}`)
})

storyboardStep(Then, 'the rendered tree delivers the canonical docker, compose and project layout', async () => {
  await captureRenderedTree('defaults-tree')
  if (!fs.existsSync(renderedPath('project/Taskfile.yml'))) throw new Error('Expected project/Taskfile.yml to exist')
  if (!fs.existsSync(renderedPath('.config/docker-ce/Taskfile.yml'))) throw new Error('Expected .config/docker-ce/Taskfile.yml to exist')
  if (fs.existsSync(renderedPath('.config/podman'))) throw new Error('Expected .config/podman to NOT exist')
  if (fs.existsSync(renderedPath('.config/ansible'))) throw new Error('Expected .config/ansible to NOT exist')
  if (!fs.existsSync(renderedPath('project/docker-compose.yml'))) throw new Error('Expected project/docker-compose.yml to exist')
  if (!readRendered('project/docker-compose.yml').includes('networks:')) throw new Error('Expected project/docker-compose.yml to contain "networks:"')
})

storyboardStep(Then, 'the root Taskfile wires in the default docker-ce and compose toolchain', async () => {
  const content = readRendered('Taskfile.yml')
  const grepped = runCaptured('grep -E "docker-ce|project/Taskfile|podman" Taskfile.yml', rendered)
  await renderPreFrame(I, 'defaults-taskfile', `$ grep -E "docker-ce|project/Taskfile|podman" Taskfile.yml\n${grepped}`)
  if (!content.includes('.config/docker-ce/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to reference ".config/docker-ce/Taskfile.yml"')
  if (!content.includes('project/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to reference "project/Taskfile.yml"')
  if (content.includes('.config/podman/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to NOT reference ".config/podman/Taskfile.yml"')
})

storyboardStep(Then, 'the CI pipeline ships the default docker-in-docker variables and release gate', async () => {
  const ciVars = readRendered('.config/gitlab/ci/variables.yml')
  const release = readRendered('.config/gitlab/ci/devsecops/release.yml')
  const ciOut = runCaptured('grep DOCKER_HOST .config/gitlab/ci/variables.yml', rendered)
  const releaseOut = runCaptured('grep after_script: .config/gitlab/ci/devsecops/release.yml', rendered)
  await renderPreFrame(I, 'defaults-ci', `$ grep DOCKER_HOST .config/gitlab/ci/variables.yml\n${ciOut}\n\n$ grep after_script: .config/gitlab/ci/devsecops/release.yml\n${releaseOut}`)
  if (!ciVars.includes('DOCKER_HOST: tcp://docker:2376')) throw new Error('Expected rendered CI variables to contain "DOCKER_HOST: tcp://docker:2376"')
  if (!release.includes('after_script:')) throw new Error('Expected .config/gitlab/ci/devsecops/release.yml to contain "after_script:"')
})

storyboardStep(Then, "the project's own governance and language config are delivered", async () => {
  const testsStructure = readRendered('.agent/rules/tests-structure.md')
  const gherkinOut = runCaptured('grep "Gherkin in" .agent/rules/tests-structure.md', rendered)
  const rule = toolboxPackageRule()
  await renderPreFrame(I, 'defaults-governance', `$ grep "Gherkin in" .agent/rules/tests-structure.md\n${gherkinOut}\n\n$ automerge rule (.config/renovate/config.json)\n${JSON.stringify({ automerge: rule.automerge, automergeStrategy: rule.automergeStrategy }, null, 2)}`)
  if (!fs.existsSync(renderedPath('.config/devsecops/.copier-answers.yml'))) throw new Error('Expected .config/devsecops/.copier-answers.yml to exist')
  if (!testsStructure.includes('Gherkin in **en**')) throw new Error('Expected .agent/rules/tests-structure.md to contain "Gherkin in **en**"')
  JSON.parse(readRendered('.config/renovate/config.json'))
  if (rule.automerge !== true || rule.automergeStrategy !== 'fast-forward') throw new Error(`Expected toolbox package rule to enable fast-forward automerge, got: ${JSON.stringify(rule)}`)
})

storyboardStep(Given, 'the default answers render docker-ce, compose and English as the baseline', async () => {
  rendered = renderProject()
  cleanupDirs.push(rendered)
  const lsOut = runCaptured('ls .config/docker-ce/Taskfile.yml project/docker-compose.yml', rendered)
  const grepOut = runCaptured('grep "Gherkin in" .agent/rules/tests-structure.md', rendered)
  await renderPreFrame(I, 'answers-baseline', `$ ls .config/docker-ce/Taskfile.yml project/docker-compose.yml\n${lsOut}\n\n$ grep "Gherkin in" .agent/rules/tests-structure.md\n${grepOut}`)
  if (!fs.existsSync(renderedPath('.config/docker-ce/Taskfile.yml'))) throw new Error('Expected the baseline render to deliver .config/docker-ce/Taskfile.yml')
  if (!fs.existsSync(renderedPath('project/docker-compose.yml'))) throw new Error('Expected the baseline render to deliver project/docker-compose.yml')
})

storyboardStep(Then, 'choosing podman as the runtime replaces docker-ce and compose with podman config', async () => {
  rendered = renderProject(parseAnswers('container_runtime=podman'))
  cleanupDirs.push(rendered)
  const diff = runCaptured('ls .config/podman/Taskfile.yml .config/docker-ce project/docker-compose.yml', rendered)
  await renderPreFrame(I, 'answers-podman', `$ ls .config/podman/Taskfile.yml .config/docker-ce project/docker-compose.yml\n${diff}`)
  if (!fs.existsSync(renderedPath('.config/podman/Taskfile.yml'))) throw new Error('Expected .config/podman/Taskfile.yml to exist')
  if (fs.existsSync(renderedPath('.config/docker-ce'))) throw new Error('Expected .config/docker-ce to NOT exist')
  if (fs.existsSync(renderedPath('project/docker-compose.yml'))) throw new Error('Expected project/docker-compose.yml to NOT exist')
  const content = readRendered('Taskfile.yml')
  if (!content.includes('.config/podman/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to reference ".config/podman/Taskfile.yml"')
  if (content.includes('.config/docker-ce/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to NOT reference ".config/docker-ce/Taskfile.yml"')
})

storyboardStep(Then, 'turning off docker compose drops the compose file but keeps docker-ce', async () => {
  rendered = renderProject(parseAnswers('use_docker_compose=false'))
  cleanupDirs.push(rendered)
  const diff = runCaptured('ls project/docker-compose.yml .config/docker-ce/Taskfile.yml', rendered)
  await renderPreFrame(I, 'answers-no-compose', `$ ls project/docker-compose.yml .config/docker-ce/Taskfile.yml\n${diff}`)
  if (fs.existsSync(renderedPath('project/docker-compose.yml'))) throw new Error('Expected project/docker-compose.yml to NOT exist')
  if (!fs.existsSync(renderedPath('.config/docker-ce/Taskfile.yml'))) throw new Error('Expected .config/docker-ce/Taskfile.yml to exist')
})

storyboardStep(Then, 'turning on Ansible delivers its config and lint tooling', async () => {
  rendered = renderProject(parseAnswers('ansible_enabled=true'))
  cleanupDirs.push(rendered)
  const diff = runCaptured('ls .config/ansible/Taskfile.yml .config/ansible-lint', rendered)
  await renderPreFrame(I, 'answers-ansible', `$ ls .config/ansible/Taskfile.yml .config/ansible-lint\n${diff}`)
  if (!fs.existsSync(renderedPath('.config/ansible/Taskfile.yml'))) throw new Error('Expected .config/ansible/Taskfile.yml to exist')
  if (!fs.existsSync(renderedPath('.config/ansible-lint'))) throw new Error('Expected .config/ansible-lint to exist')
  if (!readRendered('Taskfile.yml').includes('.config/ansible/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to reference ".config/ansible/Taskfile.yml"')
})

storyboardStep(Then, 'choosing a self-hosted CI platform changes the docker-in-docker variables', async () => {
  rendered = renderProject(parseAnswers('ci_platform=gitlab_self_hosted gitlab_docker_host= gitlab_docker_tls_certdir='))
  cleanupDirs.push(rendered)
  const diff = runCaptured('grep -E "DOCKER_HOST|DOCKER_TLS_CERTDIR" .config/gitlab/ci/variables.yml', rendered)
  await renderPreFrame(I, 'answers-self-hosted', `$ grep -E "DOCKER_HOST|DOCKER_TLS_CERTDIR" .config/gitlab/ci/variables.yml\n${diff}`)
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (content.includes('DOCKER_HOST: tcp://docker:2376')) throw new Error('Expected rendered CI variables to NOT contain "DOCKER_HOST: tcp://docker:2376"')
  if (!content.includes('DOCKER_TLS_CERTDIR: ""')) throw new Error('Expected rendered CI variables to set DOCKER_TLS_CERTDIR to an empty value')
})

storyboardStep(Then, 'turning off project mode removes the project directory entirely', async () => {
  rendered = renderProject(parseAnswers('project_enabled=false'))
  cleanupDirs.push(rendered)
  const diff = runCaptured('ls project', rendered)
  await renderPreFrame(I, 'answers-no-project', `$ ls project\n${diff}`)
  if (fs.existsSync(renderedPath('project'))) throw new Error('Expected "project" to NOT exist')
  if (readRendered('Taskfile.yml').includes('project/Taskfile.yml')) throw new Error('Expected the rendered root Taskfile to NOT reference "project/Taskfile.yml"')
})

storyboardStep(Then, 'turning off automerge removes the fast-forward rule from the renovate config', async () => {
  rendered = renderProject(parseAnswers('devsecops_automerge=false'))
  cleanupDirs.push(rendered)
  const rule = toolboxPackageRule()
  // Show only what the sentence is about: the match is kept, every automerge
  // key is gone. Dumping the whole rule buries that under a wall of
  // postUpgradeTasks commands.
  const automergeKeys = ['automerge', 'automergeStrategy', 'automergeType', 'platformAutomerge'].filter(k => k in rule)
  await renderPreFrame(I, 'answers-automerge-off',
    '$ toolbox package rule (.config/renovate/config.json)\n' +
    `matchManagers  : ${JSON.stringify(rule.matchManagers)}\n` +
    `matchFileNames : ${JSON.stringify(rule.matchFileNames)}\n` +
    `automerge keys : ${automergeKeys.length ? automergeKeys.join(', ') : '(none — the fast-forward rule is gone)'}`)
  JSON.parse(readRendered('.config/renovate/config.json'))
  if ('automerge' in rule || 'automergeStrategy' in rule || 'automergeType' in rule || 'platformAutomerge' in rule) {
    throw new Error(`Expected toolbox package rule to NOT carry automerge properties, got: ${JSON.stringify(rule)}`)
  }
})

storyboardStep(Then, 'choosing French Gherkin changes the language rule for generated tests', async () => {
  rendered = renderProject(parseAnswers('gherkin_language=fr'))
  cleanupDirs.push(rendered)
  const diff = runCaptured('grep "Gherkin in" .agent/rules/tests-structure.md', rendered)
  await renderPreFrame(I, 'answers-gherkin-fr', `$ grep "Gherkin in" .agent/rules/tests-structure.md\n${diff}`)
  if (!readRendered('.agent/rules/tests-structure.md').includes('Gherkin in **fr**')) throw new Error('Expected .agent/rules/tests-structure.md to contain "Gherkin in **fr**"')
})

// ============================================
// Toolbox-update options storyboard — @toolbox-update (chapter 2).
// The render-side twin of the live journey: re-running `copier update` with a
// FLIPPED answer (Ansible on) delivers the release's brand-new tooling, while a
// file the developer hand-edited (a copier skip-if-exists "keep my file") is left
// exactly as they wrote it. ONE sentence = ONE <pre> frame = ONE pixel baseline,
// each twinned with a filesystem assert. Absorbs the former flat
// @e2e-copier-update-option-flip and @e2e-copier-update-skip-if-exists scenarios.
// ============================================

const CUSTOM_TASKFILE = 'project/Taskfile.yml'
const CUSTOM_MARKER = '# CUSTOM-TASKFILE-MARKER'

function tailLines (text, n) {
  return text.replace(/\n+$/, '').split('\n').slice(-n).join('\n')
}

// Just the ansible slice of the .config listing — the whole point of the flip.
// A full `ls -1A .config` is ~40 rows that differ by exactly two lines before
// and after; the reader can't spot the delta. grep returns 1 (no match) before
// the flip — caught and shown as an explicit "(no ansible entry)".
function ansibleEntries () {
  try {
    return execSync('ls -1A .config | grep ansible', { cwd: rendered, encoding: 'utf8' }).trimEnd()
  } catch (_) {
    return '(no ansible entry)'
  }
}

storyboardStep(Given, "a project generated from an earlier toolbox release carries the developer's own edit", async () => {
  template = prepareVersionedTemplate()
  cleanupDirs.push(template)
  rendered = renderProjectFromTemplate(template, '1.0.0')
  cleanupDirs.push(rendered)
  fs.appendFileSync(renderedPath(CUSTOM_TASKFILE), `\n${CUSTOM_MARKER}\n`)
  execSync('git add -A && git commit --quiet --no-verify -m "test: customize skip-if-exists file"', { cwd: rendered })
  await renderPreFrame(I, 'options-custom-edit', `$ tail -4 ${CUSTOM_TASKFILE}\n${tailLines(readRendered(CUSTOM_TASKFILE), 4)}`)
  if (!readRendered(CUSTOM_TASKFILE).includes(CUSTOM_MARKER)) {
    throw new Error(`Setup failed: ${CUSTOM_TASKFILE} does not carry the custom marker`)
  }
})

storyboardStep(Given, 'the project has no Ansible configuration yet', async () => {
  await renderPreFrame(I, 'options-no-ansible', `$ ls -1A .config | grep ansible\n${ansibleEntries()}`)
  if (fs.existsSync(renderedPath('.config/ansible'))) {
    throw new Error('Expected no .config/ansible before the flipped update')
  }
})

storyboardStep(When, 'the developer re-runs the toolbox update and turns the Ansible option on', async () => {
  updateProject(rendered, '1.0.1', { ansible_enabled: 'true' })
  await renderPreFrame(I, 'options-ansible-on', `$ ls -1A .config | grep ansible\n${ansibleEntries()}`)
  if (!fs.existsSync(renderedPath('.config/ansible'))) {
    throw new Error('Expected .config/ansible after the flipped update')
  }
})

storyboardStep(Then, 'the new Ansible tooling is delivered by the update', async () => {
  const listing = execSync('ls -1A .config/ansible .config/ansible-lint', { cwd: rendered, encoding: 'utf8' }).trimEnd()
  await renderPreFrame(I, 'options-ansible-delivered', `$ ls -1A .config/ansible .config/ansible-lint\n${listing}`)
  if (!fs.existsSync(renderedPath('.config/ansible/Taskfile.yml'))) {
    throw new Error('Expected .config/ansible/Taskfile.yml to be delivered')
  }
  if (!fs.existsSync(renderedPath('.config/ansible-lint'))) {
    throw new Error('Expected .config/ansible-lint to be delivered')
  }
  if (!readRendered('Taskfile.yml').includes('.config/ansible/Taskfile.yml')) {
    throw new Error('Expected the root Taskfile to reference .config/ansible/Taskfile.yml')
  }
  // The 1.0.1 release also carried an unrelated template change (the update
  // marker) — proof that new framework content lands, not only the flipped option.
  if (!readRendered(UPDATE_MARKER_FILE).includes(UPDATE_MARKER)) {
    throw new Error(`Expected the update to apply the template change (${UPDATE_MARKER} in ${UPDATE_MARKER_FILE})`)
  }
})

storyboardStep(Then, "the developer's own edit survived the update untouched", async () => {
  await renderPreFrame(I, 'options-edit-survived', `$ tail -4 ${CUSTOM_TASKFILE}\n${tailLines(readRendered(CUSTOM_TASKFILE), 4)}`)
  if (!readRendered(CUSTOM_TASKFILE).includes(CUSTOM_MARKER)) {
    throw new Error(`Expected ${CUSTOM_TASKFILE} to still contain the custom marker after the update`)
  }
})
