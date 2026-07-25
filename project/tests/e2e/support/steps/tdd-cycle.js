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
// Chapters 3 and 4 — the cycle itself, driven for real
// ---------------------------------------------------------------------------
//
// The phases are tasks (.config/devsecops/scripts/tdd-cycle.sh), the phase
// really reached is written on disk, and each phase ends on a gate that answers
// with an exit code.
//
// Chapter 3 runs the cycle with NO AI assistant on the machine at all: the
// phase checks the work the developer wrote in chapters 1 and 2, against the
// same gates. Chapter 4 then declares one and hands it a turn — the framework
// ships none and names none, so the story drops in a stand-in living outside
// the copy: it reads its instructions on standard input and writes one known
// file per phase. Nothing reaches the network, no model is called, and the
// picture stays the same on every run.

const ORACLE_DIR = `${FIXTURE}-bin`
const ORACLE = `${ORACLE_DIR}/pocket-oracle`
const DROP_IN = '.config/devsecops/agents.d/pocket-oracle.sh'
const PHASE_FILE = 'tmp/agent/phase'

const ORACLE_BODY = `#!/usr/bin/env bash
# A stand-in for an AI assistant, so the cycle can be driven for real with no
# network, no key and no model. It reads the prompt on standard input and writes
# ONE known file per phase, which is all the gates need to have something true
# to read.
set -euo pipefail
[ "\${1:-}" = "--list-models" ] && { printf 'oracle-small\\noracle-large\\n'; exit 0; }
prompt="$(cat)"
case "\${prompt}" in
*"the review:red phase"*)
  echo "The scenario reads on its own, and it failed on its own check."
  echo "VERDICT: ACCEPT"
  ;;
*"the green phase"*) printf 'Hello, {name}\\n' > GREETING ;;
esac
`

const DROP_IN_BODY = `# The AI assistant this machine holds. Two lines, per
# .config/devsecops/agents.d/README.md.
AGENT_EXEC_CMD="pocket-oracle --model {{MODEL}}"
AGENT_MODELS_CMD="pocket-oracle --list-models"
`

const DOCTOR = 'task devsecops:test:tdd:doctor'
const GREEN = 'task devsecops:test:tdd:green -- @greeting'
const RED = 'task devsecops:test:tdd:red -- @greeting'
const REVIEW_RED = 'task devsecops:test:tdd:review:red -- @greeting'

storyboardStep(Then, 'the step that writes the code refuses to start while no failure has been proven', async () => {
  // How THIS project runs its tests, declared once where a project declares its
  // settings — and committed, because it is the machine's setup, not the work of
  // a phase: the red phase reads the working tree for the work.
  fs.appendFileSync(path.join(FIXTURE, '.env.dev'), `\nTASK_AGENT_TEST_CMD=${RUN}\n`)
  sh('git add .env.dev && git commit -qm "chore: say how this project runs its tests"', FIXTURE)

  const phase = run(`cat ${PHASE_FILE}`, FIXTURE)
  const { output, code } = run(GREEN, FIXTURE)
  const seen = stripAnsi(output)
  // A non-zero exit is not enough: the phase must refuse for the recorded
  // phase, and say which command comes next.
  if (code === 0 || !seen.includes('cannot start yet') || !seen.includes('expected phase : review:red')) {
    throw new Error(`Expected the green phase to refuse out of order, got exit ${code}:\n${seen}`)
  }
  await card('green-refuses-out-of-order',
    `$ cat ${PHASE_FILE}\n${phase.output.trimEnd()}\n$ ${GREEN}\n${output.trimEnd()}`, { colour: true })
})

storyboardStep(Then, 'the step that opens it accepts a test written by hand, with no assistant on this machine', async () => {
  // No drop-in, no TASK_AGENT_EXEC_CMD: the phase says so and reads this tree.
  const { output, code } = run(RED, FIXTURE)
  const seen = stripAnsi(output)
  if (code !== 0 || !seen.includes('no AI tool declared') ||
      !seen.includes('The failure is real') || !seen.includes('the cycle now stands at: red')) {
    throw new Error(`Expected the red phase to accept the hand-written test with no tool, got exit ${code}:\n${seen}`)
  }
  await card('red-accepts-work-done-by-hand', `$ ${RED}\n${output.trimEnd()}`, { colour: true })
})

storyboardStep(Then, 'the toolbox reports the AI assistants this machine holds and the models each one gives', async () => {
  fs.mkdirSync(ORACLE_DIR, { recursive: true })
  fs.writeFileSync(ORACLE, ORACLE_BODY, { mode: 0o755 })
  fs.writeFileSync(path.join(FIXTURE, DROP_IN), DROP_IN_BODY)
  sh(`git add ${DROP_IN} && git commit -qm "chore: declare the pocket oracle"`, FIXTURE)
  env.PATH = `${ORACLE_DIR}:${env.PATH}`

  const { output, code } = run(DOCTOR, FIXTURE)
  const seen = stripAnsi(output)
  if (code !== 0 || !seen.includes('oracle-small') || !seen.includes('oracle-large') ||
      !seen.includes('pocket-oracle --model')) {
    throw new Error(`Expected the doctor to find the drop-in and the models it reports, got exit ${code}:\n${seen}`)
  }
  await card('assistants-this-machine-holds', `$ ${DOCTOR}\n${output.trimEnd()}`, { colour: true })
})

storyboardStep(Then, 'the assistant writes the greeting, and the toolbox sees that test pass for itself', async () => {
  // The review the cycle asks for between red and green, handed to the same
  // assistant: it records its verdict where the gate reads it.
  const review = run(REVIEW_RED, FIXTURE)
  if (review.code !== 0) {
    throw new Error(`The review step refused, so green could not start:\n${stripAnsi(review.output)}`)
  }
  const phase = run(`cat ${PHASE_FILE}`, FIXTURE)
  const { output, code } = run(GREEN, FIXTURE)
  const seen = stripAnsi(output)
  if (code !== 0 || !seen.includes('1 passed') || !seen.includes('the cycle now stands at: green')) {
    throw new Error(`Expected the green phase to run and the test to pass, got exit ${code}:\n${seen}`)
  }
  // Twin: the greeting the test was asking for is really on disk now.
  const greeting = fs.readFileSync(path.join(FIXTURE, 'GREETING'), 'utf8').trim()
  if (greeting !== 'Hello, {name}') throw new Error(`Expected the greeting to be written, got ${JSON.stringify(greeting)}`)
  await card('assistant-writes-it-and-the-test-passes',
    `$ cat ${PHASE_FILE}\n${phase.output.trimEnd()}\n$ ${GREEN}\n${maskDurations(seen)}`, { height: 900 })
})
