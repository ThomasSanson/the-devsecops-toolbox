/* global inject Before After Given When Then window document */
/**
 * @betterleaks-redact-config: how much of a detected secret Betterleaks hides,
 * told where a team meets it: the setting in the generated project on GitLab, a
 * branch carrying a made-up password, the generated code:betterleaks job of its
 * merge request printing REDACTED, then the developer's own terminal showing
 * more on request. One sentence = one card = one baseline, every card twinned
 * with a check of the same fact (REST on GitLab, the job trace, the clone, and
 * the dry runs of all six scans).
 */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const {
  BASE_URL, encodedProjectPath, getRootHeaders, getRepositoryFile, getJobTrace, listCommits,
  createMergeRequestWhenBranchExists, getPipeline, listPipelineJobs, listProjectPipelines
} = require('../helpers/gitlabApi')
const {
  registerScopedRunner, teardownScopedRunner, cancelRedundantPipelines, waitMergeRequestPipeline
} = require('../helpers/pipelineRunner')
const { setupClonedProjectTerminal, teardownJourneyTerminal, PROJECT_DIR } = require('../helpers/journeyContainer')
const { execInContainer, execInContainerAsUser, runCommand, shellEscape, stripAnsiEscapeSequences } = require('../helpers/docker')
const { freshGet } = require('../helpers/http')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

// Built from parts so this file never holds the value a scanner would flag.
const SECRET = ['Zt7k', 'Q2mV', '9pL4', 'xR8w'].join('')
const BRANCH = 'feature/synthetic-password'
const COMMIT = 'feat: connect the service to its database'
const SETTING = '.config/betterleaks/Taskfile.yml'
const CI_FIXTURE = path.join(__dirname, '../../fixtures/betterleaks-redact/gitlab-ci.yml')
const VERDICT = 'Betterleaks detected secrets in your branch commits!'
// The top line of the finding box Betterleaks prints, rule name included.
const FINDING = '┌─generic-password'
// The two ways a developer overrides the setting: the environment, and a task
// variable after the command. Each is a card's # Copy.
const OVERRIDE_ENVIRONMENT = 'TASK_BETTERLEAKS_REDACT=25 task betterleaks:scan-branch'
const OVERRIDE_VARIABLE = 'task betterleaks:scan-branch TASK_BETTERLEAKS_REDACT=0'
// What Betterleaks prints that is new on every run: its clock, the commit date,
// the bytes it read and how long that took.
const SCAN_MASKS = [
  [/\b\d{1,2}:\d{2}(AM|PM)\b/g, '<time>'],
  [/\d{4}-\d{2}-\d{2}T\S+/g, '<date>'],
  [/scanned ~\d+ bytes/g, 'scanned <bytes> bytes'],
  [/\(\d+(\.\d+)? (bytes|B|KB|MB)\)/g, '(<size>)'],
  [/ in (\d+(\.\d+)?(µs|μs|ns|ms|s|m|h))+/g, ' in <duration>']
]
// The job log masks commit SHAs itself; the terminal shows the merge base and
// the commit of the finding.
const TERMINAL_MASKS = [[/\b[0-9a-f]{40}\b/g, '<sha>'], ...SCAN_MASKS]

let s

Before(() => { s = {} })

After(async () => {
  teardownJourneyTerminal(s.terminal)
  if (s.pub) {
    const root = await getRootHeaders()
    // A failed run must not leave a job queued on the shared runner.
    await cancelRedundantPipelines(s.pub.projectName, 0, root)
    await teardownScopedRunner(s.runner, root)
    await s.pub.teardown()
  }
  removeRendered(s.dir)
})

// The dry runs of all six scans (full, staged and branch, in Docker and binary
// mode) resolve --redact to `expected`, with no override, from the environment,
// or from a task variable. The programmatic twin of every card.
function checkScans (expected, override = null) {
  const env = { ...process.env }
  delete env.TASK_BETTERLEAKS_REDACT
  if (override === 'environment') env.TASK_BETTERLEAKS_REDACT = expected
  for (const mode of ['docker', 'binary']) {
    for (const scan of ['scan-full', 'protect', 'scan-branch']) {
      const args = [`betterleaks:${scan}`, '--dry', '--verbose', `TASK_BETTERLEAKS_MODE=${mode}`]
      if (override === 'variable') args.push(`TASK_BETTERLEAKS_REDACT=${expected}`)
      const result = spawnSync('task', args, { cwd: s.dir, env, encoding: 'utf8', timeout: 30000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${mode}/${scan}: dry run must finish`)
      const flags = [...(result.stdout + result.stderr).matchAll(/--redact=(?:"([^"]*)"|([^\s]+))/g)]
      assert.equal(flags.length, 1, `${mode}/${scan}: one redaction argument`)
      assert.equal(flags[0][1] ?? flags[0][2], expected, `${mode}/${scan}: redaction must be ${expected}`)
    }
  }
}

// Run a script in the developer's clone, inside the terminal container.
function inClone (script) {
  const res = execInContainerAsUser(s.terminal, 'bootstrap', `cd ${PROJECT_DIR}\n${script}`, { timeout: 300000 })
  if (res.exitCode !== 0) throw new Error(`The clone refused \`${script.split('\n')[0]}\`:\n${res.output}`)
  return stripAnsiEscapeSequences(res.output || '').trim()
}

// The size GitLab prints after a file's name moves by a fraction of a pixel
// from one load to the next, and says nothing the card is about.
const FILE_SIZE = ['.file-header-content small']

// GitLab scrolls a #L anchor towards the top of the window, past the file's
// own header, and its left menu towards the current page on a short window:
// everything back to the top, the highlighted line still in view.
async function pageTop () {
  await I.executeScript(() => {
    window.scrollTo(0, 0)
    document.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0 })
  })
  await settlePage(I, { quietMs: 300 })
}

// Off camera: the generated project, its pipeline cut down to the secret scan
// (fixtures/betterleaks-redact/gitlab-ci.yml plus the generated image line),
// pushed to a public project of the lambda user. Locked-down runners answer, so
// every scan runs from the pinned binary, in CI as in the developer's terminal.
// The twins: the raw file on the main branch, the six --redact arguments, and
// the dry runs of the six scans with no override.
storyboardStep(Given, 'GitLab shows that the generated project hides 100 percent of a detected value by default', async () => {
  s.dir = renderProject({ privileged_ci_runners: false })
  const image = fs.readFileSync(path.join(s.dir, '.gitlab-ci.yml'), 'utf8').match(/^image: .+$/m)
  assert.ok(image, 'The generated pipeline must name its image')
  fs.writeFileSync(path.join(s.dir, '.gitlab-ci.yml'), `${fs.readFileSync(CI_FIXTURE, 'utf8')}\n${image[0]}\n`)
  s.pub = await publishToGitLab(s.dir, {
    name: `betterleaks-redact-${crypto.randomBytes(4).toString('hex')}`,
    message: 'chore: generate the project with the DevSecOps Toolbox',
    project: { shared_runners_enabled: false }
  })
  // 500 px: the branch, the last commit and the vars block, line 8 among them.
  await gitlabFrame(I, 'redaction-setting', gitlabUrl.file(s.pub.projectName, 'main', SETTING, [8]), {
    waitText: 'TASK_BETTERLEAKS_REDACT', height: 500, scrollTo: pageTop, hide: FILE_SIZE
  })
  const setting = await getRepositoryFile(s.pub.projectName, SETTING, 'main', s.pub.headers)
  assert.equal(setting.split('\n')[7], '  TASK_BETTERLEAKS_REDACT: \'{{.TASK_BETTERLEAKS_REDACT | default "100"}}\'',
    'Line 8 of the setting on the main branch must default to 100')
  assert.equal((setting.match(/--redact="\{\{\.TASK_BETTERLEAKS_REDACT\}\}"/g) || []).length, 6,
    'Every scan must pass the setting to Betterleaks')
  checkScans('100')
})

// The developer works in a fresh clone of the project, in the terminal
// container: git never copies hooks on a clone, so the commit goes through.
// The card is the file on the branch, taken BEFORE the merge request exists,
// so no pipeline status reaches the last-commit box. The twins: the branch
// head is the clone's commit and carries the value, the main branch does not,
// and the push started no pipeline (the generated workflow ignores branches).
storyboardStep(When, 'a developer pushes a branch with a synthetic password in it', async () => {
  s.terminal = setupClonedProjectTerminal(s.pub.projectName, s.pub.token)
  // The suite's own Task binary: no download, and the version the dry runs use.
  runCommand(`docker cp ${shellEscape(fs.realpathSync(runCommand('command -v task').trim()))} ${shellEscape(`${s.terminal}:/usr/local/bin/task`)}`)
  execInContainer(s.terminal, 'chmod 0755 /usr/local/bin/task', { user: 'root' })
  inClone([
    `git switch -q -c ${BRANCH}`,
    'mkdir -p src',
    `printf 'const password = "%s";\\n' ${SECRET} > src/service.js`,
    'git add src/service.js',
    `git commit -q -m ${shellEscape(COMMIT)}`,
    `git push -q origin ${BRANCH}`
  ].join('\n'))
  s.head = inClone('git rev-parse HEAD')
  // GitLab learns about a pushed branch in the background: on a busy instance
  // its page answers 404 for a while, and a loaded 404 never turns into the file.
  const page = gitlabUrl.file(s.pub.projectName, BRANCH, 'src/service.js')
  const deadline = Date.now() + 120000
  while ((await freshGet(`${BASE_URL}${page}`, {}, { raw: true })).status !== 200) {
    assert.ok(Date.now() < deadline, `GitLab never served ${page}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  await gitlabFrame(I, 'redaction-pushed-branch', page, {
    waitText: COMMIT, height: 700, scrollTo: pageTop, hide: FILE_SIZE
  })
  const commits = await listCommits(s.pub.projectName, BRANCH, s.pub.headers)
  assert.equal(commits[0].id, s.head, 'GitLab must hold the commit the developer pushed')
  const file = await getRepositoryFile(s.pub.projectName, 'src/service.js', BRANCH, s.pub.headers)
  assert.equal(file, `const password = "${SECRET}";\n`)
  await assert.rejects(getRepositoryFile(s.pub.projectName, 'src/service.js', 'main', s.pub.headers),
    /HTTP 404/, 'The main branch must not hold the password')
  const pipelines = await listProjectPipelines(s.pub.projectName, s.pub.headers)
  assert.deepEqual(pipelines.data, [], 'Pushing a branch must start no pipeline')
})

// The merge request starts the generated pipeline, with no CI/CD variable set,
// on a project-scoped runner. The card is the real job page, its log from the
// finding box on, cut by the window right under the box. Only the box holds
// still from one run to the next: GitLab Runner reads the job's stdout and
// stderr apart, so task's echoes and Betterleaks' INF/WRN lines land in a
// different place around it on every run. The twins read the whole trace: the
// install, the rule, the file, the REDACTED line, the verdict, GitLab's last
// line, and never the value.
storyboardStep(Then, 'the Betterleaks job fails on GitLab and its log prints REDACTED instead of the password', async () => {
  const root = await getRootHeaders()
  s.runner = await registerScopedRunner(I, s.pub.projectName, root)
  const opened = await createMergeRequestWhenBranchExists(s.pub.projectName,
    { source_branch: BRANCH, target_branch: 'main', title: COMMIT }, s.pub.headers)
  assert.ok(opened.status < 400, `Opening the merge request returned ${opened.status}: ${JSON.stringify(opened.data)}`)
  const mr = opened.data
  const { pid, status } = await waitMergeRequestPipeline(I, s.pub.projectName, mr.iid, s.pub.headers)
  const jobs = (await listPipelineJobs(s.pub.projectName, pid, s.pub.headers)).data
  assert.deepEqual(jobs.map(job => job.name), ['code:betterleaks'], 'The pipeline must run the secret scan alone')
  const trace = stripAnsiEscapeSequences(await getJobTrace(s.pub.projectName, jobs[0].id, s.pub.headers))
  const evidence = path.join(global.output_dir, 'betterleaks-redact-config')
  fs.mkdirSync(evidence, { recursive: true })
  fs.writeFileSync(path.join(evidence, `ci-job-${jobs[0].id}.log`), trace)
  assert.equal(status, 'failed', 'The merge request pipeline must fail')
  assert.equal(jobs[0].status, 'failed', 'code:betterleaks must fail')
  const pipeline = (await getPipeline(s.pub.projectName, pid, s.pub.headers)).data
  assert.equal(pipeline.source, 'merge_request_event', 'The pipeline must belong to the merge request')
  assert.equal(pipeline.sha, s.head, 'The pipeline must scan the pushed commit')
  const variables = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(s.pub.projectName)}/variables`, s.pub.headers)
  assert.deepEqual(variables.data, [], 'No CI/CD variable may change the default')
  for (const said of ['🔧 Running betterleaks from the pinned binary, no container', FINDING, 'src/service.js',
    'const password = "REDACTED";', 'WRN leaks found: 1', VERDICT, 'ERROR: Job failed']) {
    assert.ok(trace.includes(said), `The job log must say ${said}`)
  }
  assert.ok(!trace.includes(SECRET.slice(0, 4)), 'The job log must not print any part of the password')
  // 574 px: GitLab's panel ends the log 18 px above the window's edge, so the
  // last row shown is the box's closing line, before the first line that moves.
  await jobLogFrame(I, 'redaction-ci-job-log', s.pub.projectName, jobs[0].id, {
    from: FINDING, masks: SCAN_MASKS, height: 574
  })
})

// Off camera, once: the pinned binary in the clone. On camera, ONE typed line
// each, in the same clone. The twins: the screen shows the finding once, the
// value cut as the setting says, and the scan still fails; and the dry runs of
// all six scans take the same override the same way.
async function overrideCard (frame, command, expected, override) {
  if (!s.terminalOpen) {
    inClone('task betterleaks:install')
    await openTerminal(I, s.terminal, { width: 1440, height: 1000 })
    s.terminalOpen = true
  }
  const masks = [[new RegExp(s.pub.projectName, 'g'), 'project'], ...TERMINAL_MASKS]
  const screen = await terminalCard(I, frame, command, { mask: masks })
  const shown = screen.split('\n').filter(line => line.includes('const password = '))
  assert.equal(shown.length, 1, `The scan must show the finding once:\n${screen}`)
  assert.equal(screen.split(VERDICT).length - 1, 1, `The scan must still fail:\n${screen}`)
  checkScans(expected, override)
  return shown[0]
}

storyboardStep(Then, 'the developer\'s terminal shows the first 12 characters of the password with the setting at 25', async () => {
  const line = await overrideCard('redaction-environment', OVERRIDE_ENVIRONMENT, '25', 'environment')
  assert.ok(line.includes(`"${SECRET.slice(0, 12)}..."`) && !line.includes(SECRET),
    `With 25 the scan must hide the last quarter of the value:\n${line}`)
})

// The twins also prove nothing left the machine: the clone is clean and
// GitLab's branch has not moved.
storyboardStep(Then, 'the developer\'s terminal shows the whole password with the setting at 0', async () => {
  const line = await overrideCard('redaction-zero', OVERRIDE_VARIABLE, '0', 'variable')
  assert.ok(line.includes(`"${SECRET}"`), `With 0 the scan must show the whole value:\n${line}`)
  assert.equal(inClone('git status --porcelain'), '', 'The scans must leave the clone clean')
  const commits = await listCommits(s.pub.projectName, BRANCH, s.pub.headers)
  assert.equal(commits[0].id, s.head, 'Nothing may reach GitLab')
})
