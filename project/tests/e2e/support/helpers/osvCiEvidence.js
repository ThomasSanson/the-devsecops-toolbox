/* global document window */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { parentPort, workerData } = require('worker_threads')
const {
  BASE_URL, projectPath, encodedProjectPath, getRootHeaders, createProject,
  deleteProject, createLambdaPersonalAccessToken, revokePersonalAccessToken,
  triggerProjectPipeline, listPipelineJobs, getPipeline, getCommitDiff
} = require('./gitlabApi')
const { registerScopedRunner, teardownScopedRunner, PIPELINE_TIMEOUT_MS } = require('./pipelineRunner')
const { freshDelete } = require('./http')
const { stableJobLog } = require('./stableJobLog')
const { stripAnsiEscapeSequences } = require('./docker')
const { JOB_LOG_MASKS, gitlabUrl, gitlabFrame, jobLogFrame, settlePage } = require('./gitlabCard')

const REPORTS = path.join(__dirname, '../../_output/osv-reports')
const LOG = '[data-testid="job-log-content"]'
// GitLab keeps the navigation folded for a reader who folded it once.
const NAV_FOLDED = 'super_sidebar_collapsed'
// What moves between two otherwise identical OSV runs: its filesystem counters
// and every timing. The Elapsed time column keeps its width, so the summary
// table's last border does not move either.
const OSV_MASKS = [
  [/\d+ (dirs visited|inodes visited)/, '<count> $1'],
  [/\d+(?:\.\d+)?(?:ms|µs|s) (elapsed|wall time)/, '<duration> $1'],
  [/\b\d+(?:\.\d+)?s +(?=\|)/, '<duration>   '],
  [/\b\d+(?:\.\d+)?s\b/, '<duration>']
]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Repeat the existing local scan in a real CI job. The local regression checks
// stay independent; a failed runner setup cannot masquerade as an OSV finding.
class OsvCiEvidence {
  constructor (I, userPage, name) {
    this.I = I
    this.userPage = userPage
    this.name = name
    this.directory = fs.mkdtempSync('/tmp/osv-ci-evidence-')
  }

  git (...args) {
    return execFileSync('git', ['-C', this.directory, ...args], {
      encoding: 'utf8', stdio: 'pipe', timeout: 300000
    }).trim()
  }

  async open () {
    this.rootHeaders = await getRootHeaders()
    const pat = await createLambdaPersonalAccessToken(this.name, ['api', 'write_repository'], this.rootHeaders)
    this.tokenId = pat.id
    this.headers = { 'PRIVATE-TOKEN': pat.token }
    await deleteProject(this.name, this.rootHeaders)
    const created = await createProject({ name: this.name, visibility: 'public', initialize_with_readme: false }, this.headers)
    assert.equal(created.status, 201, 'The CI evidence project must be created')
    this.created = created.data.id
    this.git('init', '--quiet', '--initial-branch=main')
    this.git('config', 'user.email', 'lambda@test.local')
    this.git('config', 'user.name', 'Lambda')
    this.git('config', 'core.hooksPath', '/dev/null')
    const user = process.env.TASK_GITLAB_LAMBDA_USER
    const remote = new URL(`${BASE_URL}/${projectPath(this.name)}.git`)
    remote.username = user
    remote.password = pat.token
    this.git('remote', 'add', 'origin', remote.toString())
    await this.userPage.loginAs(user, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
    this.runner = await registerScopedRunner(this.I, this.name, this.rootHeaders)
  }

  async close () {
    try {
      if (this.runner) await teardownScopedRunner(this.runner, this.rootHeaders)
    } finally {
      try {
        if (this.created) await freshDelete(`${BASE_URL}/api/v4/projects/${this.created}`, this.rootHeaders)
      } finally {
        if (this.tokenId) await revokePersonalAccessToken(this.tokenId, this.rootHeaders)
        fs.rmSync(this.directory, { recursive: true, force: true })
      }
    }
  }

  async publish (source, title) {
    if (!this.headers) await this.open()
    // Keep a separate mirror: adding a CI fixture must not change what the
    // original Copier and scanner regression checks read or update.
    for (const entry of fs.readdirSync(this.directory)) {
      if (entry !== '.git') fs.rmSync(path.join(this.directory, entry), { recursive: true, force: true })
    }
    fs.cpSync(source, this.directory, {
      recursive: true,
      filter: file => !path.relative(source, file).split(path.sep).some(part =>
        ['.git', 'node_modules', 'megalinter-reports', '_output', 'tmp'].includes(part)) &&
        !/^project\/(tests|gitlab|ubuntu)(\/|$)/.test(path.relative(source, file))
    })
    // Select the generated MegaLinter job unchanged. The fixture only selects
    // when it runs; its image, commands and artifacts come from the framework.
    fs.copyFileSync(path.join(__dirname, '../../fixtures/osv-scope/megalinter-ci.yml'),
      path.join(this.directory, '.gitlab-ci.yml'))
    this.git('add', '-A')
    const database = '.cache/osv-scanner/npm/all.zip'
    if (fs.existsSync(path.join(this.directory, database))) this.git('add', '-f', database)
    if (this.sha && !this.git('diff', '--cached', '--name-only')) return
    this.git('commit', '--quiet', '--allow-empty', '-m', title)
    this.sha = this.git('rev-parse', 'HEAD')
    try { this.git('push', '--quiet', '-u', 'origin', 'main') } catch (_) {
      throw new Error('Could not publish the disposable CI evidence project')
    }
  }

  async publishTask (source) {
    if (!this.headers) await this.open()
    fs.copyFileSync(path.join(source, 'Taskfile.yml'), path.join(this.directory, 'Taskfile.yml'))
    fs.copyFileSync(path.join(__dirname, 'taskProcess.js'), path.join(this.directory, 'taskProcess.js'))
    fs.copyFileSync(path.join(__dirname, '../../fixtures/osv-scope/worker-probe.js'), path.join(this.directory, 'worker-probe.js'))
    fs.cpSync('/workspace/.config/task', path.join(this.directory, '.config/task'), { recursive: true })
    const version = JSON.parse(fs.readFileSync('/workspace/.config/megalinter/package.json', 'utf8')).dependencies['mega-linter-runner']
    fs.writeFileSync(path.join(this.directory, 'ci-evidence.yml'), "version: '3'\ntasks:\n  worker:\n    cmds:\n      - node worker-probe.js\n")
    fs.writeFileSync(path.join(this.directory, '.gitlab-ci.yml'), [
      'workflow:', '  rules:', '    - if: $CI_PIPELINE_SOURCE == "api"',
      'stages: [test]', 'test:task-progress:', '  stage: test',
      '  tags: [saas-linux-medium-amd64]', '  image:',
      `    name: ghcr.io/oxsecurity/megalinter:v${version}`, '    entrypoint: [""]',
      '  before_script:', '    - .config/task/install.sh',
      '  script:', '    - task --taskfile ci-evidence.yml worker',
      '  artifacts:', '    when: always', '    paths: [worker-result.json]', ''
    ].join('\n'))
    this.git('add', '-A')
    this.git('commit', '--quiet', '-m', 'test: preserve a failed worker task')
    this.sha = this.git('rev-parse', 'HEAD')
    try { this.git('push', '--quiet', '-u', 'origin', 'main') } catch (_) {
      throw new Error('Could not publish the disposable worker CI project')
    }
  }

  async taskResult (local) {
    const job = await this.run('test:task-progress')
    assert.equal(job.status, 'failed', 'The CI worker must preserve the failed task status')
    const remote = JSON.parse(this.artifact(job.id, 'worker-result.json'))
    assert.equal(remote.raw, local.raw, 'The CI worker must emit the same real task output')
    assert.equal(remote.exitCode, local.exitCode, 'The CI worker must preserve the same exit code')
    assert.equal(remote.progress.join(''), remote.raw, 'The CI monitor must receive every actual output byte')
  }

  artifact (jobId, file) {
    return this.jobText(jobId, `artifacts/${file}`)
  }

  redact (text) {
    const secrets = [
      ...Object.values(this.headers || {}), ...Object.values(this.rootHeaders || {}), this.runner?.runnerToken,
      ...Object.entries(process.env).filter(([key]) => /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/.test(key)).map(([, value]) => value)
    ].filter(value => typeof value === 'string' && value.length >= 4)
    let safe = stripAnsiEscapeSequences(text)
    for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
    return safe.replace(/gl(?:pat|rt|dt)-[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/(https?:\/\/)[^ /@\n]+:[^ /@\n]+@/g, '$1[REDACTED]@')
  }

  jobText (jobId, endpoint) {
    try {
      return execFileSync('curl', [
        '--fail', '--silent', '--show-error', '--header', `PRIVATE-TOKEN: ${this.headers['PRIVATE-TOKEN']}`,
        `${BASE_URL}/api/v4/projects/${encodedProjectPath(this.name)}/jobs/${jobId}/${endpoint}`
      ], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 })
    } catch (error) {
      // The child-process error includes curl's authenticated arguments.
      throw new Error(`CI job ${jobId}: cannot read ${endpoint}: ${this.redact(String(error.stderr || error.code || error.status))}`)
    }
  }

  saveTrace (job) {
    fs.mkdirSync(REPORTS, { recursive: true })
    fs.writeFileSync(path.join(REPORTS, `ci-${job.id}-trace.log`), this.redact(this.jobText(job.id, 'trace')))
  }

  // Plain timers, not I.wait: a caller may start the pipeline and run the local
  // scan while this one polls. Each poll tells CodeceptJS's worker monitor the
  // test is alive: it ends a worker silent for 5 minutes, and a pipeline can
  // wait that long for the runner or the MegaLinter image.
  async run (jobName = 'code:megalinter') {
    if (this.job && this.job.commit.id === this.sha) return this.job
    const triggered = await triggerProjectPipeline(this.name, 'main', this.headers)
    assert.equal(triggered.status, 201, `The real CI pipeline must start: ${JSON.stringify(triggered.data)}`)
    const pid = triggered.data.id
    const deadline = Date.now() + PIPELINE_TIMEOUT_MS
    let status
    while (Date.now() < deadline) {
      status = (await getPipeline(this.name, pid, this.headers)).data.status
      if (['success', 'failed', 'canceled', 'skipped'].includes(status)) break
      console.log(`OSV CI pipeline: ${status}`)
      parentPort?.postMessage({ type: 'osv-ci-wait', workerIndex: workerData?.workerIndex, status })
      await sleep(5000)
    }
    assert.ok(['success', 'failed'].includes(status), `The actual CI job must finish, the pipeline is ${status}`)
    const jobs = (await listPipelineJobs(this.name, pid, this.headers)).data
    const job = jobs.find(job => job.name === jobName)
    assert.ok(job, `CI must run the actual ${jobName} job`)
    // Preserve evidence before status assertions or missing scanner artifacts
    // can fail. Cleanup deletes the disposable project, including its job logs.
    this.saveTrace(job)
    assert.equal(job.status, status)
    assert.equal(job.commit.id, this.sha, 'CI must run the published dependency snapshot')
    this.jobId = job.id
    this.job = job
    return job
  }

  async scan (result) {
    const job = await this.run()
    // Read the original CI artifact, rather than trusting a red or green icon.
    // Keep it before assertions too, alongside the trace saved by run().
    const report = this.artifact(job.id, result.file)
    fs.writeFileSync(path.join(REPORTS, `ci-${job.id}.log`), this.redact(report))
    assert.equal(job.status, result.exitCode === 0 ? 'success' : 'failed', 'CI must preserve the native scanner verdict')
    const localScans = result.report.split('\n').filter(line => line.startsWith('Scanned ')).sort()
    const remoteScans = report.split('\n').filter(line => line.startsWith('Scanned ')).sort()
    assert.deepEqual(remoteScans, localScans, 'CI must scan exactly the same dependency paths and package counts')
    for (const verdict of ['No issues found', 'GHSA-35jh-r3h4-6jhm']) {
      assert.equal(report.includes(verdict), result.report.includes(verdict), 'CI must reproduce the actual OSV finding')
    }
  }

  // One file of the main branch, as GitLab shows it.
  async fileFrame (frameName, file, text) {
    await gitlabFrame(this.I, frameName, gitlabUrl.file(this.name, 'main', file), { waitText: text })
  }

  // The page of the last published commit: its title and every file it
  // changed. Taken before any pipeline runs on it, so no status badge sits on
  // the page. The twin reads the same commit through REST: exactly these
  // files, each added or deleted as the card shows it, each diff with `text`.
  async commitFrame (frameName, files, { change = null, text = null, height = 1100 } = {}) {
    const diff = await getCommitDiff(this.name, this.sha, this.headers)
    assert.deepEqual(diff.map(entry => entry.new_path).sort(), [...files].sort(), `The commit must change exactly ${files.join(', ')}`)
    for (const entry of diff) {
      if (change) assert.equal(entry[`${change}_file`], true, `${entry.new_path} must be ${change}`)
      if (text) assert.ok(entry.diff.includes(text), `${entry.new_path} must change a line with ${text}`)
    }
    const paths = [...files]
    await gitlabFrame(this.I, frameName, gitlabUrl.commit(this.name, this.sha), {
      height,
      // A per-run template directory in the Copier answers' context lines.
      textMasks: [[/\/tmp\/e2e-template-[0-9a-f]+/, '<template>']],
      // GitLab draws the diffs after the page: every file named in them.
      prepare: () => this.I.waitForFunction(([wanted]) => wanted.every(file => document.body.innerText.includes(file)), [paths], 60)
    })
  }

  // The worker's job, its log from the typed command down: the runner's own
  // preamble (its version, name, token and the checked-out SHA) stays above.
  async taskLogFrame (frameName) {
    await jobLogFrame(this.I, frameName, this.name, this.jobId, {
      from: '$ task --taskfile ci-evidence.yml worker',
      fold: ['Uploading artifacts', 'Cleaning up'],
      waitText: 'Worker task exit code',
      // The whole job page, its details panel included, without the empty page below.
      height: 720
    })
  }

  // The OSV job's page, its log from the scanner's command line down.
  // OSV prints its findings as a table about 145 characters wide, and GitLab
  // wraps a job log at the width of its panel: at 1440 px, between the
  // navigation and the job details, every row would break in the middle of a
  // path. Both side panels fold away the way GitLab folds them itself (the
  // navigation by the reader's saved choice, the job details by GitLab's own
  // toggle), so the log runs the whole card and every row stays on one line;
  // the job's name and status stay on top.
  // ponytail: jobLogFrame without its side panels; one `prepare` option on
  // jobLogFrame would let this call it instead.
  async osvLogFrame (frameName, { verdict, from = 'Command: [osv-scanner', masks = [] }) {
    const I = this.I
    await I.usePlaywrightTo('fold the navigation', async ({ page }) =>
      page.context().addCookies([{ name: NAV_FOLDED, value: 'true', url: BASE_URL }]))
    try {
      await gitlabFrame(I, frameName, gitlabUrl.job(this.name, this.jobId), {
        height: 1100,
        waitText: 'osv-scanner',
        textMasks: [...JOB_LOG_MASKS, ...OSV_MASKS, ...masks],
        prepare: async () => {
          await I.waitForElement(LOG, 60)
          await this.foldJobDetails()
          await I.executeScript(() => document.querySelectorAll('.job-log-line-header').forEach(header => {
            const open = Boolean(header.querySelector('[data-testid="chevron-lg-down-icon"]'))
            const wantOpen = header.textContent.includes('[osv-scanner]')
            if (wantOpen ? !open : open && /Uploading artifacts|Cleaning up/.test(header.textContent)) header.click()
          }))
          await settlePage(I)
          await I.waitForText(verdict, 60, LOG)
          await I.executeScript(stableJobLog)
          await I.executeScript((marker) => {
            const lines = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
            const start = lines.findIndex(line => line.textContent.includes(marker))
            if (start === -1) throw new Error(`The OSV job log has no line with ${marker}`)
            lines.slice(0, start).forEach(line => line.setAttribute('data-e2e-mask', ''))
            lines.forEach(line => { if (/runner-\S+.*disconnected from network/i.test(line.textContent)) line.setAttribute('data-e2e-mask', '') })
            document.querySelectorAll('.job-log-line-number, .job-log-line-header .badge').forEach(el => el.setAttribute('data-e2e-blank', ''))
            document.querySelectorAll('.job-log-time, [class*="log-line-timestamp"], [class*="line-timestamp"]').forEach(el => el.setAttribute('data-e2e-mask', ''))
            const box = document.querySelector('.job-log')
            if (box) box.style.lineHeight = `${Math.ceil(parseFloat(window.getComputedStyle(box).lineHeight))}px`
          }, from)
        }
      })
    } finally {
      await I.usePlaywrightTo('unfold the navigation', async ({ page }) => page.context().clearCookies({ name: NAV_FOLDED }))
    }
  }

  // The job details fold away through GitLab's own toggle, the one it shows
  // when the page is narrow: the log takes their width.
  async foldJobDetails () {
    await this.I.executeScript(() => {
      const toggle = document.querySelector('button[aria-label="Toggle sidebar"]')
      if (!toggle) throw new Error('The job page has no "Toggle sidebar" button')
      toggle.click()
    })
    await this.I.waitForInvisible('[data-testid="job-sidebar"]', 30)
  }
}

module.exports = { OsvCiEvidence }
