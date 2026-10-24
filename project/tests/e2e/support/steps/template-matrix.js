/* global inject Given Then Before After document */
/**
 * Steps of @render-matrix: the WORKING-BRANCH template rendered inside the
 * codeceptjs container, once per Copier answer, and shown on GitLab.
 */
const { I } = inject()
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl, settlePage } = require('../helpers/gitlabCard')
const {
  compareRefs,
  getRepositoryFile,
  lintProjectCi,
  listProjectPipelines,
  listRepositoryTree
} = require('../helpers/gitlabApi')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { captureTerminalFrame, clearTerminal, terminalCard, terminalScreenText, typeCommandAndWait } = require('../terminal/capture')
const { addStoryboardFrame, storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

// Per-scenario state. Worker processes run scenarios sequentially, so
// module-level state is safe; the Before hook resets it for every scenario.
let rendered = null
let cleanupDirs = []

Before(() => {
  rendered = null
  cleanupDirs = []
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
})

function renderedPath (relative) {
  if (!rendered) throw new Error('No rendered project in this scenario — missing the Given step?')
  return path.join(rendered, relative)
}

function readRendered (relative) {
  const file = renderedPath(relative)
  if (!fs.existsSync(file)) {
    throw new Error(`Rendered file "${relative}" does not exist in ${rendered}`)
  }
  return fs.readFileSync(file, 'utf8')
}

function toolboxPackageRule () {
  const config = JSON.parse(readRendered('.config/renovate/config.json'))
  const rule = (config.packageRules || []).find(r => JSON.stringify(r).includes('DevSecOps Toolbox'))
  if (!rule) {
    throw new Error('No packageRules entry matching "DevSecOps Toolbox" in the rendered renovate config')
  }
  return rule
}

// ============================================
// Render-matrix storyboard — @render-matrix (chapters 1 + 2), told on GitLab.
// Chapter 1 renders the template with every default answer into ONE git work
// tree, pushes it as the main branch of a throwaway project and shows it on
// GitLab. Chapter 2 renders the SAME tree again once per non-default answer,
// pushes each render as its own branch, and shows GitLab's compare page of
// that branch against the main branch. The tree keeps one basename, so the
// project slug (written into project/docker-compose.yml) never differs between
// two branches. Every card is twinned with the same fact checked by code: the
// render on disk, GitLab's REST compare (the exact list of changed files) and
// GitLab's CI lint.
// ============================================

const MATRIX_ANSWERS = '.config/devsecops/.copier-answers.yml'
const MATRIX_MANUAL = '.config/codeceptjs/README.md'
const MATRIX_MAIN_COMMIT = 'render: every default Copier answer'
// Directories the framework keeps out of a default render: the opt-in tooling
// (Ansible, podman) and the publication kit.
const MATRIX_OPT_IN_CONFIG = ['ansible', 'ansible-lint', 'podman', 'publication']
// What moves between two runs of `task yamllint`: the render's temporary
// folder in the prompt, and the yamllint and Python versions Renovate moves.
const YAMLLINT_MASKS = [
  [/\/tmp\/e2e-render-matrix-\w+/g, '/tmp/e2e-render-matrix-<tmp>'],
  [/yamllint==[0-9][\w.]*/g, 'yamllint==<version>'],
  [/--python [0-9][\w.]*/g, '--python <version>']
]
const YAMLLINT_VERDICT = 'All files correctly linted with yamllint!'
let matrix = null

Before(() => { matrix = null })

// CodeceptJS does not await an async After: clear the shared state before the
// first await, or it would wipe the next scenario's matrix mid-run.
After(async () => {
  const done = matrix
  matrix = null
  if (done && done.closeTerminal) done.closeTerminal()
  if (done && done.pub) await done.pub.teardown()
})

function matrixGit (args) {
  return execFileSync('git', ['-C', matrix.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function matrixFile (relative) {
  return fs.readFileSync(path.join(matrix.dir, relative), 'utf8')
}

// What GitLab's compare lists, one line per file: A for added, D for deleted,
// R for renamed or M for modified, as `git diff --name-status` would print it.
function changeSet (compare) {
  return compare.diffs.map(d => {
    if (d.new_file) return `A ${d.new_path}`
    if (d.deleted_file) return `D ${d.old_path}`
    if (d.renamed_file) return `R ${d.old_path} -> ${d.new_path}`
    return `M ${d.new_path}`
  }).sort()
}

// The render's YAML, checked by code (#93, #96): every Taskfile ends on
// exactly one newline with no blank first line, and `task yamllint`, the
// project's own rules over every YAML file, exits 0.
function assertYamlClean (what) {
  const problems = []
  const taskfiles = fs.readdirSync(matrix.dir, { recursive: true })
    .filter(f => !f.startsWith('.git/') && /^Taskfile.*\.ya?ml$/.test(path.basename(f)))
  if (!taskfiles.length) throw new Error(`The ${what} render holds no Taskfile`)
  for (const file of taskfiles) {
    const text = matrixFile(file)
    if (text.startsWith('\n')) problems.push(`${file} starts with a blank line`)
    if (!text.endsWith('\n') || text.endsWith('\n\n')) problems.push(`${file} does not end with exactly one newline`)
  }
  try {
    execFileSync('task', ['yamllint'], { cwd: matrix.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    problems.push(`task yamllint fails:\n${stripAnsiEscapeSequences(String(error.stdout || '') + String(error.stderr || ''))}`)
  }
  if (problems.length) throw new Error(`Expected the ${what} render to pass its own YAML rules:\n${problems.join('\n')}`)
}

// The same work tree, rendered again from scratch with `answers` on a branch
// cut from the main branch, committed and pushed. Returns GitLab's compare of
// that branch against the main branch, checked against the exact change set.
async function renderAnswerBranch (branch, answers, expected) {
  matrixGit(['checkout', '--quiet', '-B', branch, 'main'])
  for (const entry of fs.readdirSync(matrix.dir)) {
    if (entry !== '.git') fs.rmSync(path.join(matrix.dir, entry), { recursive: true, force: true })
  }
  renderProject(answers, { dst: matrix.dir })
  // Whitespace control inside an answer's conditional is where a stray blank
  // line hides: every answer's render passes the default render's YAML check.
  assertYamlClean(branch)
  matrixGit(['add', '-A'])
  matrixGit(['commit', '--quiet', '-m', `render: ${Object.entries(answers).map(([k, v]) => `${k}=${v}`).join(' ')}`])
  matrix.pub.push(branch)
  const compare = await compareRefs(matrix.pub.projectName, 'main', branch, matrix.pub.headers)
  const got = changeSet(compare)
  const want = [...expected].sort()
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`The ${branch} render changes other files than its answer promises.\nExpected:\n${want.join('\n')}\nGitLab compare:\n${got.join('\n')}`)
  }
  return compare
}

// The render on disk, not only what git committed: a file main never had, or
// one the rendered .gitignore keeps out of the commit, never shows in a compare.
function assertLeftOut (branch, paths) {
  for (const p of paths) {
    if (fs.existsSync(path.join(matrix.dir, p))) throw new Error(`Expected the ${branch} render to leave ${p} out`)
  }
}

/**
 * GitLab's compare page of `branch` against the main branch (Rapid Diffs on
 * GitLab 19.4): every changed file listed in its Files panel, the files in
 * `expand` unfolded and every other one folded with GitLab's own toggle, the
 * page scrolled to the diff toolbar so the reader lands on the changes.
 * `height` is the page's height from that toolbar down, measured once: a
 * taller card shows a sliver of the commit list above the toolbar, a shorter
 * one cuts the last file.
 */
async function compareFrame (frameName, branch, compare, { expand, height }) {
  const count = compare.diffs.length
  await gitlabFrame(I, frameName, gitlabUrl.compare(matrix.pub.projectName, 'main', branch), {
    height,
    prepare: async () => {
      // GitLab streams the diffs in after the page: wait for all of them.
      try {
        // waitForFunction hands its argument array over as ONE argument.
        await I.waitForFunction(([n]) => document.querySelectorAll('diff-file').length === n, [count], 60)
      } catch (err) {
        const shown = await I.executeScript(() => document.querySelectorAll('diff-file').length)
        throw new Error(`compareFrame ${branch}: GitLab shows ${shown} diff files, the REST compare has ${count}`)
      }
      await I.executeScript((keep) => {
        document.querySelectorAll('diff-file').forEach(file => {
          const data = JSON.parse(file.getAttribute('data-file-data') || '{}')
          const wantOpen = keep.includes(data.new_path) || keep.includes(data.old_path)
          const toggle = Array.from(file.querySelectorAll('button[data-click="toggleFile"]')).find(b => b.offsetParent !== null)
          if (!toggle) throw new Error(`compareFrame: no file toggle for ${data.new_path}`)
          if (toggle.hasAttribute('data-opened') !== wantOpen) toggle.click()
        })
      }, expand)
      await I.waitForFunction(([keep]) => Array.from(document.querySelectorAll('diff-file')).every(file => {
        const data = JSON.parse(file.getAttribute('data-file-data') || '{}')
        const wantOpen = keep.includes(data.new_path) || keep.includes(data.old_path)
        const toggle = Array.from(file.querySelectorAll('button[data-click="toggleFile"]')).find(b => b.offsetParent !== null)
        return toggle && toggle.hasAttribute('data-opened') === wantOpen
      }), [expand], 30)
    },
    scrollTo: async () => {
      await I.executeScript(() => {
        document.querySelector('.rd-app-header').scrollIntoView({ block: 'start' })
        // GitLab scrolls its left navigation to the active item, by an amount
        // that depends on the card's height: every compare card starts it at the top.
        const sidebar = document.querySelector('#super-sidebar')
        if (!sidebar) throw new Error('compareFrame: GitLab shows no #super-sidebar')
        ;[sidebar, ...sidebar.querySelectorAll('*')].forEach(el => { el.scrollTop = 0 })
      })
      await settlePage(I, { quietMs: 300 })
    }
  })
}

storyboardStep(Given, 'GitLab holds a project rendered with every default Copier answer on its main branch', async () => {
  const root = fs.mkdtempSync('/tmp/e2e-render-matrix-')
  cleanupDirs.push(root)
  // A fixed basename: the project slug every branch renders.
  matrix = { dir: path.join(root, 'acme') }
  fs.mkdirSync(matrix.dir)
  matrixGit(['init', '--quiet', '--initial-branch=main'])
  matrixGit(['config', 'user.email', process.env.TASK_GITLAB_LAMBDA_EMAIL || 'lambda@test.local'])
  matrixGit(['config', 'user.name', 'Lambda User'])
  // A fixture commit: the hooks a rendered project installs are another story's subject.
  matrixGit(['config', 'core.hooksPath', '/dev/null'])
  renderProject({}, { dst: matrix.dir })
  matrixGit(['add', '-A'])
  matrixGit(['commit', '--quiet', '-m', MATRIX_MAIN_COMMIT])
  // ci.skip: a skipped pipeline, never a running one that repaints the cards.
  matrix.pub = await publishToGitLab(matrix.dir, {
    name: `e2e-render-matrix-${crypto.randomBytes(4).toString('hex')}`,
    pushOptions: ['ci.skip']
  })
  const { projectName, headers } = matrix.pub

  // Twins of the default layout, each one the minus side of a compare below.
  const has = (p) => fs.existsSync(path.join(matrix.dir, p))
  for (const p of ['.config/docker-ce/Taskfile.yml', 'project/Taskfile.yml', 'project/docker-compose.yml']) {
    if (!has(p)) throw new Error(`Expected the default render to deliver ${p}`)
  }
  const renderErrors = []
  if (JSON.parse(matrixFile('.config/cspell/config.project.json')).words.length !== 0) {
    renderErrors.push('The framework must ship an empty project dictionary; shared technical words belong in its base dictionary')
  }
  for (const p of ['.config/podman', '.config/ansible', '.superpowers', 'docs/plans', '.config/devsecops/scripts/__pycache__']) {
    if (has(p)) renderErrors.push(`Expected the default render to leave ${p} out`)
  }
  if (renderErrors.length) throw new Error(renderErrors.join('\n'))
  if (!matrixFile('project/docker-compose.yml').includes('networks:')) throw new Error('Expected project/docker-compose.yml to declare its networks')
  const taskfile = matrixFile('Taskfile.yml')
  for (const include of ['.config/docker-ce/Taskfile.yml', 'project/Taskfile.yml']) {
    if (!taskfile.includes(include)) throw new Error(`Expected the root Taskfile to include ${include}`)
  }
  if (taskfile.includes('.config/podman/Taskfile.yml')) throw new Error('Expected the default root Taskfile to leave the podman include out')
  if (!matrixFile('.config/gitlab/ci/variables.yml').includes('DOCKER_HOST: tcp://docker:2376')) throw new Error('Expected the CI variables to target tcp://docker:2376')
  if (!matrixFile('.config/gitlab/ci/devsecops/release.yml').includes('after_script:')) throw new Error('Expected the release job to keep its after_script')
  if (!matrixFile('.agents/rules/tests-structure.md').includes('Gherkin in **en**')) throw new Error('Expected the tests-structure rule to ask for Gherkin in **en**')
  rendered = matrix.dir
  const rule = toolboxPackageRule()
  if (rule.automerge !== true || rule.automergeStrategy !== 'fast-forward') {
    throw new Error(`Expected the toolbox package rule to automerge by fast-forward, got: ${JSON.stringify(rule)}`)
  }
  // GitLab's own CI lint: the default pipeline holds together.
  const lint = await lintProjectCi(projectName, headers, 'main')
  if (!lint.data || lint.data.valid !== true) throw new Error(`Expected GitLab to find the main branch CI valid: ${JSON.stringify(lint.data)}`)
  // The skipped pipeline is recorded a moment after the push: wait for it, so
  // its status icon is on every card or on none.
  let skipped = false
  for (let i = 0; i < 30 && !skipped; i++) {
    const pipelines = await listProjectPipelines(projectName, headers, '?ref=main')
    skipped = Array.isArray(pipelines.data) && pipelines.data.length > 0
    if (!skipped) await new Promise(resolve => setTimeout(resolve, 2000))
  }
  if (!skipped) throw new Error('GitLab recorded no skipped pipeline on the main branch after 60 s')

  await gitlabFrame(I, 'defaults-answers', gitlabUrl.file(projectName, 'main', MATRIX_ANSWERS), {
    waitText: 'container_runtime: docker',
    height: 900
  })
  if (await getRepositoryFile(projectName, MATRIX_ANSWERS, 'main', headers) !== matrixFile(MATRIX_ANSWERS)) {
    throw new Error('Expected GitLab to hold the answers file of the render, byte for byte')
  }
})

storyboardStep(Then, 'the main branch carries the project workspace and leaves the toolbox README out', async () => {
  const { projectName, headers } = matrix.pub
  await gitlabFrame(I, 'defaults-tree', gitlabUrl.tree(projectName), { waitText: MATRIX_MAIN_COMMIT, height: 1100 })
  // Twin: the root GitLab lists is the render's root, with project/ and no README.
  const tree = await listRepositoryTree(projectName, headers, '?ref=main&per_page=100')
  const remote = tree.data.map(e => e.name).sort()
  const local = fs.readdirSync(matrix.dir).filter(e => e !== '.git').sort()
  if (JSON.stringify(remote) !== JSON.stringify(local)) {
    throw new Error(`Expected GitLab's root to be the render's root.\nGitLab: ${remote.join(' ')}\nRender: ${local.join(' ')}`)
  }
  if (!remote.includes('project')) throw new Error('Expected the project workspace on the main branch')
  if (remote.includes('README.md')) throw new Error('The toolbox root README must stay out of the generated project')
  // Twin: .config is the framework's, minus the opt-in tooling a default render leaves out.
  const config = fs.readdirSync(path.join(matrix.dir, '.config')).sort()
  const expected = fs.readdirSync('/workspace/.config').filter(d => !MATRIX_OPT_IN_CONFIG.includes(d)).sort()
  if (JSON.stringify(config) !== JSON.stringify(expected)) {
    throw new Error(`Expected .config to be the framework's minus ${MATRIX_OPT_IN_CONFIG.join(', ')}.\nRender: ${config.join(' ')}\nExpected: ${expected.join(' ')}`)
  }
})

storyboardStep(Then, 'the storyboard engine folder on the main branch ships its own manual', async () => {
  const { projectName, headers } = matrix.pub
  await gitlabFrame(I, 'defaults-storyboard-manual', gitlabUrl.tree(projectName, 'main', '.config/codeceptjs'), {
    waitText: 'Storyboard engine',
    // The manual's heading and first paragraph, cut before its next section.
    height: 1020
  })
  // Twin: the manual GitLab renders is the framework's, byte for byte.
  if (await getRepositoryFile(projectName, MATRIX_MANUAL, 'main', headers) !== fs.readFileSync(`/workspace/${MATRIX_MANUAL}`, 'utf8')) {
    throw new Error(`Expected ${MATRIX_MANUAL} on the main branch to be the framework's manual`)
  }
})

storyboardStep(Then, 'every YAML file of the default project passes yamllint', async () => {
  // Twin first, by code: it also warms uv's cache, so the terminal shows no
  // download.
  assertYamlClean('default')
  const env = { ...process.env }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete env[name]
  matrix.closeTerminal = await openLocalTerminal(I, { cwd: matrix.dir, env, port: 7701, height: 600 })
  const screen = await terminalCard(I, 'defaults-yamllint', 'task yamllint', { mask: YAMLLINT_MASKS })
  if (!screen.includes(YAMLLINT_VERDICT) || screen.includes('Failed to run task')) {
    throw new Error(`Expected task yamllint to end on "${YAMLLINT_VERDICT}":\n${screen}`)
  }
})

storyboardStep(Then, 'choosing podman swaps docker-ce and compose for podman and changes nothing else', async () => {
  const compare = await renderAnswerBranch('podman', { container_runtime: 'podman' }, [
    `M ${MATRIX_ANSWERS}`,
    'D .config/docker-ce/Taskfile.yml',
    'D .config/docker-ce/playbook.yml',
    'D .config/docker-ce/requirements.yml',
    'R .config/docker-ce/.gitignore -> .config/podman/.gitignore',
    'A .config/podman/Taskfile.yml',
    'A .config/podman/playbook.yml',
    'A .config/podman/requirements.yml',
    'M Taskfile.yml',
    'D project/docker-compose.yml'
  ])
  assertLeftOut('podman', ['.config/docker-ce', 'project/docker-compose.yml'])
  const taskfile = matrixFile('Taskfile.yml')
  if (!taskfile.includes('.config/podman/Taskfile.yml') || taskfile.includes('.config/docker-ce/Taskfile.yml')) {
    throw new Error('Expected the root Taskfile to include podman instead of docker-ce')
  }
  // The swapped includes fill the card: the answers file stays folded.
  await compareFrame('answers-podman', 'podman', compare, { expand: ['Taskfile.yml'], height: 1100 })
})

storyboardStep(Then, 'turning off Docker Compose only deletes the compose file', async () => {
  const compare = await renderAnswerBranch('no-compose', { use_docker_compose: 'false' }, [
    `M ${MATRIX_ANSWERS}`,
    'D project/docker-compose.yml'
  ])
  assertLeftOut('no-compose', ['project/docker-compose.yml'])
  await compareFrame('answers-no-compose', 'no-compose', compare, { expand: [MATRIX_ANSWERS, 'project/docker-compose.yml'], height: 660 })
})

storyboardStep(Then, 'turning on Ansible only adds its config, its lint tooling and their Taskfile include', async () => {
  const compare = await renderAnswerBranch('ansible', { ansible_enabled: 'true' }, [
    `M ${MATRIX_ANSWERS}`,
    'A .config/ansible-lint/config.yaml',
    'A .config/ansible/Taskfile.yml',
    'A .config/ansible/ansible.cfg',
    'A .config/ansible/requirements.txt',
    'M Taskfile.yml'
  ])
  if (!matrixFile('Taskfile.yml').includes('.config/ansible/Taskfile.yml')) throw new Error('Expected the root Taskfile to include .config/ansible/Taskfile.yml')
  await compareFrame('answers-ansible', 'ansible', compare, { expand: [MATRIX_ANSWERS, 'Taskfile.yml'], height: 872 })
})

storyboardStep(Then, 'a self-hosted CI platform only changes the docker-in-docker variables and the runner tags', async () => {
  const compare = await renderAnswerBranch('self-hosted', { ci_platform: 'gitlab_self_hosted', gitlab_docker_host: '', gitlab_docker_tls_certdir: '' }, [
    `M ${MATRIX_ANSWERS}`,
    'M .config/gitlab/ci/tags.yml',
    'M .config/gitlab/ci/variables.yml'
  ])
  const variables = matrixFile('.config/gitlab/ci/variables.yml')
  if (variables.includes('DOCKER_HOST: tcp://docker:2376')) throw new Error('Expected the self-hosted CI variables to drop DOCKER_HOST: tcp://docker:2376')
  if (!variables.includes('DOCKER_TLS_CERTDIR: ""')) throw new Error('Expected the self-hosted CI variables to set DOCKER_TLS_CERTDIR to an empty value')
  if (!/^\s*tags: \[\]$/m.test(matrixFile('.config/gitlab/ci/tags.yml'))) throw new Error('Expected the self-hosted runner tags to be empty')
  // The only branch whose CI files differ from the main branch: GitLab lints it too.
  const lint = await lintProjectCi(matrix.pub.projectName, matrix.pub.headers, 'self-hosted')
  if (!lint.data || lint.data.valid !== true) throw new Error(`Expected GitLab to find the self-hosted CI valid: ${JSON.stringify(lint.data)}`)
  // The two CI files fill the card: the answers file stays folded, listed with its +5 -2.
  await compareFrame('answers-self-hosted', 'self-hosted', compare, {
    expand: ['.config/gitlab/ci/tags.yml', '.config/gitlab/ci/variables.yml'],
    height: 938
  })
})

storyboardStep(Then, 'turning off project mode deletes the project directory and every task that called into it', async () => {
  const phases = ['build', 'code', 'deploy', 'feedback', 'monitor', 'operate', 'plan', 'release', 'test']
  const compare = await renderAnswerBranch('no-project', { project_enabled: 'false' }, [
    `M ${MATRIX_ANSWERS}`,
    ...phases.map(p => `M .config/devsecops/Taskfile.${p}.yml`),
    'M .config/megalinter/config.base.yml',
    'M Taskfile.yml',
    'D project/Taskfile.yml',
    'D project/docker-compose.yml'
  ])
  assertLeftOut('no-project', ['project'])
  if (matrixFile('Taskfile.yml').includes('project/Taskfile.yml')) throw new Error('Expected the root Taskfile to drop its project include')
  // Twin: each phase Taskfile only loses its calls into the project tasks,
  // plus the test phase's coverage defaults, which follow project mode.
  for (const d of compare.diffs.filter(d => /^\.config\/devsecops\/Taskfile\.\w+\.yml$/.test(d.new_path))) {
    const changed = d.diff.split('\n').filter(l => /^[-+]/.test(l))
    const calls = changed.filter(l => /^-\s*- task: :project:/.test(l))
    if (!calls.length || changed.some(l => !calls.includes(l) && !/TASK_DEVSECOPS_TEST_BUILD_COVERAGE_/.test(l))) {
      throw new Error(`Expected ${d.new_path} to only drop its calls into the project tasks:\n${d.diff}`)
    }
  }
  // Unfolding the root Taskfile.yml instead of the answers file needs 1135 px,
  // past the 1100 cap: every other file stays folded, the twins above
  // carry what they change.
  await compareFrame('answers-no-project', 'no-project', compare, { expand: [MATRIX_ANSWERS], height: 1095 })
})

storyboardStep(Then, 'turning off automerge only removes the fast-forward rule from the Renovate config', async () => {
  const compare = await renderAnswerBranch('automerge-off', { devsecops_automerge: 'false' }, [
    `M ${MATRIX_ANSWERS}`,
    'M .config/renovate/config.json'
  ])
  const rule = toolboxPackageRule()
  const left = ['automerge', 'automergeStrategy', 'automergeType', 'platformAutomerge'].filter(k => k in rule)
  if (left.length) throw new Error(`Expected the toolbox package rule to drop every automerge property, still has: ${left.join(', ')}`)
  await compareFrame('answers-automerge-off', 'automerge-off', compare, { expand: [MATRIX_ANSWERS, '.config/renovate/config.json'], height: 700 })
})

storyboardStep(Then, 'choosing French Gherkin switches every test-writing rule and skill to French', async () => {
  const compare = await renderAnswerBranch('gherkin-fr', { gherkin_language: 'fr' }, [
    `M ${MATRIX_ANSWERS}`,
    'M .agents/rules/interaction.md',
    'M .agents/rules/tests-structure.md',
    'M .agents/skills/development-cycle/SKILL.md',
    'M .agents/skills/tdd-step1-red/SKILL.md',
    'M .agents/skills/tdd/SKILL.md',
    'M .agents/skills/test/SKILL.md'
  ])
  if (!matrixFile('.agents/rules/tests-structure.md').includes('Gherkin in **fr**')) throw new Error('Expected the tests-structure rule to ask for Gherkin in **fr**')
  // Twin: every changed line is the same line with en swapped for fr.
  for (const d of compare.diffs) {
    const lines = d.diff.split('\n')
    const removed = lines.filter(l => l.startsWith('-')).map(l => l.slice(1))
    const added = lines.filter(l => l.startsWith('+')).map(l => l.slice(1))
    if (removed.length !== added.length || removed.some((l, i) => l.replace(/\ben\b/g, 'fr') !== added[i])) {
      throw new Error(`Expected ${d.new_path} to only swap en for fr:\n${d.diff}`)
    }
  }
  await compareFrame('answers-gherkin-fr', 'gherkin-fr', compare, {
    expand: [MATRIX_ANSWERS, '.agents/rules/tests-structure.md'],
    height: 910
  })
})

// ============================================
// Chapter 3 of @render-matrix: the default project against the toolbox's own
// files (#197). A toolbox file X with a template twin X.jinja reaches the
// projects through the twin only, so a fix made to X alone never ships. Every
// twin of the default render must render like the toolbox's own X, blank
// lines aside; a Taskfile is held include by include and task by task,
// comments aside. The differences listed below are deliberate, each with its
// reason. Anything else is drift.
// ============================================

const TOOLBOX = '/workspace'
const SKILL_AUDIENCE = 'the toolbox points at its own e2e suite, a project at its project/tests folder'
const TWIN_DIFFERENCES = {
  '.agents/rules/interaction.md': 'it points at code-style.md, a rule only the toolbox has',
  '.agents/rules/tests-integrity.md': 'the toolbox describes its own storyboard gates and suite',
  '.agents/skills/create-feature/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/delete-feature/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/development-cycle/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/read-feature/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/tdd/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/tdd-step1-red/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/test/SKILL.md': SKILL_AUDIENCE,
  '.agents/skills/update-feature/SKILL.md': SKILL_AUDIENCE,
  '.config/commitizen/cz.yaml': 'the toolbox also bumps its own image tag',
  '.config/gitlab/ci/devsecops/code.yml': 'code:all runs on Alpine on both sides: alpine:latest in the toolbox, alpine:3.20 in a project',
  '.config/gitlab/ci/devsecops/test.yml': 'the toolbox shards its suite and publishes its storyboards; the test job artifacts are checked below',
  '.config/gitlab/ci/tags.yml': 'written from the CI platform answers',
  '.config/gitlab/ci/variables.yml': 'written from the CI platform answers',
  '.config/megalinter/config.base.yml': 'the toolbox scans its own tools, a project leaves them to the toolbox',
  '.config/megalinter/config.yml': "the project's own MegaLinter settings",
  '.config/renovate/config.json': 'a project only follows the toolbox release and its own project folder',
  '.env.dist': 'the toolbox adds the settings of its test GitLab',
  'CHANGELOG.md': 'a project starts its own history',
  VERSION: 'a project starts at 0.1.0',
  'project/Taskfile.yml': "a project's own tasks start empty",
  'project/docker-compose.yml': "a project's own services start empty; the network MTU is checked below"
}
// Inside the Taskfiles: includes the default answers leave out (ansible,
// podman), init kept optional for a single-component project, the toolbox's
// own guards (a call to one of them goes with it) and the wording of two gates
// for a project's audience.
const TASKFILE_DIFFERENCES = {
  'Taskfile.yml': ['include ansible', 'include podman', 'include devsecops:init'],
  '.config/devsecops/Taskfile.test.yml': [
    'task check:include-coverage', 'task check:release-lock', 'task check:shard-coverage',
    'task check:storyboard-coverage', 'task check:test-coverage',
    'task check:no-cheat', 'task check:red-is-real'
  ]
}
const TWIN_TASKS = '(devsecops:init|glow|gum):'
const TWIN_MASKS = [[/\/tmp\/e2e-render-matrix-\w+/g, '/tmp/e2e-render-matrix-<tmp>']]

// A Taskfile's includes and tasks, each with the lines under it, blank lines
// and comments aside.
function taskfileBlocks (lines) {
  const blocks = new Map()
  let section = null
  let key = null
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const top = line.match(/^(\S+):/)
    const head = line.match(/^ {2}(\S+):\s*$/)
    if (top) {
      section = top[1]
      key = null
    } else if (head && (section === 'includes' || section === 'tasks')) {
      key = `${section === 'includes' ? 'include' : 'task'} ${head[1]}`
      blocks.set(key, [])
    } else if (key) {
      blocks.get(key).push(line)
    }
  }
  return new Map([...blocks].map(([k, body]) => [k, body.join('\n')]))
}

// Every twin of the render that differs from the toolbox's own file and is not
// listed as deliberate.
function twinDrifts (render) {
  // Each file once: not again through a link (.claude/skills/* -> .agents/skills/*).
  const root = fs.realpathSync(render)
  const twins = fs.readdirSync(render, { recursive: true })
    .filter(f => !f.startsWith(`.git${path.sep}`) && fs.realpathSync(path.join(root, f)) === path.join(root, f))
    .filter(f => fs.existsSync(path.join(TOOLBOX, `${f}.jinja`)) && fs.existsSync(path.join(TOOLBOX, f)))
  if (twins.length < Object.keys(TWIN_DIFFERENCES).length) throw new Error(`Found only ${twins.length} .jinja twins in the default render`)
  const substance = (text) => text.split('\n').filter(l => l.trim()).join('\n')
  const drifts = []
  for (const file of twins.filter(f => !(f in TWIN_DIFFERENCES))) {
    const own = fs.readFileSync(path.join(TOOLBOX, file), 'utf8')
    const theirs = fs.readFileSync(path.join(render, file), 'utf8')
    if (!/(^|\/)Taskfile[^/]*\.yml$/.test(file)) {
      if (substance(own) !== substance(theirs)) drifts.push(`${file} differs from the toolbox's own`)
      continue
    }
    const deliberate = TASKFILE_DIFFERENCES[file] || []
    const project = taskfileBlocks(theirs.split('\n'))
    const toolboxOnly = deliberate.filter(k => k.startsWith('task ') && !project.has(k)).map(k => k.slice('task '.length))
    const toolbox = taskfileBlocks(own.split('\n').filter(l => {
      const call = l.match(/^\s*- task: :?(\S+)\s*$/)
      return !(call && toolboxOnly.includes(call[1]))
    }))
    for (const key of new Set([...toolbox.keys(), ...project.keys()])) {
      if (deliberate.includes(key)) continue
      if (!project.has(key)) drifts.push(`${file}: ${key} is only in the toolbox`)
      else if (!toolbox.has(key)) drifts.push(`${file}: ${key} is only in the project`)
      else if (toolbox.get(key) !== project.get(key)) drifts.push(`${file}: ${key} differs from the toolbox's own`)
    }
  }
  return drifts
}

// The lines of `task --list` the first card greps, spaces evened out.
function listedTasks (dir) {
  const out = execFileSync('task', ['--list'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return stripAnsiEscapeSequences(out).split('\n').filter(l => new RegExp(TWIN_TASKS).test(l)).map(l => l.replace(/\s+/g, ' ').trim())
}

// ONE terminal card in the default render, opened and closed inside its step:
// the typed lines one after the other, then everything from the first one
// down to the prompt that came back. Two lines when the card compares the
// project with the toolbox: the second prompt shows where the second list
// comes from.
async function twinCard (frameName, commands) {
  const env = { ...process.env }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete env[name]
  const close = await openLocalTerminal(I, { cwd: matrix.dir, env, port: 7703, height: 800 })
  try {
    await clearTerminal(I)
    for (const command of commands) await typeCommandAndWait(I, command)
    await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: commands[0].slice(0, 40), mask: TWIN_MASKS }))
    return await terminalScreenText(I)
  } finally {
    close()
  }
}

storyboardStep(Then, 'the default project lists the same init, gum and glow tasks as the toolbox', async () => {
  // Back to the default render: the main branch, as GitLab holds it.
  matrixGit(['checkout', '--quiet', 'main'])
  if (matrixGit(['status', '--porcelain'])) throw new Error('Expected the main branch checkout to be the default render, untouched')
  const drifts = twinDrifts(matrix.dir)
  if (drifts.length) {
    throw new Error(`Expected every .jinja twin of the default project to render like the toolbox's own file, or to be listed as a deliberate difference:\n${drifts.join('\n')}`)
  }
  const project = listedTasks(matrix.dir)
  const toolbox = listedTasks(TOOLBOX)
  if (project.length !== 10 || JSON.stringify(project) !== JSON.stringify(toolbox)) {
    throw new Error(`Expected the project and the toolbox to list the same ten init, gum and glow tasks.\nProject:\n${project.join('\n')}\nToolbox:\n${toolbox.join('\n')}`)
  }
  const grep = `task --list | grep -E '${TWIN_TASKS}'`
  const screen = await twinCard('defaults-twin-tasks', [grep, `cd ${TOOLBOX} && ${grep}`])
  for (const line of project) {
    const name = line.split(' ')[1]
    if (screen.split('\n').filter(l => l.trim().startsWith(`* ${name} `)).length !== 2) {
      throw new Error(`Expected the card to list ${name} once for each side:\n${screen}`)
    }
  }
})

storyboardStep(Then, "the default project's compose network uses the same 1360 MTU as the toolbox", async () => {
  const mtu = (text) => (text.match(/^\s*com\.docker\.network\.driver\.mtu: (\d+)\s*$/m) || [])[1]
  const own = mtu(fs.readFileSync(path.join(TOOLBOX, 'project/docker-compose.yml'), 'utf8'))
  if (own !== '1360') throw new Error(`Expected the toolbox's own compose network to use an MTU of 1360, found ${own}`)
  const compose = matrixFile('project/docker-compose.yml')
  if (mtu(compose) !== own) throw new Error(`Expected the default project's compose network to use the toolbox's MTU of ${own}:\n${compose}`)
  const screen = await twinCard('defaults-compose-mtu', ['cat project/docker-compose.yml'])
  if (!screen.includes(`com.docker.network.driver.mtu: ${own}`)) throw new Error(`Expected the card to show the MTU:\n${screen}`)
})

storyboardStep(Then, "the default project's test job keeps its test folder, not the whole project folder", async () => {
  const job = (matrixFile('.config/gitlab/ci/devsecops/test.yml').match(/^test:\n[\s\S]*?(?=^\S|$(?![\s\S]))/m) || [''])[0]
  const paths = ((job.match(/^ {4}paths:\n((?: {6}.*\n)+)/m) || [])[1] || '').split('\n')
    .map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => l.slice(2))
  if (JSON.stringify(paths) !== JSON.stringify(['.diagnostics', 'project/tests'])) {
    throw new Error(`Expected the default test job to keep .diagnostics and project/tests as artifacts, found ${JSON.stringify(paths)}:\n${job}`)
  }
  const screen = await twinCard('defaults-test-artifacts', ['head -n 30 .config/gitlab/ci/devsecops/test.yml'])
  if (!screen.includes('- project/tests') || !screen.includes('expire_in: 3 days')) throw new Error(`Expected the card to show the artifacts list down to expire_in:\n${screen}`)
})
