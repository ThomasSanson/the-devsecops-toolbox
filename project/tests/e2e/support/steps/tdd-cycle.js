/* global inject Given When Then After */
/**
 * Storyboard for @tdd-cycle (see features/02-daily-work/tdd-cycle.feature).
 *
 * The method of this repository rests on one fact: the test failed BEFORE the
 * code existed. Until now that fact was taken on trust. This story proves the
 * toolbox now checks it, by producing BOTH failures for real inside a throwaway
 * copy of the framework:
 *
 *   - the run that dies while loading files (a step file asks for a helper that
 *     does not exist yet). It exits non-zero and leaves NO report at all;
 *   - the run that reaches the scenario and fails on its own check. It leaves a
 *     report holding that scenario and its failure.
 *
 * Both runs use the framework's own engine and its own configuration
 * (project/tests/e2e/codecept.conf.js), started with the exact command shown on
 * the card. The wrapping `task project:test:e2e` cannot be the entrypoint here:
 * it boots the codeceptjs service by compose, which is the very container this
 * scenario runs inside — it would restart the runner mid-scenario. The engine
 * command it ends on is therefore what runs, verbatim, with the same config, the
 * same step files and the same JUnit reporter.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the step
 * (tolerance: 0); every card twins its frame with a check of the same fact (exit
 * code, report on disk, verdict text).
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { copyFramework } = require('../helpers/frameworkCopy')
const { stripAnsi, renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// Fixed path, not a mkdtemp: it appears verbatim in the error the engine prints
// (the require stack), so a random directory would move the picture on every
// run. One scenario owns this file, so two workers never share the directory.
const FIXTURE = '/tmp/e2e-tdd-cycle'
// The engine's dependencies are baked into the image, never carried in the
// tree, so the copy borrows the image's — exactly what the runner itself uses.
const NODE_MODULES = '/app/.config/codeceptjs/node_modules'

// The throwaway feature a developer would write first: a greeting the toolbox
// does not give yet.
const TAG = '@greeting'
const FEATURE = 'project/tests/e2e/features/02-daily-work/greeting.feature'
const STEPS = 'project/tests/e2e/support/steps/greeting.js'
const HELPER = 'project/tests/e2e/support/helpers/greeting.js'
const JUNIT_DIR = 'project/tests/e2e/_output/junit'

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

// The command the framework's e2e task ends on, narrowed to the one feature
// file — the same engine, config, step files and JUnit reporter as a CI shard.
const RUN =
  'TASK_CODECEPTJS_FEATURES=./features/02-daily-work/greeting.feature codeceptjs run-workers 1 ' +
  `--features --by pool --config project/tests/e2e/codecept.conf.js --grep '${TAG}'`
const GATE = `task devsecops:test:check:red-is-real -- ${TAG}`
const LIST_REPORTS = `ls ${JUNIT_DIR}`

let env = null

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }).trimEnd()
}

// A terminal shows both streams interleaved, so the capture does too. The exit
// code is part of the transcript: it is the whole point of the first chapter.
function run (cmd, cwd) {
  try {
    return { output: execSync(`${cmd} 2>&1`, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 600000, maxBuffer: 64 * 1024 * 1024 }), code: 0 }
  } catch (e) {
    return { output: (e.stdout || '') + (e.stderr || ''), code: e.status == null ? 1 : e.status }
  }
}

// The only fields of the engine's own output that move between two identical
// runs: how long each scenario took, and the version in its banner (which moves
// with an upgrade, never with the behaviour under test).
function maskDurations (text) {
  return text
    .replace(/\/\/ \d+(\.\d+)?m?s/g, '// <duration>')
    .replace(/ in \d+(\.\d+)?m?s/g, ' in <duration>')
    .replace(/CodeceptJS v[0-9][0-9.]*/g, 'CodeceptJS v<version>')
}

// A verbatim slice with its own boundaries, never a hand-picked set of lines:
// from the first line matching `from` to the last consecutive line matching
// `while`.
function block (text, from, whileRe) {
  const lines = text.split('\n').map(l => l.replace(/[ \t]+$/, ''))
  const start = lines.findIndex(l => from.test(stripAnsi(l)))
  if (start < 0) throw new Error(`Could not find ${from} in:\n${stripAnsi(text)}`)
  let end = start + 1
  while (end < lines.length && whileRe.test(stripAnsi(lines[end]))) end++
  return lines.slice(start, end).join('\n')
}

// Every card is captured output on a dark <pre> that hugs its own content, with
// the command that produced it on the first line — the frame is exactly as tall
// as what it shows, never a mostly-empty viewport. Colour is on for this story:
// every frame here is a real terminal transcript, and the red and green of the
// verdicts is half of what it says.
async function card (frameName, text, opts = {}) {
  await renderPreFrame(I, frameName, text, { colour: true, ...opts })
}

// The runs this story starts load the copy's step files — this one among them —
// so an unguarded hook would fire inside the nested run and delete the very
// fixture that run is using. Every hook here answers to its own scenario only.
const ownsScenario = (test) => Boolean(test && test.tags && test.tags.includes('@tdd-cycle'))

After((test) => {
  if (!ownsScenario(test)) return
  for (const leftover of [FIXTURE, `${FIXTURE}-bin`, `${FIXTURE}.gitconfig`]) {
    try { fs.rmSync(leftover, { recursive: true, force: true }) } catch (_) {}
  }
  env = null
})

// ---------------------------------------------------------------------------
// Chapter 1 — a failure that proves nothing
// ---------------------------------------------------------------------------

storyboardStep(Given, 'a developer writes the test for a greeting the toolbox cannot give yet', async () => {
  fs.rmSync(FIXTURE, { recursive: true, force: true })
  fs.mkdirSync(FIXTURE, { recursive: true })
  copyFramework(FIXTURE)
  fs.symlinkSync(NODE_MODULES, path.join(FIXTURE, '.config/codeceptjs/node_modules'))

  // The tar keeps the host uid, so git would refuse "dubious ownership". An
  // isolated global config never touches the shared ~/.gitconfig, so parallel
  // workers cannot race on its lock. It lives OUTSIDE the copy: the cycle's own
  // "the red phase touches tests only" gate reads this working tree, and a
  // stray file at its root would be a change the phase never made.
  const gitConfig = `${FIXTURE}.gitconfig`
  fs.writeFileSync(gitConfig, '[safe]\n\tdirectory = *\n[user]\n\temail = e2e@test.local\n\tname = e2e\n[init]\n\tdefaultBranch = main\n')
  env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, FORCE_COLOR: '1' }
  sh('git init -q && git add -A && git commit -qm "the toolbox as it stands"', FIXTURE)

  fs.writeFileSync(path.join(FIXTURE, FEATURE), FEATURE_BODY)
  fs.writeFileSync(path.join(FIXTURE, STEPS), STEPS_BODY)
  // Every step file is listed in the suite's configuration and required at
  // start-up — which is why one file that cannot load takes the whole run down.
  const conf = path.join(FIXTURE, 'project/tests/e2e/codecept.conf.js')
  fs.writeFileSync(conf, fs.readFileSync(conf, 'utf8').replace(
    "      './support/steps/init-baseline.js',",
    "      './support/steps/greeting.js',\n      './support/steps/init-baseline.js',"
  ))

  // The two new files and the one line that registers them, as a real diff.
  // `git add -N` makes the new files visible to `git diff` without staging
  // their content; git's own plumbing lines are dropped so every added line is
  // readable without per-file boilerplate.
  const diff = sh('git add -N . && git -c color.ui=always diff', FIXTURE)
    .split('\n')
    .filter(line => {
      const plain = stripAnsi(line)
      return !plain.startsWith('diff --git ') && !plain.startsWith('index ') && !plain.startsWith('new file mode ')
    })
    .join('\n')
  // Taller viewport: this card is the whole content of both new files, and an
  // element capture must have the element on screen to shoot it.
  await card('the-test-comes-first', `$ git add -N . && git diff\n${diff}`, { height: 900 })
})

storyboardStep(Then, 'the run dies on its way to the test, and still exits like a failed test', async () => {
  const { output, code } = run(RUN, FIXTURE)
  const reports = run(LIST_REPORTS, FIXTURE)
  if (code === 0) throw new Error(`Expected the run to fail, got exit 0:\n${stripAnsi(output)}`)
  if (fs.existsSync(path.join(FIXTURE, JUNIT_DIR))) {
    throw new Error(`Expected NO report at all, ${JUNIT_DIR} exists: ${fs.readdirSync(path.join(FIXTURE, JUNIT_DIR))}`)
  }
  await card('no-scenario-ever-ran', [
    `$ ${RUN}`,
    block(output, /Cannot find module/, /^(Require stack:|- )/),
    '$ echo $?',
    String(code),
    `$ ${LIST_REPORTS}`,
    reports.output.trimEnd()
  ].join('\n'))
})

storyboardStep(Then, 'the toolbox refuses to call that a proof, because no scenario was ever recorded', async () => {
  const { output, code } = run(GATE, FIXTURE)
  // A non-zero exit is not enough: an absent task exits non-zero too, and would
  // pose as the verdict. The gate must say WHY, in its own words.
  if (code === 0 || !stripAnsi(output).includes('no report at all')) {
    throw new Error(`Expected the gate to refuse the crash for lack of a report, got exit ${code}:\n${stripAnsi(output)}`)
  }
  await card('gate-refuses-the-crash', `$ ${GATE}\n${output.trimEnd()}`)
})

// ---------------------------------------------------------------------------
// Chapter 2 — a failure that proves something
// ---------------------------------------------------------------------------

storyboardStep(When, 'the missing helper is written and the test finally reaches its own check', async () => {
  fs.writeFileSync(path.join(FIXTURE, HELPER), HELPER_BODY)
  const { output, code } = run(RUN, FIXTURE)
  const reports = run(LIST_REPORTS, FIXTURE)
  if (code === 0) throw new Error(`Expected the scenario to fail, got exit 0:\n${stripAnsi(output)}`)
  const xml = fs.readFileSync(path.join(FIXTURE, JUNIT_DIR, 'results-1.xml'), 'utf8')
  if (!xml.includes(TAG) || !xml.includes('<failure')) {
    throw new Error(`Expected the report to hold the ${TAG} scenario and its failure, got:\n${xml}`)
  }
  await card('the-scenario-really-failed', [
    `$ ${RUN}`,
    maskDurations(block(output, /FAIL {2}\|/, /^\s*$/)),
    maskDurations(block(output, /^\s*1\) A toolbox that says hello/, /^(?!\s+at ).*$/)),
    `$ ${LIST_REPORTS}`,
    reports.output.trimEnd()
  ].join('\n'))
})

storyboardStep(Then, 'the toolbox accepts the failure as proof, and quotes the check that produced it', async () => {
  const { output, code } = run(GATE, FIXTURE)
  if (code !== 0) throw new Error(`Expected the gate to accept the failure, got exit ${code}:\n${stripAnsi(output)}`)
  if (!stripAnsi(output).includes("expected 'Hello, Lambda', got ''")) {
    throw new Error(`Expected the gate to quote the failing check, got:\n${stripAnsi(output)}`)
  }
  await card('gate-accepts-the-failure', `$ ${GATE}\n${output.trimEnd()}`)
})

// ---------------------------------------------------------------------------
// Chapter 3 — the phase refuses to certify itself
// ---------------------------------------------------------------------------
//
// Each phase of the loop has one command that certifies it, and that is what
// whoever delegates runs instead of believing a report. The test phase answers
// with a single exit code: the tests passed, and nothing was switched off to get
// there. The guard runs FIRST, so the refusal below arrives in a second rather
// than after the whole suite — the difference between a check people run and one
// they skip.

const VERIFY = 'task devsecops:test:verify'

storyboardStep(Then, 'the test phase refuses to certify itself, the moment a check is switched off', async () => {
  // The cheapest road to green, taken by an assistant that could not satisfy
  // the scenario: switch it off. The test file is otherwise untouched.
  const feature = path.join(FIXTURE, FEATURE)
  fs.writeFileSync(feature, fs.readFileSync(feature, 'utf8').replace(/^(\s*)@greeting$/m, '$1@skip\n$1@greeting'))

  const { output, code } = run(VERIFY, FIXTURE)
  const seen = stripAnsi(output)
  if (code === 0 || !seen.includes('switches a check off') || !seen.includes(FEATURE) ||
      !seen.includes('without ever running it') || !seen.includes('No-cheat-exempt:')) {
    throw new Error(`Expected verify to refuse the switched-off scenario, got exit ${code}:\n${seen}`)
  }
  await card('verify-refuses-a-switched-off-check', `$ ${VERIFY}\n${output.trimEnd()}`, { colour: true })
})

// The regeneration contract runs the real engine in a disposable copy, just as
// the RED-proof story above does. Its reference and actual images come from the
// browser; each inner run starts from the same blue reference.
const baselineMode = require('../helpers/baselineModeFixture')
const { captureElementFrame, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')

After((test) => {
  if (test && test.tags && test.tags.includes('@baseline-mode')) baselineMode.removeBaselineFixture()
})

storyboardStep(Given, 'a reference image and a captured page differ visibly in their pixels', async () => {
  await baselineMode.prepareBaselineFixture(I)
  await addStoryboardFrame(I, await captureElementFrame(I, 'baseline-mode-difference', '#fixture'))
})

const baselineCases = [
  ['an unset regeneration flag refuses the pixel difference and preserves the reference', undefined, false, 'unset'],
  ['a regeneration flag set to zero still refuses the difference and preserves the reference', '0', false, 'zero'],
  ['an explicit local regeneration request replaces the reference with the captured pixels', '1', false, 'one'],
  ['the same explicit regeneration request is forbidden in CI and preserves the reference', '1', true, 'ci']
]

for (const [sentence, value, ci, frame] of baselineCases) {
  storyboardStep(Then, sentence, async () => {
    const result = baselineMode.runBaselineCase(value, ci)
    const output = baselineMode.proofOutput(result)
    // Keep the complete transcript inside the viewport before its element
    // capture: Chromium can change its fallback font when capturing below it.
    const rows = stripAnsi(output).split('\n').reduce((count, line) =>
      count + Math.max(1, Math.ceil(line.replace(/\t/g, '        ').length / 80)), 0)
    await card('baseline-mode-' + frame, output, { height: Math.max(640, 32 + rows * 24) })
    baselineMode.assertBaselineCase(result)
  })
}

const workerCompletion = require('../helpers/workerCompletionFixture')
let interruptedRuns = null

After((test) => {
  if (test && test.tags && test.tags.includes('@worker-completion')) {
    workerCompletion.removeWorkerFixture()
    interruptedRuns = null
  }
})

async function workerCard (name, output) {
  const rows = output.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 80)), 0)
  await card('worker-completion-' + name, output, { height: Math.max(640, 32 + rows * 24) })
}

storyboardStep(Given, 'parallel test files contain an interruptible worker and two completing examples', async () => {
  const source = workerCompletion.prepareWorkerFixture()
  await workerCard('setup', '$ ' + source.command + '\n' + source.output.trimEnd())
})

storyboardStep(When, 'a worker exits early both alone and alongside a worker that completes its examples', async () => {
  interruptedRuns = workerCompletion.runInterruptedCases()
  await workerCard('native', interruptedRuns.map(result => workerCompletion.transcript(result.native)).join('\n\n'))
})

storyboardStep(Then, 'the task rejects both incomplete runs and cannot reuse earlier successful reports', async () => {
  await workerCard('refused', interruptedRuns.map(result => workerCompletion.transcript(result.guarded, true)).join('\n\n'))
  workerCompletion.assertInterruptedCases(interruptedRuns)
})

storyboardStep(Then, 'complete selections pass with either a grep filter or its inverse', async () => {
  const results = workerCompletion.runCompletedSelections()
  await workerCard('selected', results.map(result => workerCompletion.transcript(result, true)).join('\n\n'))
})
