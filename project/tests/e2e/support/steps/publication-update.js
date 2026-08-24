/* global inject Before After Given When Then */
/**
 * A toolbox release reaching a component-only project — @publication-update.
 *
 * The fixture is a REAL two-release template built from the working branch: tag
 * 1.0.0 is this branch as it stands, tag 1.0.1 adds a rule to the publication
 * floor, a line to the release phase, and a line to a tool the project never
 * installed. The project is produced by the REAL installer function
 * (scaffold_publication_only, sourced from .config/devsecops/install.sh), so
 * what the story updates is what a developer really gets.
 *
 * Then it runs the exact command Renovate triggers, `task copier:update`, and
 * reads back what moved. No GitLab is involved: this is copier and git.
 */
const crypto = require('crypto')
const { execSync } = require('child_process')
const { I } = inject()
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
  addStoryboardFrame
} = require('../../../../../.config/codeceptjs/storyboard')

const WORKSPACE = '/workspace'
const PROJECT_DIR = '/workspace/my-project'
const TEMPLATE_DIR = '/tmp/release-template'
const INSTALLER_LIB = '/tmp/installer-lib.sh'
const OLD_RELEASE = '1.0.0'
const NEW_RELEASE = '1.0.1'
const SETUP_TIMEOUT = 600000

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
})

After(() => {
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
})

function sh (cmd, cwd) {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: SETUP_TIMEOUT, encoding: 'utf8' })
}

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
function setupUpdateTerminal (templatePath) {
  const name = containerName()
  runCommand(`cd ${WORKSPACE}/project && docker compose run -d --name ${shellEscape(name)} ubuntu`, { timeout: SETUP_TIMEOUT })

  runCommand(`docker cp ${shellEscape(templatePath)} ${shellEscape(`${name}:${TEMPLATE_DIR}`)}`, { timeout: SETUP_TIMEOUT })
  // The installer's own file, stripped of its `main` invocation so the
  // component function can be called directly: the story installs with the
  // product, never with a copy of it.
  runCommand(
    `docker cp ${shellEscape(`${WORKSPACE}/.config/devsecops/install.sh`)} ${shellEscape(`${name}:/tmp/install.sh`)}`
  )
  const own = execInContainer(name, `chown -R bootstrap:bootstrap ${TEMPLATE_DIR} /tmp/install.sh`, { user: 'root' })
  if (own.exitCode !== 0) {
    removeContainer(name)
    throw new Error(`Failed to hand the template to the bootstrap user:\n${own.output}`)
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
    `mkdir -p ${PROJECT_DIR} && cd ${PROJECT_DIR}`,
    // THE REAL INSTALLER, at the old release.
    `DEVSECOPS_TEMPLATE_URL=${TEMPLATE_DIR} DEVSECOPS_TEMPLATE_VCS_REF=${OLD_RELEASE} ` +
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

  // TASK_COPIER_ANSWER_FILE is what `task copier:update` resolves the answers
  // from, and Renovate's command relies on it being in the repository's
  // environment — exported here so the typed command matches Renovate's.
  const ttydStart = execInContainerAsUser(name, 'bootstrap', [
    'export PATH="$HOME/.local/bin:$PATH"',
    'export TASK_COPIER_ANSWER_FILE=.config/devsecops/.copier-answers.yml',
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
const TERMINAL_MASKS = [[/\b\d+ other tracked files\b/g, '<n> other tracked files']]

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

storyboardStep(Given, 'a project that installed source publication and nothing else', async () => {
  global.pubUpdateTemplate = buildTwoReleaseTemplate()
  global.pubUpdateContainer = setupUpdateTerminal(global.pubUpdateTemplate)

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

storyboardStep(When, 'a new toolbox release arrives and the update runs', async () => {
  await terminalCard(
    `task copier:update TASK_COPIER_CLI_OPTS='--skip-answered --defaults --vcs-ref ${NEW_RELEASE}'`,
    'task copier:update',
    'update-run'
  )
  const answers = inProjectOrThrow('grep _commit .config/devsecops/.copier-answers.yml')
  mustContain(answers, NEW_RELEASE, 'the update must move the recorded release')
})

storyboardStep(Then, 'the project tracks the new release, and git says exactly what moved', async () => {
  const screen = await terminalCard(
    'grep _commit .config/devsecops/.copier-answers.yml && git diff --stat',
    'grep _commit',
    'update-diff'
  )
  mustContain(screen, [`_commit: ${NEW_RELEASE}`, '.config/publication/denylist.base', 'copier/Taskfile.yml'],
    'the card must show the version and the framework files the release moved')

  const changed = inProjectOrThrow('git diff --name-only').split('\n').map(l => l.trim()).filter(Boolean).sort()
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
    'git diff --stat -- .config/publication/allowlist .config/publication/owners && cat .config/publication/owners',
    'git diff --stat --',
    'update-our-rules'
  )
  mustContain(screen, 'security-lead', "the team's own owners file must be exactly what they wrote")

  const dirty = inProjectOrThrow(
    'git diff --name-only -- .config/publication/allowlist .config/publication/denylist ' +
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
