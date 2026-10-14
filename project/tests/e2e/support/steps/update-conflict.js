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
  lintProjectCi
} = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const { PROJECT_DIR, setupManualUpdateTerminal, teardownJourneyTerminal } = require('../helpers/journeyContainer')
const { prepareConflictTemplate, removeRendered } = require('../helpers/copierRender')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { gitlabUrl, gitlabFrame } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const CI_FILE = '.gitlab-ci.yml'
const IMAGE = 'image: registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox'
const UPDATE_BRANCH = 'update-framework-devsecops'
const PIN_COMMIT = 'ci: pin our hardened image'
const FIX_COMMIT = 'ci: keep our hardened image on 1.0.1'
// The lines the developer types, exactly as the cards' # Copy gives them.
const PIN = `sed -i 's/:1.0.0$/:1.0.0-hardened/' ${CI_FILE} && git commit -qam "${PIN_COMMIT}" && git push -q`
const FIX = `sed -i '/^<<<<<<< /,/^>>>>>>> /c ${IMAGE}:1.0.1-hardened' ${CI_FILE} && git commit -qam "${FIX_COMMIT}" && git push -q`
// go-task echoes the pinned copier of the update; only its number moves.
const COPIER_PIN_MASK = [/copier==[0-9][\w.]*/g, 'copier==<version>']

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

// GitLab fills the merge request's Pipelines counter on its own time. No runner
// serves this project, so once created the list does not move: wait for it,
// then report it, so the card is shot on a settled page.
async function settledMrPipelines () {
  let previous = null
  return until('The merge request pipelines never settled', async () => {
    const list = (await api(`/merge_requests/${state.iid}/pipelines`)).map(p => `${p.source}:${p.status}`)
    const settled = previous !== null && JSON.stringify(previous) === JSON.stringify(list) && list.length > 0 &&
      !list.some(p => p.endsWith(':created'))
    previous = list
    return settled ? list : null
  }, Boolean)
}

async function changesCard (frameName, waitText) {
  const pipelines = await settledMrPipelines()
  console.log(`[update-conflict] ${frameName}: merge request pipelines ${JSON.stringify(pipelines)}`)
  await gitlabFrame(I, frameName, gitlabUrl.mr(state.project, state.iid, 'diffs'), { waitText, height: 1100 })
}

// Off camera: the test user, a public project (no shared runner: its pipelines
// wait instead of running the whole framework), release 1.0.0 rendered in the
// terminal container, pushed to the main branch, glab signed in. Then the
// developer's own commit, the card's # Copy run as is. On camera: GitLab's page
// for that commit, its pipeline row hidden (not this story).
storyboardStep(Given, "the developer swapped the toolbox's CI image for their own hardened tag on the main branch", async () => {
  await GitLabUserPage.ensureUserViaApi(BASE_URL, process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD, {
    email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
    username: process.env.TASK_GITLAB_LAMBDA_USER,
    name: 'Lambda User',
    password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
  })
  const root = await getRootHeaders()
  state.project = `e2e-conflict-${crypto.randomBytes(4).toString('hex')}`
  const { token, id } = await createLambdaPersonalAccessToken(`conflict-${state.project}`, ['api', 'write_repository'], root)
  state.tokenId = id
  const created = await createProject(
    { name: state.project, visibility: 'public', initialize_with_readme: false, auto_devops_enabled: false, shared_runners_enabled: false },
    { 'PRIVATE-TOKEN': token }
  )
  if (created.status >= 400) throw new Error(`Creating ${state.project}: HTTP ${created.status} ${JSON.stringify(created.data)}`)
  state.template = prepareConflictTemplate()
  state.container = setupManualUpdateTerminal(state.project, token, { template: state.template })
  inProject(PIN)

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
  await openTerminal(I, state.container, { width: 1440 })
  const screen = await terminalCard(I, 'update-run', 'task devsecops:update', {
    timeoutMs: 300000,
    mask: [COPIER_PIN_MASK, [new RegExp(state.project, 'g'), 'project']]
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
  await changesCard('conflict-in-mr', '<<<<<<< before updating')
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
  await changesCard('resolved-in-mr', '1.0.1-hardened')
})
