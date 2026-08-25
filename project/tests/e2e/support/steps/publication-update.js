/* global inject Before After Given When Then NodeFilter */
/**
 * A toolbox release reaching a component-only project — @publication-update.
 *
 * The fixture is a REAL two-release template built from the working branch: tag
 * 1.0.0 is this branch as it stands, tag 1.0.1 adds a rule to the publication
 * floor, a line to the release phase, and a line to a tool the project never
 * installed. It is pushed to the test GitLab and installed from there by the
 * REAL installer function (scaffold_publication_only, sourced from
 * .config/devsecops/install.sh), so what the story updates is what a developer
 * really gets, from where a developer really gets it.
 *
 * Nothing here types the update. `task feedback` runs Renovate — the pinned one
 * in this image, against the real GitLab — Renovate opens the merge request and
 * applies the release inside it, and the story reads back what moved once that
 * merge request is in.
 *
 * Two things the whole chapter depends on, both found the hard way:
 *   - `copier` must be on PATH when Renovate runs, or its own copier manager
 *     dies on a spawn error and the process never exits. The framework's CI job
 *     installs it for exactly this reason;
 *   - Renovate can only track a template it can reach over http, so the
 *     two-release template lives in GitLab and not in a directory.
 */
const crypto = require('crypto')
const fs = require('fs')
const { execSync } = require('child_process')
const { I, GitLabUserPage, GitLabRepositoryPage } = inject()
const {
  ttydPort,
  shellEscape,
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd,
  stripAnsiEscapeSequences
} = require('../helpers/docker')
const {
  typeCommandAndWait,
  captureTerminalFrame,
  COMMAND_TIMEOUT_MS
} = require('../terminal/capture')
const {
  storyboardStep,
  addStoryboardFrame,
  capturePageFrame
} = require('../../../../../.config/codeceptjs/storyboard')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { freshGet } = require('../helpers/http')
const {
  BASE_URL,
  projectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectMergeRequests,
  mergeMergeRequest
} = require('../helpers/gitlabApi')

const WORKSPACE = '/workspace'
const PROJECT_DIR = '/workspace/my-project'
const INSTALLER_LIB = '/tmp/installer-lib.sh'
const OLD_RELEASE = '1.0.0'
const NEW_RELEASE = '1.0.1'
const SETUP_TIMEOUT = 600000
// Where the suite's own container keeps the checkout it runs `task feedback`
// from. Renovate clones the repository itself; this is only the working copy the
// command is typed in, the way a CI job has one.
const CHECKOUT_DIR = '/tmp/publication-update-checkout'

// What the 1.0.1 release changes, one file per audience:
//   - the publication floor the project HAS, and must receive;
//   - the update machinery itself, part of the spine the project HAS;
//   - a tool the project never installed, and must NOT receive.
const NEW_FLOOR_RULE = '*.kubeconfig'
const SPINE_FILE = '.config/copier/Taskfile.yml'
const SPINE_MARKER = '# 1.0.1: the update machinery gained a note'
const ABSENT_TOOL = '.config/glab/Taskfile.yml'
// The credential the project happens to track, published today and held back
// once the release tightens the floor.
const CREDENTIAL = 'src/cluster.kubeconfig'

Before(() => {
  global.pubUpdateContainer = null
  global.pubUpdateTemplate = null
  global.pubUpdateToolbox = null
  global.pubUpdateProject = null
  global.pubUpdateToken = null
  global.pubUpdateTokenId = null
  global.pubUpdateMr = null
})

After(async () => {
  removeContainer(global.pubUpdateContainer)
  global.pubUpdateContainer = null
  if (global.pubUpdateTemplate && global.pubUpdateTemplate.startsWith('/tmp/')) {
    try {
      execSync(`rm -rf ${shellEscape(global.pubUpdateTemplate)}`, { stdio: 'ignore' })
    } catch (_) {
      // Best-effort cleanup.
    }
  }
  global.pubUpdateTemplate = null
  try {
    execSync(`rm -rf ${CHECKOUT_DIR}`, { stdio: 'ignore' })
  } catch (_) {
    // Best-effort cleanup.
  }

  let rootHeaders = null
  try {
    rootHeaders = await getRootHeaders()
  } catch (_) {
    return
  }
  for (const name of [global.pubUpdateProject, global.pubUpdateToolbox]) {
    if (!name) continue
    try {
      await deleteProject(name, rootHeaders)
    } catch (_) {
      // Best-effort: GitLab deletion is async and non-critical.
    }
  }
  global.pubUpdateProject = null
  global.pubUpdateToolbox = null
  if (global.pubUpdateTokenId) {
    try {
      await revokePersonalAccessToken(global.pubUpdateTokenId, rootHeaders)
    } catch (_) {
      // Best-effort.
    }
    global.pubUpdateTokenId = null
  }
  global.pubUpdateToken = null
})

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: SETUP_TIMEOUT, encoding: 'utf8' })
}

const lambdaUser = () => process.env.TASK_GITLAB_LAMBDA_USER

/**
 * The working branch, tagged as two consecutive toolbox releases. 1.0.1 carries
 * the three changes the story reads back, so "a new release arrived" is a real
 * template diff and not a fixture pretending to be one.
 */
function buildTwoReleaseTemplate () {
  const tpl = `/tmp/publication-release-${crypto.randomBytes(4).toString('hex')}`
  sh(`mkdir -p ${tpl} && cp -a ${WORKSPACE}/. ${tpl} && chown -R "$(id -u):$(id -g)" ${tpl}`)
  sh('rm -rf .git', tpl)
  sh('git init --quiet --initial-branch=main', tpl)
  sh('git config user.email "e2e@test.local" && git config user.name "E2E"', tpl)
  sh('git add -A', tpl)
  sh(`git commit --quiet --no-verify -m "chore: toolbox release ${OLD_RELEASE}"`, tpl)
  sh(`git tag ${OLD_RELEASE}`, tpl)

  sh(`printf '%s\\n' ${shellEscape(NEW_FLOOR_RULE)} >> .config/publication/denylist.base`, tpl)
  sh(`printf '\\n%s\\n' ${shellEscape(SPINE_MARKER)} >> ${SPINE_FILE}`, tpl)
  sh(`printf '\\n# 1.0.1: a change in a tool this project never installed\\n' >> ${ABSENT_TOOL}`, tpl)
  sh('git add -A', tpl)
  sh(`git commit --quiet --no-verify -m "chore: toolbox release ${NEW_RELEASE}"`, tpl)
  sh(`git tag ${NEW_RELEASE}`, tpl)
  return tpl
}

/**
 * A live terminal on a project installed by the REAL installer at release 1.0.0:
 * the component plus the spine that keeps it up to date, the team's own rules,
 * and a little source tree with a cluster credential in it.
 */
function setupUpdateTerminal (templateUrl, pushUrl, credential) {
  const name = containerName()
  runCommand(`cd ${WORKSPACE}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`, { timeout: SETUP_TIMEOUT })

  // The installer's own file, stripped of its `main` invocation so the
  // component function can be called directly: the story installs with the
  // product, never with a copy of it.
  runCommand(
    `docker cp ${shellEscape(`${WORKSPACE}/.config/devsecops/install.sh`)} ${shellEscape(`${name}:/tmp/install.sh`)}`
  )
  const own = execInContainer(name, 'chown bootstrap:bootstrap /tmp/install.sh', { user: 'root' })
  if (own.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to hand the installer to the bootstrap user:\n${own.output}`)
  }

  const setup = execInContainerAsUser(name, 'bootstrap', [
    'set -e',
    'export PATH="$HOME/.local/bin:$PATH"',
    'mkdir -p "$HOME/.local/bin"',
    `grep -v '^main "' /tmp/install.sh > ${INSTALLER_LIB}`,
    // task and uv come from the installer's own installers: no duplicated
    // download path, and their volatile output stays off camera.
    `sh -c ". ${INSTALLER_LIB}; install_task; install_uv" >/dev/null 2>&1`,
    'git config --global user.email "team@test.local"',
    'git config --global user.name "The team"',
    'git config --global init.defaultBranch main',
    "git config --global --add safe.directory '*'",
    // The token lives in the credential store, never in a remote URL: a card
    // that ever shows this project's remotes must not show a token.
    'git config --global credential.helper store',
    `printf '%s\n' ${shellEscape(credential)} > "$HOME/.git-credentials"`,
    'chmod 600 "$HOME/.git-credentials"',
    `mkdir -p ${PROJECT_DIR} && cd ${PROJECT_DIR}`,
    // THE REAL INSTALLER, at the old release, from the template as GitLab
    // serves it — which is also what the answers file records, and what Renovate
    // will later ask for new tags.
    `DEVSECOPS_TEMPLATE_URL=${shellEscape(templateUrl)} DEVSECOPS_TEMPLATE_VCS_REF=${OLD_RELEASE} ` +
      `sh -c ". ${INSTALLER_LIB}; scaffold_publication_only" >/dev/null 2>&1`,
    // The team's own source, and the rules they wrote themselves.
    'mkdir -p src',
    "printf '# Field Reporting\\n' > README.md",
    "printf 'serve()\\n' > src/app.js",
    "printf 'apiVersion: v1\\nclusters: []\\n' > src/cluster.kubeconfig",
    "printf '# What may be published.\\n/README.md\\n/src/**\\n' > .config/publication/allowlist",
    "printf '# Who approves what becomes public.\\nsecurity-lead\\n' > .config/publication/owners",
    'git init -q -b main .',
    'git add -A',
    'git commit -q --no-verify -m "chore: install source publication and our own rules"',
    `git remote add origin ${shellEscape(pushUrl)}`,
    'git push -q origin main',
    // CI runners exec under umask 000, so every directory created here comes out
    // world-writable and `ls` colours it green-on-green instead of the plain blue
    // a 0755 directory gets. A permission drift, not a rendering one, and it
    // breaks a listing baseline between a laptop and the runner.
    `find ${PROJECT_DIR} -type d -exec chmod 755 {} + 2>/dev/null || true`,
    `find ${PROJECT_DIR} -type f -not -path '*/.git/*' -exec chmod 644 {} + 2>/dev/null || true`,
    `chmod 755 ${PROJECT_DIR}/.config/publication/publish.sh`
  ].join('\n'), { timeout: SETUP_TIMEOUT })
  if (setup.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to set up the component-only project:\n${setup.output}`)
  }

  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    'export PATH="$HOME/.local/bin:$PATH"',
    `cd ${PROJECT_DIR} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))
  if (ttydStart.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(name, 30000)
  return name
}

function inProject (script) {
  return execInContainerAsUser(global.pubUpdateContainer, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
}

function inProjectOrThrow (script) {
  const res = inProject(script)
  if (res.exitCode !== 0) {
    throw new Error(`Command failed in the project (\`${script}\`):\n${res.output}`)
  }
  return stripAnsiEscapeSequences(res.output || '')
}

// The number of framework files sitting outside the allowlist is real, and it
// moves whenever the spine gains or loses a file. The card must not rot on it.
const TERMINAL_MASKS = [
  [/\b\d+ other tracked files\b/g, '<n> other tracked files'],
  [/e2e-toolbox-[0-9a-f]+/g, 'toolbox'],
  [/e2e-component-[0-9a-f]+/g, 'project']
]

/**
 * Type a command in the live shell and keep the moment as a storyboard frame.
 * The screen is cleared first: this story asks the SAME question twice, before
 * and after the release, and an anchor that appears twice in the scrollback
 * would frame the first one both times.
 */
async function terminalCard (command, marker, frameName) {
  await typeCommandAndWait(I, 'clear')
  await typeCommandAndWait(I, command, COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: marker, mask: TERMINAL_MASKS }))
  const rows = await I.executeScript(function () {
    return Array.from(document.querySelectorAll('.xterm-rows > div'))
      .map(function (row) { return row.textContent || '' })
      .join('\n')
  })
  return String(rows || '')
}

/** Re-open the live terminal after a card that navigated to a GitLab page. */
async function backToTerminal () {
  I.amOnPage(`http://${global.pubUpdateContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  await I.wait(2)
}

function mustContain (haystack, needles, what) {
  for (const needle of [].concat(needles)) {
    if (!haystack.includes(needle)) {
      throw new Error(`${what}: expected "${needle}" in:\n${haystack}`)
    }
  }
}

function mustNotContain (haystack, needles, what) {
  for (const needle of [].concat(needles)) {
    if (haystack.includes(needle)) {
      throw new Error(`${what}: did NOT expect "${needle}" in:\n${haystack}`)
    }
  }
}

// ===========================================================================

/** Push the two-release template to GitLab: Renovate only tracks what it can fetch. */
function pushTemplate (dir, url) {
  sh(`git push --quiet ${shellEscape(url)} main --tags`, dir)
}

/**
 * `task feedback` — the phase the nightly schedule runs — in a checkout of the
 * project, with the environment a CI job would have. Its combined output is the
 * card, so nothing is filtered but what moves between runs.
 *
 * `copier` on PATH is not optional: Renovate's own copier manager spawns it, and
 * on a missing binary the run dies on an unhandled rejection and hangs. The
 * framework's feedback job installs it for the same reason.
 */
function runFeedback (cloneUrl, token) {
  const pin = fs.readFileSync(`${WORKSPACE}/.config/copier/requirements.txt`, 'utf8').trim()
  sh(`rm -rf ${CHECKOUT_DIR} && git clone --quiet ${shellEscape(cloneUrl)} ${CHECKOUT_DIR}`)
  sh(`uv tool install --quiet ${shellEscape(pin)}`)
  const env = [
    'PATH="$HOME/.local/bin:$PATH"',
    'TASK_RENOVATE_PLATFORM=gitlab',
    `TASK_RENOVATE_REPOSITORY=${lambdaUser()}/${global.pubUpdateProject}`,
    'TASK_RENOVATE_ENDPOINT=http://gitlab/api/v4',
    `TASK_RENOVATE_TOKEN=${token}`
  ].join(' ')
  let raw
  try {
    raw = execSync(`env ${env} task feedback 2>&1`, {
      cwd: CHECKOUT_DIR, encoding: 'utf8', timeout: SETUP_TIMEOUT, maxBuffer: 64 * 1024 * 1024
    })
  } catch (e) {
    raw = (e.stdout || '') + (e.stderr || '')
  }
  return raw
}

/** What the card must not carry: the run's own name, its clock, its version pins. */
function maskFeedback (output) {
  return stripAnsiEscapeSequences(output)
    .replace(/e2e-toolbox-[0-9a-f]+/g, 'toolbox')
    .replace(/e2e-component-[0-9a-f]+/g, 'project')
    .replace(/("renovateVersion":\s*)"[^"]+"/g, '$1"<version>"')
    .replace(/("durationMs":\s*)\d+/g, '$1<ms>')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

storyboardStep(Given, 'a project that installed source publication and nothing else', async () => {
  const rootHeaders = await getRootHeaders()
  await GitLabUserPage.ensureUserViaApi(
    BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD,
    {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: lambdaUser(),
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    }
  )
  const suffix = crypto.randomBytes(4).toString('hex')
  global.pubUpdateToolbox = `e2e-toolbox-${suffix}`
  global.pubUpdateProject = `e2e-component-${suffix}`

  const created = await createLambdaPersonalAccessToken(
    `publication-update-${suffix}`, ['api', 'write_repository'], rootHeaders
  )
  if (!created.token) {
    throw new Error(`Failed to mint the lambda token: ${JSON.stringify(created)}`)
  }
  global.pubUpdateToken = created.token
  global.pubUpdateTokenId = created.id
  const headers = { 'PRIVATE-TOKEN': global.pubUpdateToken }

  // The template is public, the way a template is: copier and Renovate both read
  // it without a credential. The project itself is private, and runs no CI: no
  // runner is registered for it, and a pipeline nobody picks up would sit
  // spinning in the merge request this story photographs.
  for (const [name, extra] of [
    [global.pubUpdateToolbox, { visibility: 'public' }],
    [global.pubUpdateProject, { visibility: 'private', jobs_enabled: false }]
  ]) {
    const res = await createProject({ name, ...extra }, headers)
    if (res.status >= 400) {
      throw new Error(`Failed to create ${name}: ${res.status} ${JSON.stringify(res.data)}`)
    }
  }

  const authed = (project) =>
    `http://${lambdaUser()}:${encodeURIComponent(global.pubUpdateToken)}@gitlab/${lambdaUser()}/${project}.git`
  const plain = (project) => `http://gitlab/${lambdaUser()}/${project}.git`

  global.pubUpdateTemplate = buildTwoReleaseTemplate()
  pushTemplate(global.pubUpdateTemplate, authed(global.pubUpdateToolbox))
  global.pubUpdateContainer = setupUpdateTerminal(
    plain(global.pubUpdateToolbox),
    plain(global.pubUpdateProject),
    `http://${lambdaUser()}:${global.pubUpdateToken}@gitlab`
  )

  I.amOnPage(`http://${global.pubUpdateContainer}:${ttydPort()}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  await I.wait(3)
  await typeCommandAndWait(I, 'clear')
  const screen = await terminalCard(
    'ls -A1 && ls .config && grep _commit .config/devsecops/.copier-answers.yml',
    'ls -A1 && ls .config',
    'update-before'
  )
  mustContain(screen, ['publication', `_commit: ${OLD_RELEASE}`],
    'the project must carry the component and record the release it came from')
  mustNotContain(screen, ['glab', 'megalinter'],
    'a component-only install must not carry the framework tooling')
})

storyboardStep(Given, 'what it would publish today, cluster credential included', async () => {
  const screen = await terminalCard('task publication:check', 'task publication:check', 'update-check-before')
  mustContain(screen, [CREDENTIAL, 'README.md'],
    'before the release, the credential is among the files that would be published')
})

storyboardStep(When, 'the nightly check runs and Renovate finds the new release', async () => {
  const output = runFeedback(
    `http://${lambdaUser()}:${encodeURIComponent(global.pubUpdateToken)}@gitlab/${lambdaUser()}/${global.pubUpdateProject}.git`,
    global.pubUpdateToken
  )
  mustContain(output, ['Feedback', 'Renovate started'],
    'the feedback phase must be what starts Renovate')
  await renderPreFrame(I, 'update-feedback', `$ task feedback\n${maskFeedback(output)}`, { colour: true, height: 720 })

  const mrs = await listProjectMergeRequests(
    global.pubUpdateProject, { 'PRIVATE-TOKEN': global.pubUpdateToken }, '?state=opened'
  )
  const mr = (mrs.data || [])[0]
  if (!mr) {
    throw new Error(`Renovate opened no merge request. Its output was:\n${maskFeedback(output)}`)
  }
  global.pubUpdateMr = mr.iid
})

storyboardStep(When, 'the merge request it opened carries the release, applied', async () => {
  const headers = { 'PRIVATE-TOKEN': global.pubUpdateToken }
  const changes = await freshGet(
    `${BASE_URL}/api/v4/projects/${encodeURIComponent(`${lambdaUser()}/${global.pubUpdateProject}`)}` +
    `/merge_requests/${global.pubUpdateMr}/changes`,
    headers
  )
  const paths = ((changes.data && changes.data.changes) || []).map(c => c.new_path).sort()
  const expected = [
    '.config/devsecops/.copier-answers.yml',
    SPINE_FILE,
    '.config/publication/denylist.base'
  ].sort()
  if (JSON.stringify(paths) !== JSON.stringify(expected)) {
    throw new Error(`Renovate's merge request must carry exactly ${JSON.stringify(expected)}, it carried ${JSON.stringify(paths)}`)
  }

  await GitLabUserPage.loginAs(lambdaUser(), process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  I.resizeWindow(1024, 700)
  await I.amOnPage(`/${projectPath(global.pubUpdateProject)}/-/merge_requests/${global.pubUpdateMr}/diffs`)
  await I.waitForText('denylist.base', 60)
  await GitLabRepositoryPage.maskVolatile(global.pubUpdateProject)
  await I.executeScript((names) => {
    const re = new RegExp(names.join('|'), 'g')
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walk.nextNode()) nodes.push(walk.currentNode)
    nodes.forEach(n => {
      if (re.test(n.nodeValue)) {
        n.nodeValue = n.nodeValue
          .replace(/e2e-toolbox-[0-9a-f]+/g, 'toolbox')
          .replace(/e2e-component-[0-9a-f]+/g, 'project')
      }
    })
    const style = document.createElement('style')
    style.textContent = '[role="tooltip"], .tooltip, .gl-tooltip, [class*="popover"] { display: none !important }'
    document.head.appendChild(style)
  }, ['e2e-toolbox-[0-9a-f]+', 'e2e-component-[0-9a-f]+'])
  await I.wait(1)
  await addStoryboardFrame(I, await capturePageFrame(I, 'update-merge-request'))
  I.resizeWindow(1024, 768)

  // Merged, then pulled: the next card reads the project as the team would find
  // it the morning after.
  const merged = await mergeMergeRequest(global.pubUpdateProject, global.pubUpdateMr, headers)
  // 405 is what GitLab answers for a merge request that is already in — the
  // framework turns automerge on, and this story does not depend on which of the
  // two got there first.
  if (merged.status >= 400 && merged.status !== 405) {
    throw new Error(`The update merge request must go in: ${merged.status} ${JSON.stringify(merged.data)}`)
  }
  inProjectOrThrow('git fetch --quiet origin main && git reset --hard --quiet origin/main')
  const answers = inProjectOrThrow('grep _commit .config/devsecops/.copier-answers.yml')
  mustContain(answers, NEW_RELEASE, 'the merged update must move the recorded release')
})

storyboardStep(Then, 'the project tracks the new release, and git says exactly what moved', async () => {
  // The last two cards were GitLab pages; the terminal is where the rest of the
  // story happens.
  await backToTerminal()
  const screen = await terminalCard(
    'grep _commit .config/devsecops/.copier-answers.yml && git diff --stat HEAD~1',
    'grep _commit',
    'update-diff'
  )
  mustContain(screen, [`_commit: ${NEW_RELEASE}`, '.config/publication/denylist.base', 'copier/Taskfile.yml'],
    'the card must show the version and the framework files the release moved')

  const changed = inProjectOrThrow('git diff --name-only HEAD~1').split('\n').map(l => l.trim()).filter(Boolean).sort()
  const expected = [
    '.config/devsecops/.copier-answers.yml',
    SPINE_FILE,
    '.config/publication/denylist.base'
  ].sort()
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    throw new Error(`The release must change exactly ${JSON.stringify(expected)}, changed ${JSON.stringify(changed)}`)
  }
})

storyboardStep(Then, 'the rules the team wrote came through untouched', async () => {
  const screen = await terminalCard(
    'git diff --stat HEAD~1 -- .config/publication/allowlist .config/publication/owners && cat .config/publication/owners',
    'git diff --stat HEAD~1 --',
    'update-our-rules'
  )
  mustContain(screen, 'security-lead', "the team's own owners file must be exactly what they wrote")

  const dirty = inProjectOrThrow(
    'git diff --name-only HEAD~1 -- .config/publication/allowlist .config/publication/denylist ' +
    '.config/publication/owners .config/publication/manifest'
  ).trim()
  if (dirty) {
    throw new Error(`The release must not touch the files the project owns, it changed: ${dirty}`)
  }
})

storyboardStep(Then, 'the tightened floor from that release is already in force', async () => {
  const screen = await terminalCard('task publication:check', 'task publication:check', 'update-check-after')
  mustContain(screen, [CREDENTIAL, 'framework floor'],
    'after the release, the credential must be held back by the framework floor')

  const floor = inProjectOrThrow('cat .config/publication/denylist.base')
  mustContain(floor, NEW_FLOOR_RULE, 'the release must have added its new rule to the floor')
})

storyboardStep(Then, 'nothing the project never installed arrived with it', async () => {
  const screen = await terminalCard('ls -A1 && ls .config', 'ls -A1 && ls .config', 'update-after')
  mustNotContain(screen, ['glab', 'megalinter', 'codeceptjs'],
    'an update must not grow a component-only project back into the whole framework')

  const absent = inProject(`test -e ${ABSENT_TOOL}`)
  if (absent.exitCode === 0) {
    throw new Error(`"${ABSENT_TOOL}" changed in the release and must NOT have arrived in this project`)
  }
})
