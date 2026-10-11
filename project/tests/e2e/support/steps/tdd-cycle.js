/* global inject Given When Then After */
// cspell:ignore greting
/**
 * Storyboards of features/02-daily-work/tdd-cycle.feature: the toolbox checks
 * the proof its method asks for, on a throwaway copy of the framework, with the
 * framework's own engine, configuration and JUnit reporter.
 *
 * Every terminal card is a real ttyd terminal opened in THIS container (see
 * helpers/localTerminal.js): the nested engine and the local gates live here,
 * and nowhere else. One line is typed on camera, and the whole screen it leaves
 * is the card. The wrapping `task project:test:e2e` cannot run here (it drives
 * this very container), so the cards type the line it ends on, read from its
 * own preview (frameworkCopy.engineCommand).
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); every card is twinned with a check of the same fact (report on
 * disk, exit code, verdict text).
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { copyFrameworkWithEngine, engineCommand } = require('../helpers/frameworkCopy')
const { renderProject } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { ENGINE_MASKS, openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// A terminal card with the engine's volatile fields masked; returns the screen
// text for the twin.
const card = (frame, line, mask = []) => terminalCard(I, frame, line, { mask: [...ENGINE_MASKS, ...mask] })

// The suite's own switches must not reach a nested run: a nested engine that
// inherits TASK_E2E_UPDATE_BASELINES=1 rewrites its references instead of
// comparing them.
function nestedEnv (extra = {}) {
  const env = { ...process.env, ...extra }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete env[name]
  return env
}

// The runs these stories start load the copy's step files, this one among them,
// so an unguarded hook would fire inside the nested run and delete the very
// fixture that run is using. Every hook here answers to its own scenario only.
const owns = (test, tag) => Boolean(test && test.tags && test.tags.includes(tag))

// ===========================================================================
// @tdd-cycle: a crash is not a proof, a real failure is, and only the latest
// run counts.
// ===========================================================================

// Fixed path, not a mkdtemp: it appears verbatim in the error the engine prints
// (the require stack) and in the prompt.
const FIXTURE = '/tmp/e2e-tdd-cycle'
const TAG = '@greeting'
const TYPO = '@greting'
const FEATURE = 'project/tests/e2e/features/02-daily-work/greeting.feature'
const STEPS = 'project/tests/e2e/support/steps/greeting.js'
const HELPER = 'project/tests/e2e/support/helpers/greeting.js'
const CONFIG = 'project/tests/e2e/codecept.conf.js'
const JUNIT_DIR = 'project/tests/e2e/_output/junit'
const GATE = `task devsecops:test:check:red-is-real -- ${TAG}`
const VERIFY = 'task devsecops:test:verify'
// The guard alone, on the working tree. Not `verify`: if the guard let a cheat
// through, verify would go on to start the whole suite inside this container.
const GUARD = 'task devsecops:test:check:no-cheat BASE=HEAD'

// Blob ids and the line where the configuration's hunk starts move with any
// unrelated edit of those files; what the diff says does not.
const DIFF_MASKS = [
  [/\bindex [0-9a-f]{7,}\.\.[0-9a-f]{7,}/g, 'index <sha>..<sha>'],
  [/^@@ -[1-9]\d*,(\d+) \+[1-9]\d*,(\d+) @@/g, '@@ -<line>,$1 +<line>,$2 @@']
]

const FEATURE_BODY = `@e2e
Feature: A toolbox that says hello
  @greeting
  Scenario: it greets the developer by name
    Then the toolbox greets the developer by name
`

// The step file as it is written FIRST: it already asks for the helper that
// reads the greeting, and that helper does not exist yet. Requiring a missing
// module at load time is what kills the whole run before any scenario.
const STEPS_BODY = `/* global Then */
const { greeting } = require('../helpers/greeting')

Then('the toolbox greets the developer by name', () => {
  const actual = greeting('Lambda')
  if (actual !== 'Hello, Lambda') {
    throw new Error(\`expected 'Hello, Lambda', got '\${actual}'\`)
  }
})
`

// The missing helper, written in chapter 2 and nothing else: it reads the
// greeting from the file that would hold it. Nothing writes that file, so there
// is no greeting yet and the scenario fails on its own check.
const HELPER_BODY = `const fs = require('fs')
const path = require('path')

// project/tests/e2e/support/helpers -> the repository root.
const GREETING_FILE = path.join(__dirname, '../../../../../GREETING')

module.exports.greeting = (name) => {
  if (!fs.existsSync(GREETING_FILE)) return ''
  return fs.readFileSync(GREETING_FILE, 'utf8').trim().replace('{name}', name)
}
`

let tdd = null

function tddRun (cmd) {
  try {
    return { output: execSync(`${cmd} 2>&1`, { cwd: FIXTURE, env: tdd.env, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 }), code: 0 }
  } catch (e) {
    return { output: String(e.stdout || ''), code: e.status == null ? 1 : e.status }
  }
}

// The same line on the refused and the accepted card, so the reader compares
// two pictures of one thing: what git sees, the run, its exit code, the report
// folder, and the toolbox's verdict on that run.
const proofLine = (run) => `git status --short; ${run}; echo "exit code $?"; ls ${JUNIT_DIR}; ${GATE}`

After(async (test) => {
  if (!owns(test, '@tdd-cycle')) return
  if (tdd && tdd.closeTerminal) tdd.closeTerminal()
  for (const leftover of [FIXTURE, `${FIXTURE}.gitconfig`]) fs.rmSync(leftover, { recursive: true, force: true })
  tdd = null
})

// ---------------------------------------------------------------------------
// Chapter 1: a failure that proves nothing
// ---------------------------------------------------------------------------

storyboardStep(Given, 'a developer writes the test for a greeting the toolbox cannot give yet', async () => {
  copyFrameworkWithEngine(FIXTURE)
  // The tar keeps the host uid, so git would refuse "dubious ownership". An
  // isolated global config never touches the shared ~/.gitconfig. It lives
  // OUTSIDE the copy: the no-cheat gate of chapter 4 reads this working tree,
  // and a stray file at its root would be a change the developer never made.
  const gitConfig = `${FIXTURE}.gitconfig`
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  tdd = { env: nestedEnv({ GIT_CONFIG_GLOBAL: gitConfig }) }
  execSync('git init -q && git add -A && git commit -qm "the toolbox as it stands"', { cwd: FIXTURE, env: tdd.env })

  fs.writeFileSync(path.join(FIXTURE, FEATURE), FEATURE_BODY)
  fs.writeFileSync(path.join(FIXTURE, STEPS), STEPS_BODY)
  // Every step file is listed in the suite's configuration and required at
  // start-up, which is why one file that cannot load takes the whole run down.
  const conf = path.join(FIXTURE, CONFIG)
  fs.writeFileSync(conf, fs.readFileSync(conf, 'utf8').replace(
    "      './support/steps/init-baseline.js',",
    "      './support/steps/greeting.js',\n      './support/steps/init-baseline.js',"
  ))
  // One worker, so the one scenario's record is always results-1.xml, and the
  // one feature file, as a CI shard narrows its run: without it the engine
  // walks every feature of the repository and prints a block for each.
  const features = 'TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature'
  tdd.run = `${features} ${engineCommand(FIXTURE, tdd.env, { args: `--grep ${TAG}` })}`
  tdd.typo = `${features} ${engineCommand(FIXTURE, tdd.env, { args: `--grep ${TYPO}` })}`

  // Tall: the real failure prints its report twice (the worker's, then the
  // run's), and the card holds the whole run.
  tdd.closeTerminal = await openLocalTerminal(I, { cwd: FIXTURE, env: tdd.env, port: 7690, height: 1500 })
  const screen = await card('the-test-comes-first', 'git add -N . && git diff', DIFF_MASKS)
  for (const said of ["const { greeting } = require('../helpers/greeting')", "+      './support/steps/greeting.js',", '+  @greeting']) {
    assert.ok(screen.includes(said), `Expected the diff to show ${said}:\n${screen}`)
  }
  const changed = execSync('git diff --name-only', { cwd: FIXTURE, env: tdd.env, encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(changed, [CONFIG, FEATURE, STEPS], 'The developer wrote the test and registered it, nothing else')
})

storyboardStep(Then, 'the run dies on its way to the test, exits like a failed test, and the toolbox refuses to call that a proof', async () => {
  const screen = await card('crash-is-no-proof', proofLine(tdd.run))
  for (const said of ["Error: Cannot find module '../helpers/greeting'", 'Worker completion: FAIL (0/1 selected scenarios)',
    'exit code 1', 'No such file or directory', 'The run left no report at all',
    'Failed to run task "devsecops:test:check:red-is-real"']) {
    assert.ok(screen.includes(said), `Expected the crash card to show "${said}":\n${screen}`)
  }
  assert.equal(fs.existsSync(path.join(FIXTURE, JUNIT_DIR)), false, 'A run that died while loading its files must leave NO report at all')
})

// ---------------------------------------------------------------------------
// Chapter 2: a failure that proves something
// ---------------------------------------------------------------------------

storyboardStep(When, 'the developer writes the missing helper, the test fails on its own check, and the toolbox accepts that failure as proof', async () => {
  fs.writeFileSync(path.join(FIXTURE, HELPER), HELPER_BODY)
  const screen = await card('real-failure-is-proof', proofLine(tdd.run))
  for (const said of [HELPER, "expected 'Hello, Lambda', got ''", 'Worker completion: FAIL (0/1 selected scenarios)',
    'exit code 1', 'results-1.xml', 'The failure is real: the scenario ran and failed on its own check.']) {
    assert.ok(screen.includes(said), `Expected the real-failure card to show "${said}":\n${screen}`)
  }
  const xml = fs.readFileSync(path.join(FIXTURE, JUNIT_DIR, 'results-1.xml'), 'utf8')
  assert.ok(xml.includes(TAG) && xml.includes('<failure'), `The report must hold the ${TAG} scenario and its failure:\n${xml}`)
  const gate = tddRun(GATE)
  assert.equal(gate.code, 0, `The gate must accept the real failure:\n${gate.output}`)
})

// ---------------------------------------------------------------------------
// Chapter 3: yesterday's proof does not count
// ---------------------------------------------------------------------------

storyboardStep(Then, 'a run that selects no scenario wipes that report, and the toolbox refuses the old failure', async () => {
  const screen = await card('stale-proof-refused', `ls ${JUNIT_DIR}; ${tdd.typo}; echo "exit code $?"; ls ${JUNIT_DIR}; ${GATE}`)
  for (const said of ['results-1.xml', 'No Gherkin scenario matches this selection', 'exit code 1',
    'No such file or directory', 'The run left no report at all']) {
    assert.ok(screen.includes(said), `Expected the stale-proof card to show "${said}":\n${screen}`)
  }
  assert.equal(fs.existsSync(path.join(FIXTURE, JUNIT_DIR)), false, 'A run that selects nothing must leave no earlier report behind')

  // The twin with no card: a run whose configuration crashes before it can
  // select anything clears the earlier report too. workerCompletion.js clears
  // the reports BEFORE loading the configuration, which is the whole point.
  const seeded = tddRun(tdd.run)
  assert.ok(fs.existsSync(path.join(FIXTURE, JUNIT_DIR, 'results-1.xml')), `The re-run must record the failure again:\n${seeded.output}`)
  const conf = path.join(FIXTURE, CONFIG)
  const original = fs.readFileSync(conf, 'utf8')
  fs.appendFileSync(conf, '\nthrow new Error("Freshness probe: config failed before execution")\n')
  try {
    const crashed = tddRun(tdd.run)
    assert.notEqual(crashed.code, 0, crashed.output)
    assert.match(crashed.output, /Freshness probe: config failed before execution/)
    assert.equal(fs.existsSync(path.join(FIXTURE, JUNIT_DIR)), false, 'A config crash must not leave the earlier report behind')
    const gate = tddRun(GATE)
    assert.notEqual(gate.code, 0, `A config crash must not leave a proof behind:\n${gate.output}`)
    assert.match(gate.output, /no report at all/)
  } finally {
    // Chapter 4's gate reads this working tree: the probe line must go.
    fs.writeFileSync(conf, original)
  }
})

// ---------------------------------------------------------------------------
// Chapter 4: the phase refuses to certify itself
// ---------------------------------------------------------------------------
//
// Each phase of the loop has one command that certifies it. The test phase
// answers with a single exit code: the tests passed, and nothing was switched
// off to get there. The guard runs FIRST, so the refusal arrives in a second
// rather than after the whole suite.

storyboardStep(Then, 'the test phase refuses to certify itself, the moment a check is switched off', async () => {
  // The cheapest road to green, taken by an assistant that could not satisfy
  // the scenario: switch it off. The test file is otherwise untouched.
  const feature = path.join(FIXTURE, FEATURE)
  fs.writeFileSync(feature, fs.readFileSync(feature, 'utf8').replace(/^(\s*)@greeting$/m, '$1@skip\n$1@greeting'))

  const screen = await card('verify-refuses-a-switched-off-check', `cat ${FEATURE} && ${VERIFY}`)
  for (const said of ['@skip', 'switches a check off', `${FEATURE}:3`, 'without ever running it', 'No-cheat-exempt:',
    'Failed to run task "devsecops:test:verify"']) {
    assert.ok(screen.includes(said), `Expected verify to refuse the switched-off scenario with "${said}":\n${screen}`)
  }
})

storyboardStep(Then, 'the guard refuses a picture check loosened to 0.1 just the same', async () => {
  // The scenario goes back as it was, so the only cheat left is the tolerance.
  fs.writeFileSync(path.join(FIXTURE, FEATURE), FEATURE_BODY)
  const conf = path.join(FIXTURE, CONFIG)
  fs.writeFileSync(conf, fs.readFileSync(conf, 'utf8').replace(/^(\s*)tolerance: 0,$/m, '$1tolerance: 0.1,'))
  assert.ok(fs.readFileSync(conf, 'utf8').includes('tolerance: 0.1,'), `No "tolerance: 0," line to loosen in ${CONFIG}`)

  const screen = await card('guard-refuses-a-loosened-picture-check', `git diff -- ${CONFIG} && ${GUARD}`, DIFF_MASKS)
  for (const said of ['+      tolerance: 0.1,', `${CONFIG}:`, 'a picture check that accepts a difference',
    'Failed to run task "devsecops:test:check:no-cheat"']) {
    assert.ok(screen.includes(said), `Expected the guard to refuse tolerance 0.1 with "${said}":\n${screen}`)
  }
  const guard = tddRun(GUARD)
  assert.notEqual(guard.code, 0, `The guard must refuse tolerance 0.1:\n${guard.output}`)
})

// ===========================================================================
// @worker-completion: a parallel run passes only when every selected scenario
// finished.
// ===========================================================================

const workerCompletion = require('../helpers/workerCompletionFixture')
let workers = null

After((test) => {
  if (!owns(test, '@worker-completion')) return
  if (workers && workers.closeTerminal) workers.closeTerminal()
  workerCompletion.removeWorkerFixture()
  workers = null
})

storyboardStep(Given, 'parallel test files contain an interruptible worker and two completing examples', async () => {
  workerCompletion.prepareWorkerFixture()
  workers = { closeTerminal: await openLocalTerminal(I, { cwd: workerCompletion.ROOT, env: nestedEnv(), port: 7691, height: 1000 }) }
  const screen = await card('worker-completion-setup', workerCompletion.SETUP_LINE)
  for (const said of ['process.exit(23)', 'Scenario Outline: the selected example <number> completes']) {
    assert.ok(screen.includes(said), `Expected the probe files on screen, with "${said}":\n${screen}`)
  }
})

storyboardStep(When, 'a worker exits early, the engine alone still says OK, and the toolbox guard fails the same run', async () => {
  // The twin first, off camera: both incomplete selections (the interrupted
  // scenario alone, then beside the two examples), each run bare and then
  // guarded right after a successful run left its reports behind.
  workerCompletion.assertInterruptedCases(workerCompletion.runInterruptedCases())
  const screen = await card('worker-completion-engine-ok-guard-fails', workerCompletion.interruptedLine())
  const verdicts = screen.split('\n').filter(row => /^exit code \d+$/.test(row.trim())).map(row => row.trim())
  assert.deepEqual(verdicts, ['exit code 0', 'exit code 1'], `The engine alone must exit 0 and the guarded run 1:\n${screen}`)
  for (const said of ['Worker exited with code 23', 'OK  | 2 passed', 'Worker completion: FAIL (2/3 selected scenarios)',
    'missing: Interrupted worker: a worker must finish its scenario @worker-stop']) {
    assert.ok(screen.includes(said), `Expected "${said}" on the card:\n${screen}`)
  }
})

storyboardStep(Then, 'complete selections pass with either a grep filter or its inverse', async () => {
  // Off camera: a successful launch leaves reports the selected runs must not reuse.
  workerCompletion.seedReports()
  const screen = await card('worker-completion-selected', workerCompletion.selectedLine())
  workerCompletion.assertSelectedReports(screen)
})

// ===========================================================================
// @baseline-mode: only the value 1, on a developer's machine, rewrites a
// reference, and a merge request is where a person accepts it.
// ===========================================================================

const crypto = require('crypto')
const baselineMode = require('../helpers/baselineModeFixture')
const { captureElementFrame, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabUrl, gitlabFrame } = require('../helpers/gitlabCard')
const { createMergeRequestAfterPush, listMergeRequestDiffs, getRepositoryFileMeta } = require('../helpers/gitlabApi')

let baseline = null

After(async (test) => {
  if (!owns(test, '@baseline-mode')) return
  if (baseline && baseline.closeTerminal) baseline.closeTerminal()
  if (baseline && baseline.teardown) await baseline.teardown()
  baselineMode.removeBaselineFixture()
  baseline = null
})

const baselineEnv = () => ({ ...nestedEnv(), GIT_CONFIG_GLOBAL: baselineMode.GIT_CONFIG })

// One card per setting, the same line each time (see caseLine), twinned on
// disk by assertCase.
async function baselineCard (frame, prefix, value, ci) {
  const screen = await card(frame, baselineMode.caseLine(prefix))
  baselineMode.assertCase(screen, { value, ci })
}

storyboardStep(Given, 'a reference image and a captured page differ visibly in their pixels', async () => {
  baseline = {}
  await baselineMode.prepareBaselineFixture(I, baselineEnv())
  await addStoryboardFrame(I, await captureElementFrame(I, 'baseline-mode-difference', '#fixture'))
  baseline.closeTerminal = await openLocalTerminal(I, { cwd: baselineMode.ROOT, env: baselineEnv(), port: 7692, height: 800 })
})

storyboardStep(Then, 'a flag set to zero, like no flag at all, is not passed on, and both checks refuse the difference', async () => {
  // No flag at all, off camera: the same line, read as plain text.
  const unset = execSync(baselineMode.caseLine(''), { cwd: baselineMode.ROOT, env: baselineEnv(), shell: '/bin/bash', encoding: 'utf8' })
  baselineMode.assertCase(stripAnsiEscapeSequences(unset), { value: undefined, ci: false })
  await baselineCard('baseline-mode-zero', 'TASK_E2E_UPDATE_BASELINES=0', '0', false)
})

storyboardStep(Then, 'in CI the flag set to 1 reaches the test with CI set, and both checks refuse to rewrite anything', async () => {
  await baselineCard('baseline-mode-ci', 'CI=true TASK_E2E_UPDATE_BASELINES=1', '1', true)
})

storyboardStep(When, 'the flag is exactly 1 on the developer\'s machine, both references are rewritten with the captured pixels', async () => {
  await baselineCard('baseline-mode-one', 'TASK_E2E_UPDATE_BASELINES=1', '1', false)
})

storyboardStep(Then, 'the merge request shows each old reference next to its new pixels, for a reviewer to accept', async () => {
  // main: the copy as committed, blue references. Then the developer's branch
  // with the two rewritten references, and the merge request that asks for a
  // review. No pipeline: this project has no runner, and nothing here needs one.
  const pub = await publishToGitLab(baselineMode.ROOT, { project: { builds_access_level: 'disabled' } })
  baseline.teardown = pub.teardown
  baselineMode.commitRewrittenReferences()
  pub.push(baselineMode.BRANCH)
  const mr = await createMergeRequestAfterPush(pub.projectName,
    { source_branch: baselineMode.BRANCH, target_branch: 'main', title: baselineMode.COMMIT }, pub.headers)
  assert.equal(mr.status, 201, JSON.stringify(mr.data))
  const iid = mr.data.iid

  // The twin: the merge request changes exactly the two references, the
  // branch holds the captured pixels and the main branch still the blue ones.
  const paths = baselineMode.HELPERS.map(helper => `${baselineMode.E2E}/screenshots/base/baseline-probe/${helper}.png`).sort()
  let changed = []
  for (let i = 0; i < 30 && changed.length < paths.length; i++) {
    changed = (await listMergeRequestDiffs(pub.projectName, iid, pub.headers)).map(diff => diff.new_path).sort()
    if (changed.length < paths.length) await I.wait(1)
  }
  assert.deepEqual(changed, paths, 'The merge request must change the two references and nothing else')
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  for (const helper of baselineMode.HELPERS) {
    const file = `${baselineMode.E2E}/screenshots/base/baseline-probe/${helper}.png`
    const onBranch = await getRepositoryFileMeta(pub.projectName, file, baselineMode.BRANCH, pub.headers)
    const onMain = await getRepositoryFileMeta(pub.projectName, file, 'main', pub.headers)
    assert.equal(onBranch.content_sha256, sha(baselineMode.reference(helper)), `${file}: the branch must hold the captured pixels`)
    assert.notEqual(onMain.content_sha256, onBranch.content_sha256, `${file}: the main branch must still hold the old reference`)
  }

  await gitlabFrame(I, 'baseline-mode-merge-request', gitlabUrl.mr(pub.projectName, iid, 'diffs'), {
    height: 1100,
    waitText: 'storyboard.png',
    // GitLab loads each image on its own: wait until both pairs are drawn.
    // Each file name sits in a sticky header that Chromium sometimes paints on
    // a layer of its own, half a pixel off: the headers stay in the page flow.
    prepare: async () => {
      await I.waitForFunction(() => {
        const images = Array.from(document.querySelectorAll('.diff-file img, [data-testid="diff-file"] img'))
        return images.length >= 4 && images.every(img => img.complete && img.naturalWidth > 0)
      }, 60)
      await I.executeScript(() => document.querySelectorAll('.rd-diff-file-header-sticky').forEach(header => {
        header.style.position = 'static'
      }))
    }
  })
})

// ===========================================================================
// @generated-project-red: the same proof, in a project generated by the
// toolbox.
// ===========================================================================
//
// A generated project does not get the toolbox's own suite: it gets the engine
// under .config/codeceptjs/ and a sample configuration to copy into
// project/tests/application/, the folder its CodeceptJS tasks point at.

// Fixed path, not a mkdtemp: the prompt and the stack trace print it.
const GENERATED = '/tmp/e2e-generated-red'
const APP = 'project/tests/application'
const APP_FEATURE = `${APP}/features/greeting.feature`
// The step file the sample configuration already lists.
const APP_STEPS = `${APP}/step_definitions/application_steps.js`
const APP_JUNIT = `${APP}/_output/junit`
const APP_COPY = `cp .config/codeceptjs/codecept.conf.sample.js ${APP}/codecept.conf.js`
const APP_RUN = `codeceptjs run --config ${APP}/codecept.conf.js --grep ${TAG}`

const APP_FEATURE_BODY = `Feature: A project that says hello
  @greeting
  Scenario: it greets the developer by name
    Then the project greets the developer by name
`

const APP_STEPS_BODY = `/* global Then */
Then('the project greets the developer by name', () => {
  throw new Error("expected 'Hello, Lambda', got ''")
})
`

let generated = null

After((test) => {
  if (!owns(test, '@generated-project-red')) return
  if (generated && generated.closeTerminal) generated.closeTerminal()
  for (const leftover of [GENERATED, `${GENERATED}.gitconfig`]) fs.rmSync(leftover, { recursive: true, force: true })
  generated = null
})

storyboardStep(Given, 'a generated project copies the CodeceptJS sample and writes a test that cannot pass yet', async () => {
  fs.rmSync(GENERATED, { recursive: true, force: true })
  renderProject({}, { dst: GENERATED })
  // The engine's dependencies are baked into the image, never carried in the
  // tree: the project borrows the image's, as the toolbox copy above does.
  fs.symlinkSync('/app/.config/codeceptjs/node_modules', path.join(GENERATED, '.config/codeceptjs/node_modules'))
  const gitConfig = `${GENERATED}.gitconfig`
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  generated = { env: nestedEnv({ GIT_CONFIG_GLOBAL: gitConfig }) }
  execSync('git init -q && git add -A && git commit -qm "the generated project"', { cwd: GENERATED, env: generated.env })

  for (const [file, body] of [[APP_FEATURE, APP_FEATURE_BODY], [APP_STEPS, APP_STEPS_BODY]]) {
    fs.mkdirSync(path.join(GENERATED, path.dirname(file)), { recursive: true })
    fs.writeFileSync(path.join(GENERATED, file), body)
  }
  generated.closeTerminal = await openLocalTerminal(I, { cwd: GENERATED, env: generated.env, port: 7694, height: 1200 })
  const screen = await card('generated-project-writes-its-test', `${APP_COPY} && git add -N . && git status --short && git diff -- ${APP_FEATURE} ${APP_STEPS}`)
  for (const said of [`${APP}/codecept.conf.js`, '+  @greeting', '+  throw new Error("expected \'Hello, Lambda\', got \'\'")']) {
    assert.ok(screen.includes(said), `Expected the copy and the new test on screen, with "${said}":\n${screen}`)
  }
  const added = execSync('git diff --name-only', { cwd: GENERATED, env: generated.env, encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(added, [`${APP}/codecept.conf.js`, APP_FEATURE, APP_STEPS], 'The developer copied the sample and wrote the test, nothing else')
  assert.equal(fs.readFileSync(path.join(GENERATED, APP, 'codecept.conf.js'), 'utf8'),
    fs.readFileSync(path.join(GENERATED, '.config/codeceptjs/codecept.conf.sample.js'), 'utf8'), 'The configuration is the shipped sample, unchanged')
})

storyboardStep(When, 'the generated project runs that test and it fails on what it checks', async () => {
  const screen = await card('generated-project-test-fails', `${APP_RUN}; echo "exit code $?"; ls ${APP_JUNIT}`)
  for (const said of ["expected 'Hello, Lambda', got ''", 'exit code 1', 'results-1.xml']) {
    assert.ok(screen.includes(said), `Expected the failed run and its report on screen, with "${said}":\n${screen}`)
  }
  const xml = fs.readFileSync(path.join(GENERATED, APP_JUNIT, 'results-1.xml'), 'utf8')
  assert.ok(xml.includes(TAG) && xml.includes('<failure'), `The report must hold the ${TAG} scenario and its failure:\n${xml}`)
})

storyboardStep(Then, "the generated project's own check accepts that failure as proof", async () => {
  const screen = await card('generated-project-gate-accepts', GATE)
  for (const said of [`REPORT_DIR=${APP_JUNIT} bash`, 'The failure is real: the scenario ran and failed on its own check.', "expected 'Hello, Lambda', got ''"]) {
    assert.ok(screen.includes(said), `Expected the generated project's gate to accept the failure, with "${said}":\n${screen}`)
  }
  // Throws on any exit code but 0.
  execSync(GATE, { cwd: GENERATED, env: generated.env, stdio: 'pipe' })
})
