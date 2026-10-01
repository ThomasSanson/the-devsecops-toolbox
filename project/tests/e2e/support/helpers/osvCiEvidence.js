/* global NodeFilter */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const {
  BASE_URL, projectPath, encodedProjectPath, getRootHeaders, createProject,
  deleteProject, createLambdaPersonalAccessToken, revokePersonalAccessToken,
  triggerProjectPipeline, listPipelineJobs, getPipeline
} = require('./gitlabApi')
const { registerScopedRunner, teardownScopedRunner, maskPipelinePage, PIPELINE_TIMEOUT_MS } = require('./pipelineRunner')
const { freshDelete } = require('./http')
const { addStoryboardFrame, capturePageFrame } = require('../../../../../.config/codeceptjs/storyboard')

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
    return execFileSync('curl', [
      '--fail', '--silent', '--show-error', '--header', `PRIVATE-TOKEN: ${this.headers['PRIVATE-TOKEN']}`,
      `${BASE_URL}/api/v4/projects/${encodedProjectPath(this.name)}/jobs/${jobId}/artifacts/${file}`
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 120000 })
  }

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
      await this.I.wait(5)
    }
    assert.ok(['success', 'failed'].includes(status), 'The actual CI job must finish')
    const jobs = (await listPipelineJobs(this.name, pid, this.headers)).data
    const job = jobs.find(job => job.name === jobName)
    assert.ok(job, `CI must run the actual ${jobName} job`)
    assert.equal(job.status, status)
    assert.equal(job.commit.id, this.sha, 'CI must run the published dependency snapshot')
    this.jobId = job.id
    this.pipelineId = pid
    this.job = job
    return job
  }

  async scan (result) {
    const job = await this.run()
    assert.equal(job.status, result.exitCode === 0 ? 'success' : 'failed', 'CI must preserve the native scanner verdict')
    // Read the original CI artifact, rather than trusting a red or green icon.
    const report = this.artifact(job.id, result.file)
    const localScans = result.report.split('\n').filter(line => line.startsWith('Scanned ')).sort()
    const remoteScans = report.split('\n').filter(line => line.startsWith('Scanned ')).sort()
    assert.deepEqual(remoteScans, localScans, 'CI must scan exactly the same dependency paths and package counts')
    for (const verdict of ['No issues found', 'GHSA-35jh-r3h4-6jhm']) {
      assert.equal(report.includes(verdict), result.report.includes(verdict), 'CI must reproduce the actual OSV finding')
    }
    fs.writeFileSync(path.join(__dirname, '../../_output/osv-reports', `ci-${job.id}.log`), report)
  }

  async repositoryFrame (name, file, text, { height = 900, focus = null } = {}) {
    this.I.resizeWindow(1440, height)
    await this.I.amOnPage(`/${projectPath(this.name)}/-/blob/main/${file}`)
    await this.I.waitForText(text, 60, '.file-content')
    await maskPipelinePage(this.I, this.name, { keepContext: true })
    await this.I.executeScript(() => {
      const walker = document.createTreeWalker(document.querySelector('.file-content'), NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      for (const node of nodes) node.nodeValue = node.nodeValue.replace(/\/tmp\/e2e-template-[0-9a-f]+/g, '<template>')
    })
    await this.capture(name, focus)
  }

  async pipelineFrame (name) {
    this.I.resizeWindow(1440, 900)
    await this.I.amOnPage(`/${projectPath(this.name)}/-/pipelines/${this.pipelineId}`)
    await this.I.waitForText(this.job.status === 'success' ? 'Passed' : 'Failed', 60)
    await this.I.waitForText(this.job.name, 60)
    await maskPipelinePage(this.I, this.name, { keepContext: true })
    await this.capture(name)
  }

  async reportFrame (name, result) {
    this.I.resizeWindow(2100, 1100)
    await this.I.amOnPage(`/${projectPath(this.name)}/-/jobs/${this.jobId}`)
    await this.I.waitForElement('[data-testid="job-log-content"]', 60)
    await this.I.waitForText('[osv-scanner]', 60, '[data-testid="job-log-content"]')
    // Open GitLab's own folded scanner section to show its original output.
    await this.I.executeScript(() => {
      const section = Array.from(document.querySelectorAll('.job-log-line-header'))
        .find(element => element.textContent.includes('[osv-scanner]'))
      if (section && !section.querySelector('[data-testid="chevron-lg-down-icon"]')) section.click()
      document.querySelectorAll('.job-log-line-header').forEach(header => {
        if (/Uploading artifacts|Cleaning up/.test(header.textContent) &&
            header.querySelector('[data-testid="chevron-lg-down-icon"]')) header.click()
      })
    })
    await this.I.waitForText(result.exitCode === 0 ? 'No issues found' : 'GHSA-35jh-r3h4-6jhm', 60, '[data-testid="job-log-content"]')
    await maskPipelinePage(this.I, this.name, { keepContext: true })
    await this.I.executeScript(() => {
      // OSV's filesystem counters and timings change between otherwise
      // identical scans. Keep the paths, advisory and verdict untouched.
      document.querySelectorAll('.job-log-line-number, .job-log-time, [class*="log-line-timestamp"], [class*="line-timestamp"]')
        .forEach(element => { element.style.visibility = 'hidden' })
      document.querySelectorAll('.job-log-line-header .badge').forEach(element => { element.style.visibility = 'hidden' })
      const log = document.querySelector('.job-log')
      log.style.lineHeight = `${Math.ceil(parseFloat(window.getComputedStyle(log).lineHeight))}px`
      const walker = document.createTreeWalker(document.querySelector('[data-testid="job-log-content"]'), NodeFilter.SHOW_TEXT)
      const nodes = []
      while (walker.nextNode()) nodes.push(walker.currentNode)
      for (const node of nodes) {
        node.nodeValue = node.nodeValue
          .replace(/\d+ (dirs visited|inodes visited)/g, '<count> $1')
          .replace(/\d+(?:\.\d+)?(?:ms|µs|s) (elapsed|wall time)/g, '<duration> $1')
          .replace(/\b\d+(?:\.\d+)?s +(?=\|)/g, '<duration>   ')
          .replace(/\b\d+(?:\.\d+)?s\b/g, '<duration>')
      }
    })
    await this.capture(name, null, result.exitCode === 0 ? 'No issues found' : 'packages affected by')
  }

  async capture (name, focus = null, logMarker = null) {
    await this.I.wait(1)
    await this.I.executeScript(() => {
      window.scrollTo(0, 0)
      document.querySelectorAll('main, .content-wrapper, .layout-page, .job-log, [data-testid="job-log-content"]').forEach(el => { el.scrollTop = 0 })
    })
    await this.I.wait(0.5)
    await this.I.moveCursorTo('body', 1, 1)
    // GitLab may introduce the repository tree after the page has loaded.
    // Close its real onboarding hint so it cannot cover the captured file.
    await this.I.executeScript(() => {
      const title = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, strong, div'))
        .find(el => Array.from(el.childNodes).some(node => node.nodeType === 3 && node.nodeValue.trim() === 'File tree navigation'))
      let hint = title
      while (hint && hint !== document.body && !hint.querySelector('button')) hint = hint.parentElement
      if (hint && hint !== document.body) hint.querySelector('button')?.click()
    })
    await this.I.waitForInvisible('//*[normalize-space(text())="File tree navigation"]', 10)
    await this.I.dontSee('File tree navigation')
    if (logMarker) {
      await this.I.executeScript(marker => {
        const line = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
          .find(element => element.textContent.includes(marker))
        if (!line) throw new Error(`The real OSV job log must contain ${marker}`)
        line.scrollIntoView({ block: 'center' })
        window.scrollTo(0, 0)
      }, logMarker)
      await this.I.waitForFunction(marker => {
        const line = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
          .find(element => element.textContent.includes(marker))
        const box = line?.getBoundingClientRect()
        return box && box.top >= 0 && box.bottom <= window.innerHeight
      }, [logMarker], 15)
    } else if (focus) await this.I.scrollTo(focus, 0, -300)
    await addStoryboardFrame(this.I, await capturePageFrame(this.I, name))
    this.I.resizeWindow(1024, 768)
  }
}

module.exports = { OsvCiEvidence }
