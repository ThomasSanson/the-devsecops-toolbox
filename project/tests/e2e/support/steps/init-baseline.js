/* global inject Before After Given When Then */
/**
 * @protected-commits — the commit checks a generated project ships, told from
 * a teammate's laptop to GitLab. (The file keeps its historical name: the
 * suite's configuration and the @tdd-cycle fixture both name it.)
 *
 * ONE render answering that its runners refuse privileged containers, so every
 * secret scan runs the pinned betterleaks binary, on the laptop as in CI. It is
 * published on the test GitLab, cloned anonymously by the teammate, and every
 * terminal card runs in that clone, in order: the hooks turned on, a sloppy
 * message refused then fixed, a key refused, forced, caught, deleted in vain,
 * cleaned out of the history. Two merge requests close the story on GitLab.
 *
 * The terminal cards are the commands' real output, replayed by
 * terminalRender: the test runner has no live terminal. Only volatile values
 * are masked: SHAs, dates, times, durations, and the tool versions Renovate
 * bumps. Every card is twinned with a check of the same fact.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { I, GitLabProjectPage, GitLabUserPage } = inject()
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabUrl, gitlabFrame, jobLogFrame, settlePage } = require('../helpers/gitlabCard')
const {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  getMergeRequest,
  listProjectMergeRequests,
  listPipelineJobs,
  getJobTrace,
  getRepositoryFile
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const {
  registerScopedRunner,
  teardownScopedRunner,
  waitMergeRequestPipeline,
  dumpFailedTraces
} = require('../helpers/pipelineRunner')
const { screenText, maskText, terminalOutputFrame } = require('../helpers/terminalRender')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const PROJECT = 'e2e-commit-hooks'
const CLONE = `/tmp/${PROJECT}`
const CLONE_URL = `http://gitlab/${process.env.TASK_GITLAB_LAMBDA_USER}/${PROJECT}.git` // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
const KEY_FILE = 'deploy-key.pem'
// A fake key. Its header is split so this file never carries one a scanner would flag.
const KEY_BODY = 'MIIEpAIBAAKCAQEA0testsecretfortemplategitleakstestingonly0000000000'
const KEY_LINES = [['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '), KEY_BODY, ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')]
const SECRETS_YAML = `production:\n  deploy_key: |\n${KEY_LINES.map(l => `    ${l}`).join('\n')}\n`
const NOTES = '# Deploy\n\nThe deploy key sits next to this file, in deploy-key.pem. It never leaves this machine.\n'
// What `task devsecops:init` applies to a project (glab:merge-settings,
// default values), set at creation since this story does not run init.
const MERGE_SETTINGS = {
  merge_method: 'ff',
  squash_option: 'default_off',
  remove_source_branch_after_merge: true,
  only_allow_merge_if_pipeline_succeeds: true,
  only_allow_merge_if_all_discussions_are_resolved: true,
  printing_merge_request_link_enabled: true
}
// Every code check but the secret scan, switched off in the demo project.
const OTHER_CODE_JOBS = ['code:project', 'code:commitlint', 'code:commitizen-check', 'code:commitizen-bump-dry',
  'code:lizard', 'code:renovate-validate', 'code:megalinter', 'code:all']
const GREY = '\u001b[90m'
const RESET = '\u001b[0m'
// Volatile values only. Versions first: Renovate bumps them, and the stories
// are about what the hooks say, not which release said it.
const MASKS = [
  [/lefthook v\d+(?:\.\d+)+/g, 'lefthook v<version>'],
  [/betterleaks \d+(?:\.\d+)+/g, 'betterleaks <version>'],
  [/commitizen==\d[\w.]*/g, 'commitizen==<version>'],
  [/\b[0-9a-f]{7,40}\b/g, '<sha>'],
  // filter-branch refreshes its commit counter only when it reads the clock,
  // so whether the last line says 3/4 or 4/4 depends on a second boundary.
  [/(Rewrite <sha> \()\d+\//g, '$1<n>/'],
  [/\b\d{4}-\d{2}-\d{2}T\S+/g, '<date>'],
  [/\b\d{1,2}:\d{2}(?::\d{2})?(?:AM|PM)\b/g, '<time>'],
  [/\b\d+(?:\.\d+)?(?:µs|ms|s)\b/g, '<duration>'],
  [/\(done in [\d.]+ seconds\)/g, '(done in <duration>)'],
  [/\(\d+ seconds passed, remaining \d+ predicted\)/g, '(<n> seconds passed, remaining <n> predicted)']
]
// The same values in the job log of the pipeline (SHAs are already masked there).
const JOB_MASKS = MASKS.filter(([re]) => !re.source.includes('0-9a-f'))
const ENV = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`, FORCE_COLOR: '1', TERM: 'xterm-256color' }

let story = {}

Before(() => { story = {} })

After(async () => {
  if (story.runner) await teardownScopedRunner(story.runner, await getRootHeaders())
  if (story.pub) await story.pub.teardown()
  if (story.render) removeRendered(story.render)
  if (story.cloned) fs.rmSync(CLONE, { recursive: true, force: true })
})

// One command typed in the teammate's clone. Its stdout and stderr share the
// one stream a terminal shows, so the lines keep the order they were written
// in. `shown` is the command line on the card when the harness wraps it.
function sh (command, { cwd = CLONE, input = '', timeout = 300000, shown = command } = {}) {
  const res = spawnSync('bash', ['-c', `exec 2>&1\n${command}`], {
    cwd, env: ENV, input, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024
  })
  if (res.error || res.status === null) throw new Error(`\`${command}\` did not finish: ${res.error ? res.error.message : res.signal}`)
  return { shown, code: res.status, out: res.stdout }
}

function ok (command, opts) {
  const res = sh(command, opts)
  if (res.code !== 0) throw new Error(`\`${command}\` exited ${res.code}:\n${plain(res.out).slice(-3000)}`)
  return res
}

const plain = (out) => screenText(out).replace(/\u001b\[[0-9;]*m/g, '')
const lines = (out) => plain(out).split('\n').map(l => l.trim()).filter(Boolean)
const head = () => ok('git rev-parse HEAD').out.trim()

function expectSaid (res, ...said) {
  const text = plain(res.out)
  for (const s of said) {
    if (s instanceof RegExp ? !s.test(text) : !text.includes(s)) {
      throw new Error(`Expected \`${res.shown}\` to say ${s}:\n${text.slice(-4000)}`)
    }
  }
}

function expectKeyHidden (res) {
  if (res.out.includes(KEY_BODY)) throw new Error(`\`${res.shown}\` printed the key itself:\n${plain(res.out)}`)
  expectSaid(res, 'REDACTED')
}

// lefthook lists the hooks it wrote in the order of a Go map: sort them.
const sortedHooks = (text) => text.replace(/(sync hooks: \S+ \()([^)]*)\)/g, (_, lead, list) => `${lead}${list.split(', ').sort().join(', ')})`)

// The session as the teammate's terminal shows it: each command line, then
// what it printed.
async function sessionCard (frameName, steps) {
  const text = steps.map(s => `$ ${s.shown}\n${maskText(sortedHooks(screenText(s.out)), MASKS)}`.trimEnd()).join('\n')
  await terminalOutputFrame(I, frameName, text)
}

// The demo project's pipeline keeps the generated files and its one secret
// scan job, untouched: every other code check is switched off, so each merge
// request runs exactly the job the story is about. Its shared before_script
// starts with `exec 2>&1`: the runner reads a job's stdout and stderr apart,
// so a line `task` logs on stderr could land before the line printed just
// before it. One stream keeps the job log in the order it was written, the
// way the laptop cards show it.
function keepOnlyTheSecretScan (dir) {
  const file = path.join(dir, '.gitlab-ci.yml')
  const [before] = fs.readFileSync(file, 'utf8').split(/^include:/m)
  const includes = ['cache', 'services', 'stages', 'tags', 'variables', 'workflow']
    .map(name => `.config/gitlab/ci/${name}.yml`)
    .concat('.config/gitlab/ci/devsecops/code.yml')
  const shared = fs.readFileSync(path.join(dir, '.config/gitlab/ci/before_script.yml'), 'utf8')
    .replace(/^---\n/, '')
    .replace(/^before_script:\n/m, 'before_script:\n  - exec 2>&1\n')
  if (!shared.includes('  - exec 2>&1\n  #')) throw new Error(`Unexpected before_script.yml:\n${shared}`)
  fs.writeFileSync(file, `${before}include:\n${includes.map(f => `  - local: ${f}\n`).join('')}\n${shared}\n` +
    OTHER_CODE_JOBS.map(job => `${job}:\n  rules:\n    - when: never\n`).join(''))
}

// Off camera: the push carries the token in its URL, so a failure never
// prints its arguments.
function push (branch) {
  const remote = new URL(`http://gitlab/${projectPath(PROJECT)}.git`) // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
  remote.username = process.env.TASK_GITLAB_LAMBDA_USER
  remote.password = story.pub.token
  const res = spawnSync('git', ['-C', CLONE, 'push', '--quiet', '-o', 'merge_request.create', '-o', 'merge_request.target=main',
    remote.href, `HEAD:refs/heads/${branch}`], { env: ENV, encoding: 'utf8', timeout: 120000 })
  if (res.status !== 0) throw new Error(`Pushing ${branch} to GitLab failed`)
}

async function mergeRequestOf (branch, headers) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const res = await listProjectMergeRequests(PROJECT, headers, `?source_branch=${encodeURIComponent(branch)}`)
    if (res.data && res.data.length) return res.data[0]
    await I.wait(2)
  }
  throw new Error(`The push of ${branch} opened no merge request`)
}

// GitLab works out whether a merge request can merge after its pipeline ends.
async function waitMergeStatus (iid, expected, headers) {
  const deadline = Date.now() + 90000
  let seen = ''
  while (Date.now() < deadline) {
    seen = (await getMergeRequest(PROJECT, iid, headers)).data.detailed_merge_status
    if (seen === expected) return
    await I.wait(3)
  }
  throw new Error(`Merge request !${iid} is "${seen}", expected "${expected}"`)
}

async function fileStatus (file, ref, headers) {
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT)}/repository/files/` +
    `${encodeURIComponent(file)}?ref=${encodeURIComponent(ref)}`, headers)
  return res.status
}

async function scanJob (pid, expected, headers) {
  const jobs = (await listPipelineJobs(PROJECT, pid, headers)).data || []
  const job = jobs.find(j => j.name === 'code:betterleaks')
  if (jobs.length !== 1 || !job || job.status !== expected) {
    dumpFailedTraces(PROJECT, jobs, headers, story.runner && story.runner.svc)
    throw new Error(`Expected the pipeline to run code:betterleaks alone, ${expected}; got ${jobs.map(j => `${j.name}:${j.status}`).join(', ')}`)
  }
  return { job, trace: await getJobTrace(PROJECT, job.id, headers) }
}

// GitLab scrolls its left sidebar down to the page's own entry, which cuts
// the sidebar's first line in half: every card shows the sidebar from its top.
async function fromTheTop () {
  await I.executeScript(() => {
    window.scrollTo(0, 0)
    document.querySelectorAll('*').forEach(el => { if (el.scrollTop) el.scrollTop = 0 })
  })
  await settlePage(I, { quietMs: 300 })
}

const mergeRequestCard = (frameName, iid, waitText) => gitlabFrame(I, frameName, gitlabUrl.mr(PROJECT, iid), {
  waitText,
  projectNames: [],
  // The activity feed under the merge widget: system notes, not this story.
  hide: ['ul.main-notes-list'],
  scrollTo: fromTheTop
})

// ============================================
// Chapter 1: the hooks come with the setup, not with the clone
// ============================================

storyboardStep(Given, 'a project generated from the toolbox sits on GitLab, its commit hooks declared in lefthook.yml on the main branch', async () => {
  story.render = renderProject({ privileged_ci_runners: false })
  keepOnlyTheSecretScan(story.render)
  await GitLabProjectPage.deleteProjectIfExists(
    BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD, projectPath(PROJECT)
  )
  story.pub = await publishToGitLab(story.render, {
    name: PROJECT,
    message: 'chore: generate the project from the toolbox',
    project: { shared_runners_enabled: false, group_runners_enabled: false, ...MERGE_SETTINGS }
  })
  // Twins: the hooks on the main branch are the render's, and the install
  // answer chose the binary scanner.
  const root = await getRootHeaders()
  const hooks = await getRepositoryFile(PROJECT, 'lefthook.yml', 'main', root)
  if (hooks !== fs.readFileSync(path.join(story.render, 'lefthook.yml'), 'utf8')) {
    throw new Error(`lefthook.yml on the main branch differs from the render:\n${hooks}`)
  }
  for (const run of ['task betterleaks:protect', 'task commitlint:lint-message', 'task commitizen:check-message']) {
    if (!hooks.includes(run)) throw new Error(`Expected lefthook.yml to run ${run}:\n${hooks}`)
  }
  if (!/^TASK_BETTERLEAKS_MODE=binary$/m.test(await getRepositoryFile(PROJECT, '.env.dist', 'main', root))) {
    throw new Error('Expected the install answer to write TASK_BETTERLEAKS_MODE=binary into .env.dist')
  }
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await gitlabFrame(I, 'hooks-on-gitlab', gitlabUrl.file(PROJECT, 'main', 'lefthook.yml'), {
    waitText: 'task commitizen:check-message',
    height: 760,
    projectNames: [],
    scrollTo: fromTheTop
  })
})

storyboardStep(When, 'a teammate clones it, task dev:setup-environment turns on the commit hooks git never copies', async () => {
  fs.rmSync(CLONE, { recursive: true, force: true })
  story.cloned = true
  const clone = ok(`git clone ${CLONE_URL}`, { cwd: path.dirname(CLONE) })
  // Off camera: a developer's machine has a git identity, the runner has none.
  ok('git config user.name "Lambda User" && git config user.email "lambda@test.local"')
  const listHooks = 'ls .git/hooks/commit-msg .git/hooks/pre-commit'
  const before = sh(listHooks)
  if (before.code === 0) throw new Error(`Expected a fresh clone to have no hooks:\n${before.out}`)
  // flock: the setup installs the runner's shared toolchain, and two workers
  // must not install it at the same time. It prints nothing of its own.
  const setup = ok('flock /tmp/e2e-dev-setup.lock task dev:setup-environment', { shown: 'task dev:setup-environment', timeout: 600000 })
  const after = ok(listHooks)
  // The setup's last phase, from its own marker to the end: the toolchain
  // checks before it differ from one machine to the next.
  const output = screenText(setup.out).split('\n')
  const from = output.findIndex(l => l.includes('Starting lefthook:install phase'))
  if (from === -1) throw new Error(`The setup never reached its lefthook phase:\n${plain(setup.out).slice(-3000)}`)
  expectSaid(setup, /sync hooks: \S+ \((commit-msg, pre-commit|pre-commit, commit-msg)\)/, 'Development environment setup completed successfully')
  await sessionCard('clone-hooks-on', [
    clone,
    { shown: `cd ${path.basename(CLONE)}`, out: '' },
    before,
    { shown: setup.shown, out: `${GREY}⋮${RESET}\n${output.slice(from).join('\n')}` },
    after
  ])

  // Off camera, for the cards that follow: the pinned scanner and commitizen's
  // Python environment are installed once, so no commit card shows a download.
  ok('task betterleaks:install')
  ok('git commit --allow-empty -m "chore: warm the commit hooks"')
  ok('git reset --quiet --soft HEAD~1')
})

// ============================================
// Chapter 2: every commit message is checked
// ============================================

storyboardStep(Then, "the hooks refuse the teammate's first commit, the deploy notes under a sloppy message, with their own explanation", async () => {
  fs.mkdirSync(path.join(CLONE, 'deploy'))
  fs.writeFileSync(path.join(CLONE, 'deploy/README.md'), NOTES)
  fs.writeFileSync(path.join(CLONE, 'deploy/.gitignore'), '*.pem\n')
  fs.writeFileSync(path.join(CLONE, 'deploy', KEY_FILE), `${KEY_LINES.join('\n')}\n`)
  story.main = head()
  const steps = [
    ok('git switch -c feature/deploy'),
    ok('cat deploy/.gitignore'),
    ok('git status --short --ignored --untracked-files=all deploy'),
    ok('git add deploy'),
    sh('git commit -m "deploy: add the deploy notes"')
  ]
  const commit = steps[4]
  if (commit.code === 0) throw new Error(`Expected the hooks to refuse the message:\n${plain(commit.out)}`)
  if (head() !== story.main) throw new Error('A refused commit must leave the branch where it was')
  const staged = lines(ok('git diff --cached --name-only').out)
  if (staged.join(' ') !== 'deploy/.gitignore deploy/README.md') throw new Error(`Expected the two notes files staged, got ${staged}`)
  expectSaid(commit, 'No secrets detected in staged files.', 'commit validation: failed!',
    'type must be one of [build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test]', '[type-enum]')
  await sessionCard('commit-refused', steps)
})

storyboardStep(Then, 'the same commit goes through once its message follows the convention, with the gitignored deploy key left out', async () => {
  const commit = ok('git commit -m "feat: add the deploy notes"')
  expectSaid(commit, 'No secrets detected in staged files.', 'Commit validation: successful!', 'Commit message passed commitlint.', '2 files changed')
  if (ok('git rev-parse HEAD~1').out.trim() !== story.main) throw new Error('Expected one new commit on top of the main branch')
  const tracked = lines(ok('git ls-files deploy').out)
  if (tracked.join(' ') !== 'deploy/.gitignore deploy/README.md') throw new Error(`Expected only the notes committed, got ${tracked}`)
  ok(`git check-ignore --quiet deploy/${KEY_FILE}`)
  await sessionCard('commit-accepted', [commit])
})

// ============================================
// Chapter 3: a key is stopped on the laptop
// ============================================

storyboardStep(When, 'the teammate stages the deploy key outside its ignored folder, the pre-commit scan refuses the commit', async () => {
  const notes = head()
  const steps = [
    ok(`cp deploy/${KEY_FILE} .`),
    ok(`cat ${KEY_FILE}`),
    ok(`git add ${KEY_FILE}`),
    sh('git commit -m "chore: add the deploy key"')
  ]
  const commit = steps[3]
  if (commit.code === 0 || head() !== notes) throw new Error(`Expected the pre-commit scan to refuse the key:\n${plain(commit.out)}`)
  if (ok('git diff --cached --name-only').out.trim() !== KEY_FILE) throw new Error('Expected the key to stay staged')
  expectSaid(commit, 'Betterleaks detected secrets in your staged files!', 'private-key', /path \.+ deploy-key\.pem/)
  expectKeyHidden(commit)
  await sessionCard('hook-refuses-key', steps)
})

storyboardStep(When, 'the teammate forces the key past the hook, the branch scan blocks the branch and names the commit', async () => {
  const commit = ok('git commit --no-verify -m "chore: add the deploy key"')
  const scan = sh('task betterleaks:scan-branch')
  if (scan.code === 0) throw new Error(`Expected the branch scan to block the key:\n${plain(scan.out)}`)
  expectSaid(scan, 'Running betterleaks from the pinned binary, no container', 'Betterleaks detected secrets in your branch commits!',
    /git\.message \.+ chore: add the deploy key/, /path \.+ deploy-key\.pem/)
  expectKeyHidden(scan)
  await sessionCard('branch-scan-blocks', [commit, scan])
})

// ============================================
// Chapter 4: getting out of a secret block
// ============================================

storyboardStep(When, 'the teammate only deletes the key file, the hooks let the deletion through', async () => {
  const steps = [ok(`git rm ${KEY_FILE}`), ok('git commit -m "chore: remove the deploy key"')]
  expectSaid(steps[1], 'scanned ~0 bytes', 'No secrets detected in staged files.', '1 file changed')
  if (ok(`git ls-files ${KEY_FILE}`).out.trim()) throw new Error('Expected the key gone from the last commit')
  if (lines(ok(`git log --oneline -- ${KEY_FILE}`).out).length !== 2) throw new Error('Expected the key still in the history')
  await sessionCard('key-deleted', steps)
})

storyboardStep(Then, 'the branch scan still finds the key in the commit that added it', async () => {
  const log = ok('git log --oneline main..')
  const scan = sh('task betterleaks:scan-branch')
  if (lines(log.out).length !== 3) throw new Error(`Expected three commits on the branch:\n${log.out}`)
  if (scan.code === 0) throw new Error(`Expected the scan to keep blocking the branch:\n${plain(scan.out)}`)
  expectSaid(scan, /git\.message \.+ chore: add the deploy key/, 'Betterleaks detected secrets in your branch commits!')
  expectKeyHidden(scan)
  await sessionCard('deletion-still-blocked', [log, scan])
})

storyboardStep(When, "the teammate rewrites the history with the framework's clean-secrets task", async () => {
  const notes = ok('git rev-parse HEAD~2').out.trim()
  // The task asks "Continue? (yes/no)" and reads the answer from the terminal.
  const clean = ok(`echo yes | task git:clean-secrets -- ${KEY_FILE}`)
  expectSaid(clean, "Ref 'refs/heads/feature/deploy' was rewritten", 'History cleaned locally')
  const left = ok(`git log --all --oneline -- ${KEY_FILE}`).out.trim()
  if (left) throw new Error(`Expected the key gone from every commit, still in:\n${left}`)
  if (ok('git rev-list main..HEAD').out.trim() !== notes) throw new Error('Expected the deploy notes commit kept as it was')
  await sessionCard('history-cleaned', [clean])
})

storyboardStep(Then, 'the branch scan comes back clean with the deploy notes still on the branch', async () => {
  const log = ok('git log --oneline main..')
  const scan = ok('task betterleaks:scan-branch')
  expectSaid(log, 'feat: add the deploy notes')
  if (lines(log.out).length !== 1) throw new Error(`Expected the notes alone on the branch:\n${log.out}`)
  expectSaid(scan, 'No secrets detected in branch commits.')
  await sessionCard('branch-scan-clean', [log, scan])
})

// ============================================
// Chapter 5: GitLab is the gate nobody can skip
// ============================================

storyboardStep(Then, 'the cleaned branch, pushed as a merge request, passes the same scan on GitLab and is ready to merge', async () => {
  const root = await getRootHeaders()
  story.runner = await registerScopedRunner(I, PROJECT, root)
  push('feature/deploy')
  if ((await mergeRequestOf('feature/deploy', root)).iid !== 1) throw new Error('Expected the push to open merge request !1')
  const { pid, status } = await waitMergeRequestPipeline(I, PROJECT, 1, root)
  const { trace } = await scanJob(pid, 'success', root)
  if (status !== 'success') throw new Error(`Expected the pipeline of !1 to pass, it is ${status}`)
  for (const said of ['Running betterleaks from the pinned binary, no container', 'No secrets detected in branch commits.']) {
    if (!trace.includes(said)) throw new Error(`Expected the job log of !1 to say "${said}"`)
  }
  const commits = (await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT)}/merge_requests/1/commits`, root)).data
  if (commits.map(c => c.title).join() !== 'feat: add the deploy notes') throw new Error(`Expected !1 to carry the notes alone, got ${commits.map(c => c.title)}`)
  for (const file of [KEY_FILE, `deploy/${KEY_FILE}`]) {
    if (await fileStatus(file, 'feature/deploy', root) !== 404) throw new Error(`Expected ${file} absent from the pushed branch`)
  }
  await waitMergeStatus(1, 'mergeable', root)
  await mergeRequestCard('merge-ready', 1, 'Ready to merge')
})

storyboardStep(When, 'another branch skips every local check and pushes the key inside a secrets.yaml, a file the scanner used to skip', async () => {
  const root = await getRootHeaders()
  ok('git switch --quiet -c feature/secrets-yaml main')
  fs.writeFileSync(path.join(CLONE, 'secrets.yaml'), SECRETS_YAML)
  ok('git add secrets.yaml')
  ok('git commit --quiet --no-verify -m "chore: keep the production deploy key in secrets.yaml"')
  push('feature/secrets-yaml')
  if ((await mergeRequestOf('feature/secrets-yaml', root)).iid !== 2) throw new Error('Expected the push to open merge request !2')
  // The Changes tab counts the pipeline too: shot once it is over.
  story.second = await waitMergeRequestPipeline(I, PROJECT, 2, root)
  const diffs = (await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT)}/merge_requests/2/diffs`, root)).data || []
  if (diffs.map(d => d.new_path).join() !== 'secrets.yaml' || !diffs[0].diff.includes(KEY_BODY)) {
    throw new Error(`Expected !2 to change secrets.yaml alone, with the key in it; got ${diffs.map(d => d.new_path)}`)
  }
  await gitlabFrame(I, 'secrets-yaml-changes', gitlabUrl.mr(PROJECT, 2, 'diffs'), {
    waitText: KEY_BODY,
    height: 620,
    projectNames: [],
    scrollTo: fromTheTop
  })
})

storyboardStep(Then, 'the pipeline of that merge request blocks the key from the pinned binary and never prints it', async () => {
  const root = await getRootHeaders()
  const { job, trace } = await scanJob(story.second.pid, 'failed', root)
  if (story.second.status !== 'failed') throw new Error(`Expected the pipeline of !2 to fail, it is ${story.second.status}`)
  for (const said of ['Checksum verified against the published checksums.txt', 'Running betterleaks from the pinned binary, no container',
    'Betterleaks detected secrets in your branch commits!', 'secrets.yaml', 'REDACTED']) {
    if (!trace.includes(said)) throw new Error(`Expected the job log of !2 to say "${said}"`)
  }
  if (trace.includes(KEY_BODY)) throw new Error('The job log printed the key itself')
  if (/\bdocker (run|exec)\b/.test(trace)) throw new Error('The binary scan started a container')
  // The binary that ran is the one pinned in the project: the installer says
  // so, and so does the scanner's own banner.
  const pinned = fs.readFileSync(path.join(story.render, '.config/betterleaks/version'), 'utf8').trim()
  // Line ends only: the trace prefixes every line with its timestamp.
  const banner = new RegExp(`(^|\\s)betterleaks ${pinned.replace(/\./g, '\\.')}\\s*$`, 'm')
  if (!trace.includes(`Installing betterleaks ${pinned} (binary mode, no container)`) || !banner.test(plain(trace))) {
    throw new Error(`Expected the job to install and run the pinned betterleaks ${pinned}`)
  }
  await jobLogFrame(I, 'ci-scan-blocks', PROJECT, job.id, {
    from: '$ task betterleaks:scan-branch',
    masks: JOB_MASKS,
    height: 1100,
    projectNames: []
  })
})

storyboardStep(Then, 'GitLab refuses to merge it, so the key never reaches the main branch', async () => {
  const root = await getRootHeaders()
  const settings = (await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(PROJECT)}`, root)).data
  if (settings.only_allow_merge_if_pipeline_succeeds !== true) throw new Error('Expected the project to merge only on a passed pipeline')
  await waitMergeStatus(2, 'ci_must_pass', root)
  if (await fileStatus('secrets.yaml', 'main', root) !== 404) throw new Error('Expected no secrets.yaml on the main branch')
  await mergeRequestCard('merge-blocked', 2, 'Merge blocked')
})
