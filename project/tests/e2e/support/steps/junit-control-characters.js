/* global inject After Given When Then */
/**
 * Storyboard for @junit-control-characters (features/02-daily-work/tdd-cycle-reports.feature).
 *
 * The repository's JUnit reporter feeds two readers: GitLab, which shows the
 * report of a pipeline on its Tests tab, and the local RED gate. A failure
 * message in terminal colours, with characters XML forbids, must reach both as
 * readable text, and still count as a failure.
 *
 * The story is told where a reviewer reads it: a merge request adds the three
 * probes, its pipeline runs them with the toolbox's own engine, on the very
 * image this suite runs in, and GitLab shows its reading of the report. The RED
 * gate is local by design, so its card is a real terminal in this container.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync, execFileSync } = require('child_process')
const { copyFrameworkWithEngine, engineCommand } = require('../helpers/frameworkCopy')
const { ENGINE_MASKS, openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabUrl, gitlabFrame } = require('../helpers/gitlabCard')
const { waitMergeRequestPipeline } = require('../helpers/pipelineRunner')
const { getRootHeaders, createProjectRunner, deleteRunner, createMergeRequestAfterPush, listMergeRequestDiffs, getPipelineTestReport } = require('../helpers/gitlabApi')
const { composeService } = require('../helpers/docker')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const ROOT = '/tmp/e2e-junit-report'
const GIT_CONFIG = `${ROOT}.gitconfig`
const E2E = 'project/tests/e2e'
const FEATURE = `${E2E}/features/report-probe.feature`
const STEPS = `${E2E}/support/steps/report-probe.js`
const CONFIG = `${E2E}/codecept.conf.js`
const REPORT = `${E2E}/_output/junit/results-1.xml`
const BRANCH = 'add-report-probes'
// The job's name is the name of its suite on GitLab's Tests tab.
const JOB = 'junit-probes'
const NET = 'the-devsecops-toolbox_the-devsecops-toolbox'
const TITLE = 'test: add a passing probe and two failing ones'
const COLOURED = 'JUnit report probe: a coloured assertion fails @report-colour'
const PLAIN = 'Expected <hello> & "world", got café 🧪\nKeep this second line\tindented.\r'
const FEATURES = `Feature: JUnit report probe
  @report-pass
  Scenario: an ordinary scenario passes
    Then the ordinary probe passes
  @report-plain
  Scenario: an ordinary assertion fails
    Then the plain probe fails
  @report-colour
  Scenario: a coloured assertion fails
    Then the coloured probe fails
`
const PROBE_STEPS = `/* global Then */
const assert = require('assert/strict')
const message = ${JSON.stringify(PLAIN)}
const forbidden = Array.from({ length: 32 }, (_, code) => code)
  .filter(code => ![9, 10, 13].includes(code)).concat([65534, 65535])
  .map(code => String.fromCharCode(code)).join('')
Then('the ordinary probe passes', () => assert.equal(1 + 1, 2))
Then('the plain probe fails', () => assert.fail(message))
Then('the coloured probe fails', () => {
  const escape = String.fromCharCode(27)
  assert.fail(escape + '[31m' + message + escape + '[0m' + forbidden + 'Message ends here.')
})
`
// The local twin of GitLab's reading: the report must parse as XML and keep
// both messages whole.
const CHECK_XML = `import json, sys
import xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
cases = list(root.iter('testcase'))
failures = [case.find('failure').get('message') for case in cases if case.find('failure') is not None]
print(json.dumps({'tests': len(cases), 'failures': failures, 'skipped': len(list(root.iter('skipped'))), 'errors': len(list(root.iter('error')))}))
`

let story = null

After(async (test) => {
  if (!(test && test.tags && test.tags.includes('@junit-control-characters'))) return
  if (story) {
    if (story.closeTerminal) story.closeTerminal()
    const rootHeaders = await getRootHeaders()
    await stopLocalImageRunner(story.runner, rootHeaders)
    if (story.teardown) await story.teardown()
  }
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.rmSync(GIT_CONFIG, { force: true })
  story = null
})

function git (args) {
  execSync(`git ${args}`, { cwd: ROOT, env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_CONFIG }, stdio: 'ignore' })
}

// The image this suite runs in: the job uses the same engine, Node and
// dependencies, and the runner reads it from the local Docker, never a registry.
function suiteImage () {
  const self = execSync('hostname', { encoding: 'utf8' }).trim()
  return execSync(`docker inspect --format '{{.Config.Image}}' ${self}`, { encoding: 'utf8' }).trim()
}

// A runner of its own for this one job, in its own container: it takes the
// suite's image from the local Docker (pipelineRunner.registerScopedRunner pulls
// every job image, and this one is in no registry), and it never waits for a
// slot of the shared runner service, which other stories keep busy for minutes.
// No dind, no privileged mode: the job only runs Node. It exits after one job.
async function startLocalImageRunner (projectId, rootHeaders) {
  const runner = await createProjectRunner(projectId, rootHeaders)
  if (runner.status >= 400) throw new Error(`createProjectRunner failed (${runner.status}): ${JSON.stringify(runner.data)}`)
  const svc = composeService('gitlab-runner')
  if (!svc) throw new Error('gitlab-runner compose service is not running')
  const image = execFileSync('docker', ['inspect', '--format', '{{.Config.Image}}', svc], { encoding: 'utf8' }).trim()
  const name = `e2e-junit-runner-${crypto.randomBytes(4).toString('hex')}`
  // The token travels in the environment, never on a command line.
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '--network', NET, '-e', 'CI_SERVER_TOKEN',
    '-v', '/var/run/docker.sock:/var/run/docker.sock', image, 'run-single', '--url', 'http://gitlab', // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    '--executor', 'docker', '--docker-image', 'alpine:3.20', '--docker-network-mode', NET,
    '--docker-pull-policy', 'if-not-present', '--max-builds', '1'],
  { env: { ...process.env, CI_SERVER_TOKEN: runner.data.token }, stdio: 'ignore' })
  return { runnerId: runner.data.id, name }
}

async function stopLocalImageRunner (runner, rootHeaders) {
  if (!runner) return
  try { execFileSync('docker', ['rm', '-f', runner.name], { stdio: 'ignore' }) } catch (_) {}
  await deleteRunner(runner.runnerId, rootHeaders).catch(() => {})
}

// Open the job's suite on the Tests tab, the way a reader clicks its row, and
// wait for its cases; then, when asked, the details of one case.
async function openSuite (caseName = null) {
  const clicked = await I.executeScript((args) => {
    const row = Array.from(document.querySelectorAll('.js-suite-row')).find(r => r.textContent.includes(args.job))
    if (!row) return Array.from(document.querySelectorAll('[role="row"]')).map(r => r.textContent.trim().slice(0, 80))
    row.click()
    return true
  }, { job: JOB })
  if (clicked !== true) throw new Error(`No suite row for ${JOB} on the Tests tab: ${JSON.stringify(clicked)}`)
  await I.waitForElement('[data-testid="test-case-row"]', 30)
  if (!caseName) return
  const opened = await I.executeScript((name) => {
    const row = Array.from(document.querySelectorAll('[data-testid="test-case-row"]')).find(r => r.textContent.includes(name))
    const button = row && Array.from(row.querySelectorAll('button')).find(b => b.textContent.includes('View details'))
    if (!button) return false
    button.click()
    return true
  }, caseName)
  if (!opened) throw new Error(`No "View details" for ${caseName}`)
  // Every row carries its own hidden modal: wait for the one on screen.
  await I.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid="test-case-details-modal"], .modal.show'))
    .some(el => el.getBoundingClientRect().height > 0), 30)
}

// A short wait on GitLab's asynchronous work, with the last answer in the error.
async function poll (what, read, done, tries = 60) {
  let last
  for (let i = 0; i < tries; i++) {
    last = await read()
    if (done(last)) return last
    await I.wait(2)
  }
  throw new Error(`${what}: still not there after ${tries * 2} s: ${JSON.stringify(last).slice(0, 2000)}`)
}

storyboardStep(Given, 'a merge request adds one passing scenario, one plain failure and one failure in terminal colours', async () => {
  story = {}
  copyFrameworkWithEngine(ROOT)
  const env = { ...process.env, TASK_CODECEPTJS_FEATURES: './features/report-probe.feature' }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'CI']) delete env[name]
  story.env = env
  // The real engine and the repository's JUnit reporter; no browser, and only
  // the probe's steps, so no other journey's hook runs in the nested launch.
  fs.appendFileSync(path.join(ROOT, CONFIG), '\nexports.config.helpers = {}\nexports.config.include = {}\n' +
    "exports.config.gherkin.steps = ['./support/steps/report-probe.js']\n" +
    "exports.config.plugins = { junit: { require: './support/junit-reporter.js', enabled: true } }\n")
  // The project's pipeline: one job, on merge requests only, running the line
  // `task project:test:e2e` ends on, and handing its reports to GitLab.
  story.command = engineCommand(ROOT, env)
  fs.writeFileSync(path.join(ROOT, '.gitlab-ci.yml'), [
    'workflow:',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    `${JOB}:`,
    `  image: ${suiteImage()}`,
    '  variables:',
    `    TASK_CODECEPTJS_FEATURES: ${env.TASK_CODECEPTJS_FEATURES}`,
    '  script:',
    `    - ${story.command}`,
    '  artifacts:',
    '    when: always',
    '    reports:',
    `      junit: ${E2E}/_output/junit/*.xml`,
    ''
  ].join('\n'))
  fs.writeFileSync(GIT_CONFIG, '[user]\n\temail = lambda@test.local\n\tname = Lambda User\n[init]\n\tdefaultBranch = main\n')
  git('init -q && git add -A && git commit -qm "chore: the toolbox and its test pipeline"')
  const pub = await publishToGitLab(ROOT)
  story.teardown = pub.teardown
  story.pub = pub
  const rootHeaders = await getRootHeaders()
  story.runner = await startLocalImageRunner(pub.projectId, rootHeaders)

  fs.writeFileSync(path.join(ROOT, FEATURE), FEATURES)
  fs.writeFileSync(path.join(ROOT, STEPS), PROBE_STEPS)
  git(`switch -q -c ${BRANCH} && git add -A && git commit -qm "${TITLE}"`)
  pub.push(BRANCH)
  const mr = await createMergeRequestAfterPush(pub.projectName, { source_branch: BRANCH, target_branch: 'main', title: TITLE }, pub.headers)
  assert.equal(mr.status, 201, JSON.stringify(mr.data))
  story.iid = mr.data.iid

  // The twin: the merge request adds the two probe files and nothing else.
  const diffs = await poll('merge request diffs', () => listMergeRequestDiffs(pub.projectName, story.iid, pub.headers), d => d && d.length >= 2)
  assert.deepEqual(diffs.map(d => d.new_path).sort(), [FEATURE, STEPS].sort())
  // Its pipeline runs before the card, so the page shows its final state.
  const pipeline = await waitMergeRequestPipeline(I, pub.projectName, story.iid, rootHeaders)
  assert.equal(pipeline.status, 'failed', `The pipeline must fail on the two failing probes, got ${pipeline.status}`)
  story.pipeline = pipeline.pid

  await gitlabFrame(I, 'probes-merge-request', gitlabUrl.mr(pub.projectName, story.iid, 'diffs'), {
    height: 840,
    waitText: 'report-probe.js'
  })
})

storyboardStep(When, 'its pipeline runs the three scenarios, and GitLab counts one pass and two failures', async () => {
  const { pub } = story
  // The twin: GitLab's own reading of the report, through its API.
  const report = await poll('pipeline test report', () => getPipelineTestReport(pub.projectName, story.pipeline, pub.headers), r => r && r.total_count === 3)
  assert.equal(report.failed_count, 2, JSON.stringify(report))
  assert.equal(report.success_count, 1, JSON.stringify(report))
  assert.equal(report.error_count, 0, JSON.stringify(report))
  story.cases = report.test_suites.flatMap(suite => suite.test_cases)

  await gitlabFrame(I, 'gitlab-test-report', `${gitlabUrl.pipeline(pub.projectName, story.pipeline)}/test_report`, {
    height: 700,
    waitText: JOB,
    textMasks: [[/\b\d+(\.\d+)?\s?(ms|s)\b/g, '']],
    // The summary lists one suite per job: open the job's, to list its cases.
    prepare: () => openSuite()
  })
})

storyboardStep(Then, 'GitLab shows the coloured failure as readable text, without the terminal colours', async () => {
  const { pub } = story
  const coloured = story.cases.find(c => c.name === COLOURED)
  assert.ok(coloured, `GitLab must list the coloured scenario: ${JSON.stringify(story.cases.map(c => c.name))}`)
  assert.equal(coloured.status, 'failed')
  const output = String(coloured.system_output || '')
  assert.ok(output.includes('Expected <hello> & "world", got café 🧪') && output.includes('Message ends here.'),
    `GitLab must read the whole failure message: ${JSON.stringify(coloured.system_output)}`)
  assert.equal(output.includes(String.fromCharCode(27)) || output.includes('[31m'), false, `No terminal colour may reach GitLab: ${JSON.stringify(output)}`)

  // The same page and size as the card before: the reader compares the two.
  await gitlabFrame(I, 'gitlab-coloured-failure', `${gitlabUrl.pipeline(pub.projectName, story.pipeline)}/test_report`, {
    height: 700,
    waitText: JOB,
    textMasks: [[/\b\d+(\.\d+)?\s?(ms|s)\b/g, '']],
    prepare: () => openSuite(COLOURED)
  })
})

storyboardStep(Then, 'the RED guard still accepts the coloured assertion as a genuine failure', async () => {
  // The same three scenarios, run locally the way the job ran them: the RED
  // gate reads the report the local run leaves.
  let run
  try {
    run = { code: 0, output: execSync(`${story.command} 2>&1`, { cwd: ROOT, env: story.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) }
  } catch (e) {
    run = { code: e.status, output: String(e.stdout || '') }
  }
  assert.notEqual(run.code, 0, 'Both assertion failures must fail the run')
  assert.match(run.output, /1 passed/)
  assert.match(run.output, /2 failed/)
  fs.writeFileSync(path.join(ROOT, 'check-report.py'), CHECK_XML)
  const parsed = JSON.parse(execSync(`python3 check-report.py ${REPORT}`, { cwd: ROOT, encoding: 'utf8' }))
  assert.deepEqual(parsed, { tests: 3, failures: [PLAIN, PLAIN + 'Message ends here.'], skipped: 0, errors: 0 })
  assert.equal(fs.readFileSync(path.join(ROOT, REPORT), 'utf8').includes(String.fromCharCode(27)), false, 'ANSI colours must not reach the XML')

  story.closeTerminal = await openLocalTerminal(I, { cwd: ROOT, env: story.env, port: 7693, height: 600 })
  // The report folder first: the card shows what the gate reads.
  const screen = await terminalCard(I, 'real-red-proof', `ls ${path.dirname(REPORT)} && task devsecops:test:check:red-is-real -- @report-colour`, { mask: ENGINE_MASKS })
  assert.ok(screen.includes('results-1.xml'), screen)
  assert.ok(screen.includes('The failure is real: the scenario ran and failed on its own check.'), screen)
  assert.ok(screen.includes('Expected <hello> & "world", got café 🧪 Keep this second line indented. Message ends here.'), `The gate must quote the check as plain text:\n${screen}`)
  assert.equal(/&#\d+;/.test(screen), false, `The gate must not quote XML escapes:\n${screen}`)
})
