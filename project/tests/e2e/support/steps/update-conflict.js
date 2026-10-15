/* global inject Given When Then Before After */
/**
 * @toolbox-update-conflict: a toolbox release and the developer's own edit
 * change the SAME line of a framework file (the CI image of .gitlab-ci.yml), on
 * a real GitLab project. The real `task devsecops:update` drops neither side:
 * it warns, the clash reaches the update merge request, and the developer
 * settles it there.
 *
 * ONE sentence = ONE card = ONE pixel baseline: the commit page, the terminal
 * run, then the merge request's Changes tab before and after the fix (the same
 * page, so the reader compares two panels). Every card is paired with a check
 * of the same fact: REST on GitLab, or the working tree in the container.
 *
 * @agents-move: the same promise for the release that moves the AI agent files
 * from .agent/ to .agents/, with the team's own rule and its edit to a toolbox
 * rule in the old folder: the commit page, the terminal run, then the update
 * branch on GitLab (its tree, and the one file left in conflict).
 */
const crypto = require('crypto')
const { I, GitLabUserPage } = inject()
const { execInContainerAsUser } = require('../helpers/docker')
const {
  BASE_URL,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectMergeRequests,
  listCommits,
  getRepositoryFile,
  listRepositoryTree,
  lintProjectCi
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const { PROJECT_DIR, setupManualUpdateTerminal, teardownJourneyTerminal } = require('../helpers/journeyContainer')
const { prepareConflictTemplate, prepareAgentsMoveTemplate, removeRendered, OLD_WORKFLOWS, AGENTS_MOVE_RELEASE_LINE, COPIER_RUN_MASKS } = require('../helpers/copierRender')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { gitlabUrl, gitlabFrame, unfoldFileTree, inNewTab } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const CI_FILE = '.gitlab-ci.yml'
const IMAGE = 'image: registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox'
const UPDATE_BRANCH = 'update-framework-devsecops'
const PIN_COMMIT = 'ci: pin our hardened image'
const FIX_COMMIT = 'ci: keep our hardened image on 1.0.1'
// The lines the developer types, exactly as the cards' # Copy gives them.
const PIN = `sed -i 's/:1.0.0$/:1.0.0-hardened/' ${CI_FILE} && git commit -qam "${PIN_COMMIT}" && git push -q`
const FIX = `sed -i '/^<<<<<<< /,/^>>>>>>> /c ${IMAGE}:1.0.1-hardened' ${CI_FILE} && git commit -qam "${FIX_COMMIT}" && git push -q`

let state = {}

Before(() => { state = {} })

After(async () => {
  // Keep this scenario's resources locally before any await: the next one resets state.
  const { container, template, project, tokenId } = state
  state = {}
  teardownJourneyTerminal(container)
  removeRendered(template)
  if (!project && !tokenId) return
  const root = await getRootHeaders().catch(() => null)
  if (!root) return
  if (project) await deleteProject(project, root).catch(() => {})
  if (tokenId) await revokePersonalAccessToken(tokenId, root).catch(() => {})
})

function inProject (script) {
  const res = execInContainerAsUser(state.container, 'bootstrap', `cd ${PROJECT_DIR} && ${script}`)
  if (res.exitCode !== 0) throw new Error(`\`${script}\` failed in the project:\n${res.output}`)
  return (res.output || '').trim()
}

async function api (route) {
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(state.project)}${route}`, await getRootHeaders())
  if (res.status >= 400) throw new Error(`GET ${route}: HTTP ${res.status}`)
  return res.data
}

// Poll read() until ok(value), every 3 s.
async function until (what, read, ok, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (ok(last)) return last
    await I.wait(3)
  }
  throw new Error(`${what}. Last seen: ${JSON.stringify(last, null, 2)}`)
}

async function mainTitle () {
  return (await listCommits(state.project, 'main', await getRootHeaders()))[0].title
}

async function ciDiff () {
  const changes = (await api(`/merge_requests/${state.iid}/changes`)).changes || []
  const change = changes.find(c => c.new_path === CI_FILE)
  return change ? change.diff : ''
}

function expectLines (text, lines, what) {
  const missing = lines.filter(line => !text.split('\n').includes(line))
  if (missing.length) throw new Error(`${what}: missing ${JSON.stringify(missing)} in\n${text}`)
}

// The Changes tab, once GitLab's own counters on it are final. The Pipelines
// counter fills in on GitLab's own time, so wait for the expected pipelines
// first (the twin): `ok` receives them as "source:status", oldest first.
async function changesCard (frameName, waitText, ok) {
  await until('The merge request pipelines are not the expected ones',
    async () => (await api(`/merge_requests/${state.iid}/pipelines`)).map(p => `${p.source}:${p.status}`).reverse(), ok)
  await gitlabFrame(I, frameName, gitlabUrl.mr(state.project, state.iid, 'diffs'), { waitText })
}

// Off camera: the test user, a public project (no shared runner: its pipelines
// wait instead of running the whole framework), release 1.0.0 rendered in the
// terminal container, pushed to the main branch, glab signed in. Then the
// developer's own commit, the card's # Copy run as is. On camera: GitLab's page
// for that commit, its pipeline row hidden (not this story).
// The test user's public project, release 1.0.0 of `template` generated and
// pushed to its main branch, and the terminal on that clone, glab signed in.
async function generatedProjectOnGitLab (prefix, template, settings = {}) {
  await GitLabUserPage.ensureUserViaApi(BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD, {
    email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
    username: process.env.TASK_GITLAB_LAMBDA_USER,
    name: 'Lambda User',
    password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
  })
  const root = await getRootHeaders()
  state.project = `e2e-${prefix}-${crypto.randomBytes(4).toString('hex')}`
  const { token, id } = await createLambdaPersonalAccessToken(`${prefix}-${state.project}`, ['api', 'write_repository'], root)
  state.tokenId = id
  const created = await createProject(
    { name: state.project, visibility: 'public', initialize_with_readme: false, auto_devops_enabled: false, shared_runners_enabled: false, ...settings },
    { 'PRIVATE-TOKEN': token }
  )
  if (created.status >= 400) throw new Error(`Creating ${state.project}: HTTP ${created.status} ${JSON.stringify(created.data)}`)
  state.template = template
  state.container = setupManualUpdateTerminal(state.project, token, { template })
}

storyboardStep(Given, "the developer swapped the toolbox's CI image for their own hardened tag on the main branch", async () => {
  await generatedProjectOnGitLab('conflict', prepareConflictTemplate())
  inProject(PIN)

  const root = await getRootHeaders()
  const commits = await listCommits(state.project, 'main', root)
  if (commits[0].title !== PIN_COMMIT) throw new Error(`Expected the main branch on "${PIN_COMMIT}", found "${commits[0].title}"`)
  expectLines(await getRepositoryFile(state.project, CI_FILE, 'main', root), [`${IMAGE}:1.0.0-hardened`], 'The main branch')
  expectLines(await getRepositoryFile(state.project, CI_FILE, commits[1].id, root), [`${IMAGE}:1.0.0`], 'The generated commit')
  const sha = commits[0].id
  // The page counts the commit's pipelines: it must exist before the shot.
  await until('No pipeline for the commit', () => api(`/pipelines?sha=${sha}`), list => list.length === 1)
  await gitlabFrame(I, 'pin-commit', gitlabUrl.commit(state.project, sha), {
    waitText: '1.0.0-hardened',
    textMasks: [[new RegExp(`${sha}|${sha.slice(0, 8)}`), '']],
    hide: ['.well-segment:has([data-testid="pipeline-path"])']
  })
})

// The command the developer types, from the main branch, and its whole output.
// The twins: the screen names the clashing file and the opened merge request,
// GitLab holds that merge request, and the main branch did not move.
storyboardStep(When, 'the developer runs the toolbox update and it warns that the release changes the same line', async () => {
  // 1430 px: 156 columns, the widest line on one row and the card within 1440.
  await openTerminal(I, state.container, { width: 1430 })
  const screen = await terminalCard(I, 'update-run', 'task devsecops:update', {
    timeoutMs: 300000,
    mask: [...COPIER_RUN_MASKS, [new RegExp(state.project, 'g'), 'project']]
  })
  for (const said of [CI_FILE, `Opened merge request ${UPDATE_BRANCH}`]) {
    if (!screen.includes(said)) throw new Error(`Expected the update to say "${said}":\n${screen}`)
  }
  const open = (await listProjectMergeRequests(state.project, await getRootHeaders(), '?state=opened')).data || []
  const mr = open.find(m => m.source_branch === UPDATE_BRANCH && m.target_branch === 'main')
  if (!mr || !mr.title.includes('1.0.1')) throw new Error(`Expected an open merge request ${UPDATE_BRANCH} -> main for 1.0.1, found ${JSON.stringify(open.map(m => m.title))}`)
  state.iid = mr.iid
  if (await mainTitle() !== PIN_COMMIT) throw new Error('The update moved the main branch')
})

// The Changes tab of that merge request. The twins: its .gitlab-ci.yml diff
// holds both image lines between copier's markers, and GitLab itself refuses
// that file as a pipeline definition.
storyboardStep(Then, 'GitLab now holds an update merge request showing both image lines as a conflict', async () => {
  const diff = await until('The merge request never showed the conflict', ciDiff, d => d.includes('+<<<<<<< before updating'))
  expectLines(diff, [
    '+<<<<<<< before updating',
    ` ${IMAGE}:1.0.0-hardened`,
    '+=======',
    `+${IMAGE}:1.0.1`,
    '+>>>>>>> after updating'
  ], 'The conflict diff')
  const lint = await lintProjectCi(state.project, await getRootHeaders(), UPDATE_BRANCH)
  if (!lint.data || lint.data.valid !== false) throw new Error(`Expected GitLab to refuse the conflicted ${CI_FILE}: ${JSON.stringify(lint.data)}`)
  // Both pipelines GitLab started for the branch and the merge request fail at once on that file.
  await changesCard('conflict-in-mr', '<<<<<<< before updating',
    list => JSON.stringify(list) === JSON.stringify(['push:failed', 'merge_request_event:failed']))
})

// The developer's fix, the card's # Copy run as is on the update branch. The
// twins: the clone is clean and pushed, the diff is one plain change with no
// marker, GitLab accepts the file again, and the main branch did not move.
storyboardStep(Then, 'once the developer fixes that line on the update branch, the merge request carries their hardened tag on the new release', async () => {
  inProject(FIX)
  if (inProject('git branch --show-current') !== UPDATE_BRANCH) throw new Error(`Expected the clone on ${UPDATE_BRANCH}`)
  if (inProject('git status --porcelain')) throw new Error('Expected a clean clone after the fix')
  if (inProject('git rev-parse HEAD') !== inProject(`git rev-parse origin/${UPDATE_BRANCH}`)) throw new Error('Expected the fix pushed')
  const diff = await until('The merge request never showed the fix', ciDiff, d => d.includes('1.0.1-hardened'))
  expectLines(diff, [`-${IMAGE}:1.0.0-hardened`, `+${IMAGE}:1.0.1-hardened`], 'The fixed diff')
  if (/^[+-]?(<{7}|={7}|>{7})/m.test(diff)) throw new Error(`Expected no conflict marker left:\n${diff}`)
  await until('The merge request never counted the fix', () => api(`/merge_requests/${state.iid}/commits`), c => c.length === 2)
  const lint = await lintProjectCi(state.project, await getRootHeaders(), UPDATE_BRANCH)
  if (!lint.data || lint.data.valid !== true) throw new Error(`Expected GitLab to accept the fixed ${CI_FILE}: ${JSON.stringify(lint.data)}`)
  if (await mainTitle() !== PIN_COMMIT) throw new Error('The fix moved the main branch')
  // The fixed file is valid again: one more merge-request pipeline.
  await changesCard('resolved-in-mr', '1.0.1-hardened',
    list => list.length === 3 && list[2].startsWith('merge_request_event:') && !list[2].endsWith(':failed'))
})

// ============================================
// @agents-move: the release that moves .agent/ to .agents/
// ============================================

const TEAM_RULE = '.agent/rules/our-team.md'
const EDITED_RULE = '.agent/rules/stability.md'
const MOVED_EDITED_RULE = '.agents/rules/stability.md'
const TEAM_LINE = 'Our CI images are built in project/ci, never in .config.'
const TEAM_COMMIT = 'docs: add our own rules for the AI agents'
// The line the developer types, exactly as the card's # Copy gives it.
const TEAM_EDIT = `printf '# Our team rule\\n\\nRun the e2e suite before every merge request.\\n' > ${TEAM_RULE} && echo '${TEAM_LINE}' >> ${EDITED_RULE} && git add -A && git commit -qm "${TEAM_COMMIT}" && git push -q`
const CONFLICT_WARNING = 'this release changed lines you had edited too'

// The names one folder of the update branch holds on GitLab, sorted.
async function updateBranchNames (dir = '') {
  const res = await listRepositoryTree(state.project, await getRootHeaders(), `?ref=${UPDATE_BRANCH}&per_page=100${dir ? `&path=${encodeURIComponent(dir)}` : ''}`)
  return (res.data || []).map(entry => entry.name).sort()
}

// Off camera: release 1.0.0 of the agents-move template, generated and pushed
// to the main branch of a project with CI switched off. Then the team's own
// commit, the card's # Copy run as is. On camera: GitLab's page for it.
storyboardStep(Given, 'the team added a rule of its own and a line to a toolbox rule in the old .agent folder, on the main branch', async () => {
  await generatedProjectOnGitLab('agents', prepareAgentsMoveTemplate(), { builds_access_level: 'disabled' })
  inProject(TEAM_EDIT)

  const root = await getRootHeaders()
  const commits = await listCommits(state.project, 'main', root)
  if (commits[0].title !== TEAM_COMMIT) throw new Error(`Expected the main branch on "${TEAM_COMMIT}", found "${commits[0].title}"`)
  const diff = await api(`/repository/commits/${commits[0].id}/diff`)
  const paths = diff.map(d => d.new_path).sort()
  if (JSON.stringify(paths) !== JSON.stringify([TEAM_RULE, EDITED_RULE].sort())) {
    throw new Error(`Expected the team's commit to change ${TEAM_RULE} and ${EDITED_RULE}, it changes ${JSON.stringify(paths)}`)
  }
  expectLines(diff.find(d => d.new_path === EDITED_RULE).diff, [`+${TEAM_LINE}`], 'The edit to the toolbox rule')
  // Release 1.0.0's layout: the old folder, its eight guides, no .agents.
  const tree = await listRepositoryTree(state.project, root, '?ref=main&per_page=100')
  const names = (tree.data || []).map(e => e.name)
  if (!names.includes('.agent') || names.includes('.agents') || names.includes('.claude')) {
    throw new Error(`Expected release 1.0.0's .agent folder alone on the main branch, found ${JSON.stringify(names)}`)
  }
  const guides = ((await listRepositoryTree(state.project, root, '?ref=main&path=.agent/workflows&per_page=100')).data || []).map(e => e.name).sort()
  if (JSON.stringify(guides) !== JSON.stringify(OLD_WORKFLOWS.map(n => `${n}.md`))) throw new Error(`Expected the eight guides in .agent/workflows, found ${JSON.stringify(guides)}`)
  await gitlabFrame(I, 'team-commit', gitlabUrl.commit(state.project, commits[0].id), {
    waitText: TEAM_LINE,
    height: 1000,
    textMasks: [[new RegExp(`${commits[0].id}|${commits[0].id.slice(0, 8)}`), '']]
  })
})

// The command the developer types, from the main branch, and its whole output.
// The twins: one conflict warning, for the team-edited rule only, and in the
// clone no other file holds a conflict marker; GitLab holds the merge request,
// and the main branch did not move.
storyboardStep(When, 'the developer runs the toolbox update to the release that moves the AI agent files to .agents', async () => {
  await openTerminal(I, state.container, { width: 1430, height: 1000 })
  const screen = await terminalCard(I, 'update-run', 'task devsecops:update', {
    timeoutMs: 300000,
    mask: [...COPIER_RUN_MASKS, [new RegExp(state.project, 'g'), 'project']]
  })
  const warnings = screen.split('\n').filter(line => line.includes(CONFLICT_WARNING))
  if (warnings.length !== 1 || !warnings[0].includes(`${MOVED_EDITED_RULE}:`)) {
    throw new Error(`Expected one conflict warning, for ${MOVED_EDITED_RULE} only, found:\n${warnings.join('\n')}`)
  }
  if (!screen.includes('migrate-agents.sh') || !screen.includes(`Opened merge request ${UPDATE_BRANCH}`)) {
    throw new Error(`Expected the update to run migrate-agents.sh and open its merge request:\n${screen}`)
  }
  const marked = inProject("git grep -l '^<<<<<<< before updating' || true")
  if (marked !== MOVED_EDITED_RULE) throw new Error(`Expected conflict markers in ${MOVED_EDITED_RULE} only, found:\n${marked}`)
  const open = (await listProjectMergeRequests(state.project, await getRootHeaders(), '?state=opened')).data || []
  const mr = open.find(m => m.source_branch === UPDATE_BRANCH && m.target_branch === 'main')
  if (!mr || !mr.title.includes('1.0.1')) throw new Error(`Expected an open merge request ${UPDATE_BRANCH} -> main for 1.0.1, found ${JSON.stringify(open.map(m => m.title))}`)
  state.iid = mr.iid
  if (await mainTitle() !== TEAM_COMMIT) throw new Error('The update moved the main branch')
})

// The repository page of the update branch, the Files panel open on .agents
// and its rules, in a second tab so the terminal keeps its session. The twins:
// the tree of the update branch on GitLab.
storyboardStep(Then, "GitLab shows the team's rule in .agents/rules on the update branch, and no .agent folder left", async () => {
  const root = await updateBranchNames()
  if (root.includes('.agent') || !root.includes('.agents') || !root.includes('.claude')) {
    throw new Error(`Expected .agents and .claude, and no .agent, at the root of ${UPDATE_BRANCH}, found ${JSON.stringify(root)}`)
  }
  const agents = await updateBranchNames('.agents')
  if (JSON.stringify(agents) !== JSON.stringify(['rules', 'skills'])) throw new Error(`Expected .agents to hold exactly rules and skills, found ${JSON.stringify(agents)}`)
  if (!(await updateBranchNames('.agents/rules')).includes('our-team.md')) throw new Error('Expected our-team.md in .agents/rules')
  const skills = await updateBranchNames('.agents/skills')
  const links = await updateBranchNames('.claude/skills')
  if (!OLD_WORKFLOWS.every(n => skills.includes(n)) || JSON.stringify(links) !== JSON.stringify(skills)) {
    throw new Error(`Expected the eight guides among the skills, each with its .claude link: skills ${JSON.stringify(skills)}, links ${JSON.stringify(links)}`)
  }
  await inNewTab(I, () => gitlabFrame(I, 'update-branch', gitlabUrl.tree(state.project, UPDATE_BRANCH), {
    waitText: 'chore(deps): update devsecops toolbox to 1.0.1',
    height: 1040,
    prepare: () => unfoldFileTree(I, ['.agents', 'rules'])
  }))
})

// The moved rule's page on the update branch, its conflict highlighted. The
// twins: the file holds the team's line between copier's markers, and of every
// change the merge request carries, only this one adds a marker.
storyboardStep(Then, "the team's line in that toolbox rule waits between conflict markers in the rule's new place", async () => {
  const lines = (await getRepositoryFile(state.project, MOVED_EDITED_RULE, UPDATE_BRANCH, await getRootHeaders())).split('\n')
  const start = lines.indexOf('<<<<<<< before updating')
  const end = lines.indexOf('>>>>>>> after updating')
  if (start < 0 || end < start || !lines.slice(start, end).includes(TEAM_LINE)) {
    throw new Error(`Expected the team's line between conflict markers in ${MOVED_EDITED_RULE}:\n${lines.join('\n')}`)
  }
  const changes = (await api(`/merge_requests/${state.iid}/changes`)).changes || []
  const marked = changes.filter(c => /^\+<{7} /m.test(c.diff)).map(c => c.new_path)
  if (JSON.stringify(marked) !== JSON.stringify([MOVED_EDITED_RULE])) throw new Error(`Expected only ${MOVED_EDITED_RULE} to bring conflict markers, found ${JSON.stringify(marked)}`)
  for (const rule of ['.agents/rules/tdd-cycle.md', '.agents/rules/tests-structure.md']) {
    const text = await getRepositoryFile(state.project, rule, UPDATE_BRANCH, await getRootHeaders())
    if (!text.includes(AGENTS_MOVE_RELEASE_LINE)) throw new Error(`Expected ${rule} to carry release 1.0.1's line on ${UPDATE_BRANCH}`)
  }
  await inNewTab(I, () => gitlabFrame(I, 'conflict-in-moved-rule', gitlabUrl.file(state.project, UPDATE_BRANCH, MOVED_EDITED_RULE, [start + 1, end + 1]), {
    waitText: '<<<<<<< before updating',
    height: 900,
    hide: ['.file-header-content small']
  }))
})
