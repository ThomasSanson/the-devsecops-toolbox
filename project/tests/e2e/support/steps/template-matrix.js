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
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

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
let matrix = null

Before(() => { matrix = null })

After(async () => {
  if (matrix && matrix.pub) await matrix.pub.teardown()
  matrix = null
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

// The same work tree, rendered again from scratch with `answers` on a branch
// cut from the main branch, committed and pushed. Returns GitLab's compare of
// that branch against the main branch, checked against the exact change set.
async function renderAnswerBranch (branch, answers, expected) {
  matrixGit(['checkout', '--quiet', '-B', branch, 'main'])
  for (const entry of fs.readdirSync(matrix.dir)) {
    if (entry !== '.git') fs.rmSync(path.join(matrix.dir, entry), { recursive: true, force: true })
  }
  renderProject(answers, { dst: matrix.dir })
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
  for (const p of ['.config/podman', '.config/ansible']) {
    if (has(p)) throw new Error(`Expected the default render to leave ${p} out`)
  }
  if (!matrixFile('project/docker-compose.yml').includes('networks:')) throw new Error('Expected project/docker-compose.yml to declare its networks')
  const taskfile = matrixFile('Taskfile.yml')
  for (const include of ['.config/docker-ce/Taskfile.yml', 'project/Taskfile.yml']) {
    if (!taskfile.includes(include)) throw new Error(`Expected the root Taskfile to include ${include}`)
  }
  if (taskfile.includes('.config/podman/Taskfile.yml')) throw new Error('Expected the default root Taskfile to leave the podman include out')
  if (!matrixFile('.config/gitlab/ci/variables.yml').includes('DOCKER_HOST: tcp://docker:2376')) throw new Error('Expected the CI variables to target tcp://docker:2376')
  if (!matrixFile('.config/gitlab/ci/devsecops/release.yml').includes('after_script:')) throw new Error('Expected the release job to keep its after_script')
  if (!matrixFile('.agent/rules/tests-structure.md').includes('Gherkin in **en**')) throw new Error('Expected the tests-structure rule to ask for Gherkin in **en**')
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
  await compareFrame('answers-no-compose', 'no-compose', compare, { expand: [MATRIX_ANSWERS, 'project/docker-compose.yml'], height: 520 })
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
    'M .agent/rules/interaction.md',
    'M .agent/rules/tests-structure.md',
    'M .agent/skills/tdd/SKILL.md',
    'M .agent/skills/test/SKILL.md',
    'M .agent/workflows/development-cycle.md',
    'M .agent/workflows/tdd-step1-red.md'
  ])
  if (!matrixFile('.agent/rules/tests-structure.md').includes('Gherkin in **fr**')) throw new Error('Expected the tests-structure rule to ask for Gherkin in **fr**')
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
    expand: [MATRIX_ANSWERS, '.agent/rules/tests-structure.md'],
    height: 910
  })
})
