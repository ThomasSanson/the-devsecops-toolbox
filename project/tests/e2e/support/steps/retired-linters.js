/* global inject Given When Then Before After */
// @retired-linters: a framework update cleans the retired MegaLinter linters
// out of a project's own settings, on a real GitLab project, through the
// developer's real command (`task devsecops:update`). GitLab opens the story
// (the settings on the main branch) and holds its proof (the merge request's
// Changes tab); the terminal in between shows the update stopped by a settings
// file linked outside the project, then by a settings file with a typo, then
// by a read-only one, then accepted on what GitLab holds, then asked again for
// nothing. Every card is twinned with a check of the same fact:
// MegaLinter's own configuration loader, the files in the container, REST.
const { I } = inject()
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { runCommand, shellEscape, execInContainerAsUser, removeContainer } = require('../helpers/docker')
const { freshGet } = require('../helpers/http')
const {
  BASE_URL,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  listProjectBranches,
  listProjectMergeRequests,
  getRepositoryFile
} = require('../helpers/gitlabApi')
const { PROJECT_DIR, setupManualUpdateTerminal, teardownJourneyTerminal } = require('../helpers/journeyContainer')
const { COPIER_RUN_MASKS } = require('../helpers/copierRender')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { gitlabUrl, gitlabFrame, inNewTab } = require('../helpers/gitlabCard')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const RETIRED = ['REPOSITORY_GITLEAKS', 'REPOSITORY_KICS', 'SQL_TSQLLINT']
const CONFIG = '.config/megalinter/config.yml'
const FLOW_CONFIG = '.config/megalinter/config.flow.yml'
const CUSTOM = [
  '---',
  '# Keep the project settings and this explanation.',
  'EXTENDS: .config/megalinter/config.base.yml',
  'DISABLE_LINTERS:',
  '  # Keep the supported exclusions.',
  '  - JSON_V8R',
  '  - REPOSITORY_GITLEAKS # Keep the reason for this project exclusion.',
  '  - SQL_TSQLLINT # Keep this project explanation.',
  '  - REPOSITORY_KICS',
  '  - YAML_V8R',
  'REPOSITORY_KICS_CONFIG_FILE: .config/kics/config.yml # Keep the configuration rationale.',
  'SQL_TSQLLINT_CONFIG_FILE: .config/tsqllint/config.json # Keep the legacy path explanation.',
  'FORMATTERS_DISABLE_ERRORS: false',
  'ERROR_ON_MISSING_EXEC_BIT: true',
  ''
].join('\n')
const FLOW = [
  '---',
  '# Keep the settings in flow notation.',
  'EXTENDS: .config/megalinter/config.base.yml',
  'DISABLE_LINTERS: [',
  '  JSON_V8R, # Keep this project explanation.',
  '  REPOSITORY_GITLEAKS,',
  '  YAML_V8R',
  ']',
  ''
].join('\n')
const COMMENTS = [
  '# Keep the project settings and this explanation.', '# Keep the supported exclusions.',
  '# Keep the reason for this project exclusion.', '# Keep this project explanation.',
  '# Keep the configuration rationale.', '# Keep the legacy path explanation.'
]
const SETTINGS_COMMIT = "chore: keep the project's own MegaLinter settings"
// The link sorts after both regular files, so a migration that wrote as it
// went would already have changed them when it reached the link.
const LINK = '.config/megalinter/shared.yml'
const OUTSIDE = '/workspace/shared/megalinter.yml'
const UPDATE_BRANCH = 'update-framework-devsecops'
const RELEASE = '1.0.1'
// What the test release itself changes, next to the clean-up: the version in
// the answers file, and the one file release 1.0.1 of the fixture template adds.
const RELEASE_FILES = ['.config/devsecops/.copier-answers.yml', '.config/jq/Taskfile.yml']
const REFUSAL = 'Refusing to migrate linked or external MegaLinter configuration: ' + LINK
const ANNOUNCEMENT = '[megalinter migration] removed retired references from '
// The link gives way to a regular file at the same place, still sorted after
// both regular files. Its list opens with a bracket that never closes.
const TYPO = [
  '---',
  "# The team's shared settings.",
  'DISABLE_LINTERS: [',
  '  REPOSITORY_GITLEAKS,',
  '  YAML_V8R',
  ''
].join('\n')
// Where the YAML parser locates the list it could not finish.
const TYPO_PLACE = `in "${LINK}", line 3, column 18`
// The same file with its bracket closed: valid, and naming a retired linter,
// so the clean-up has to write it after both regular files.
const SHARED = TYPO + ']\n'
const NO_WRITE = 'No write access to ' + LINK
// What every stopped clean-up says after its reason: nothing changed, and how
// to repair.
const STOPPED = '[megalinter migration] No settings file was changed. Fix the file named above, then ask for the update again.'
// The line the developer types in each terminal card (also its # Copy).
const REFUSED_RUN = `readlink ${LINK} && task devsecops:update; git status --short`
const TYPO_RUN = `cat ${LINK} && task devsecops:update; git status --short`
const READ_ONLY_RUN = "stat -c '%a %n' .config/megalinter/*.yml && task devsecops:update; git status --short"
const ACCEPTED_RUN = 'git reset -q --hard origin/main && git clean -fdq && task devsecops:update'
const REPEATED_RUN = 'task devsecops:update'

let story = {}
Before(() => { story = {} })
After(async () => {
  // Clear the state before any await: an overlapping next scenario owns its own.
  const { container, project, tokenId } = story
  story = {}
  teardownJourneyTerminal(container)
  if (!project && !tokenId) return
  const root = await getRootHeaders()
  if (project) await deleteProject(project, root).catch(() => {})
  if (tokenId) await revokePersonalAccessToken(tokenId, root).catch(() => {})
})

function inProject (script) {
  const res = execInContainerAsUser(story.container, 'bootstrap', `export PATH="$HOME/.local/bin:$PATH"\ncd ${PROJECT_DIR}\n${script}`, { timeout: 300000 })
  assert.equal(res.exitCode, 0, `\`${script}\` failed in the project:\n${res.output}`)
  return res.stdout
}

// Every settings file, and the file outside the project the link points to.
const megalinterFiles = () => inProject(`sha256sum .config/megalinter/*.yml ${OUTSIDE}`)

// Every path the working tree changed or added, a leftover temporary file
// included.
const workingTreeChanges = () => inProject('git status --porcelain --untracked-files=all | cut -c4-')
  .split('\n').filter(Boolean).sort()

// MegaLinter's own configuration loader, in the image of the version the
// project pins, reads the project as it stands in the terminal's container.
function megalinterSettings (config) {
  const version = JSON.parse(inProject('cat .config/megalinter/package.json')).dependencies['mega-linter-runner']
  const name = 'ml-retired-' + crypto.randomBytes(6).toString('hex')
  try {
    runCommand(`docker create --name ${name} --network none --workdir /tmp/my-project --env MEGALINTER_CONFIG=${shellEscape(config)} ` +
      `--entrypoint python ghcr.io/oxsecurity/megalinter:v${version} /tmp/probe.py`, { timeout: 900000 })
    runCommand(`docker cp ${shellEscape(path.join(__dirname, '../helpers/megalinterConfigProbe.py'))} ${name}:/tmp/probe.py`)
    runCommand(`docker cp ${story.container}:${PROJECT_DIR} - | docker cp - ${name}:/tmp`)
    const out = runCommand(`docker start --attach ${name}`, { timeout: 300000 })
    return JSON.parse(out.slice(out.indexOf('{')))
  } finally {
    removeContainer(name)
  }
}

async function remoteState () {
  const root = await getRootHeaders()
  const branches = (await listProjectBranches(story.project, root)).data || []
  const requests = (await listProjectMergeRequests(story.project, root, '?state=opened')).data || []
  return { branches: Object.fromEntries(branches.map(b => [b.name, b.commit.id])), requests }
}

// GitLab computes a merge request's diff after the push: wait for it, so the
// Changes tab is never photographed half-empty. Returns the changed paths.
async function mergeRequestPaths (iid, root) {
  const url = `${BASE_URL}/api/v4/projects/${encodedProjectPath(story.project)}/merge_requests/${iid}/diffs`
  const deadline = Date.now() + 120000
  let paths = []
  while (Date.now() < deadline) {
    paths = ((await freshGet(url, root)).data || []).map(d => d.new_path).sort()
    if (paths.length >= 4) return paths
    await I.wait(2)
  }
  return paths
}

// Fold files on a merge request's Changes tab with GitLab's own "Hide file
// contents" button, the way a reviewer folds what they are not reading.
async function foldDiffs (paths) {
  await I.executeScript((wanted) => Array.from(document.querySelectorAll('[data-testid="rd-diff-file"]'))
    .filter(file => wanted.includes(file.querySelector('.rd-diff-file-title').textContent.trim()))
    .forEach(file => file.querySelector('button[aria-label="Hide file contents"]').click()), paths)
  // waitForFunction hands its argument array over as ONE argument.
  await I.waitForFunction(([wanted]) => {
    const files = Array.from(document.querySelectorAll('[data-testid="rd-diff-file"]'))
      .filter(file => wanted.includes(file.querySelector('.rd-diff-file-title').textContent.trim()))
    return files.length === wanted.length &&
      files.every(file => !file.querySelector('[data-testid="rd-diff-file-body"]').checkVisibility())
  }, [paths], 30)
}

// Off camera: the lambda user's public project (no CI, so no pipeline ever
// repaints a card), a project generated at release 1.0.0 of a two-release
// template and pushed to it, glab logged in, then the project's own MegaLinter
// settings pushed as a second commit. The Copier and clean-up environments are
// warmed up too, so no download line ever reaches a card.
storyboardStep(Given, "the main branch on GitLab still names three retired linters in the project's MegaLinter settings", async () => {
  const root = await getRootHeaders()
  const name = 'e2e-retired-linters-' + crypto.randomBytes(4).toString('hex')
  const { token, id } = await createLambdaPersonalAccessToken('retired-linters-' + name, ['api', 'write_repository'], root)
  story.tokenId = id
  const created = await createProject(
    { name, visibility: 'public', initialize_with_readme: false, auto_devops_enabled: false, jobs_enabled: false },
    { 'PRIVATE-TOKEN': token }
  )
  assert.ok(created.status < 400, `Creating ${name}: ${created.status} ${JSON.stringify(created.data)}`)
  story.project = created.data.path
  story.container = setupManualUpdateTerminal(story.project, token)
  inProject([
    `printf '%s' ${shellEscape(CUSTOM)} > ${CONFIG}`,
    `printf '%s' ${shellEscape(FLOW)} > ${FLOW_CONFIG}`,
    `git add -A && git commit -q --no-verify -m ${shellEscape(SETTINGS_COMMIT)} && git push -q`,
    'uvx --python "$(cat .config/python/.python-version)" --from "$(cat .config/copier/requirements.txt)" copier --version',
    'uv run --quiet --no-project --with-requirements .config/copier/requirements.txt python -c pass'
  ].join('\n'))

  await gitlabFrame(I, 'gitlab-settings-before', gitlabUrl.file(story.project, 'main', CONFIG), {
    waitText: 'REPOSITORY_KICS_CONFIG_FILE',
    // Tall enough for the whole left sidebar: shorter, GitLab scrolls it.
    height: 760
  })

  assert.equal(await getRepositoryFile(story.project, CONFIG, 'main', root), CUSTOM)
  assert.equal(await getRepositoryFile(story.project, FLOW_CONFIG, 'main', root), FLOW)
  story.before = megalinterSettings(CONFIG)
  assert.deepEqual(story.before.removed_references, RETIRED, 'MegaLinter must see the three retired linters before the update')
  assert.deepEqual(story.before.supported_disabled_linters, ['JSON_V8R', 'YAML_V8R'])
  assert.equal(story.before.formatters_disable_errors, 'false')
  assert.equal(story.before.error_on_missing_exec_bit, 'true')
})

// Off camera, the developer has committed (not pushed) one more settings file,
// a link to a file outside the project. On camera: where it points, the update
// that refuses it, and what the stopped update left in the working tree. The
// twins: the refusal, no MegaLinter file and not the outside one changed, and
// nothing reached GitLab.
storyboardStep(Then, 'the framework update stops at a settings file linked outside the project, before it changes any MegaLinter setting', async () => {
  inProject([
    `mkdir -p ${path.dirname(OUTSIDE)} && cp ${CONFIG} ${OUTSIDE}`,
    `ln -s ${OUTSIDE} ${LINK}`,
    `git add -A && git commit -q --no-verify -m ${shellEscape("chore: use the team's shared MegaLinter settings")}`
  ].join('\n'))
  const before = megalinterFiles()
  const remoteBefore = await remoteState()

  await openTerminal(I, story.container, { width: 1440 })
  const screen = await terminalCard(I, 'update-refused-by-link', REFUSED_RUN, { mask: COPIER_RUN_MASKS })

  assert.ok(screen.includes(OUTSIDE), screen)
  assert.ok(screen.includes(REFUSAL), screen)
  assert.ok(screen.includes('task: Failed to run task "devsecops:update"'), screen)
  assert.ok(!screen.includes(ANNOUNCEMENT), screen)
  assert.equal(megalinterFiles(), before, 'A refused migration must change neither a MegaLinter file nor the linked one')
  const remoteAfter = await remoteState()
  assert.deepEqual(remoteAfter.branches, remoteBefore.branches, 'A refused update must push nothing')
  assert.deepEqual(remoteAfter.requests, [], 'A refused update must open no merge request')
})

// Off camera: what the stopped update wrote is undone, and the link gives way
// to a regular file with a typo, committed (not pushed). On camera: the file,
// the update that names it, and what the stopped update left. The twins: the
// file and line in the error, no MegaLinter file changed, only Copier's two
// files in the working tree, and nothing on GitLab.
storyboardStep(Then, 'the framework update stops at a settings file that is not valid YAML and names it, before it changes any MegaLinter setting', async () => {
  inProject([
    'git checkout -q -- . && git clean -fdq',
    `rm ${LINK} && printf '%s' ${shellEscape(TYPO)} > ${LINK}`,
    `git add -A && git commit -q --no-verify -m ${shellEscape("chore: keep the team's MegaLinter settings in the project")}`
  ].join('\n'))
  const before = megalinterFiles()
  const remoteBefore = await remoteState()

  const screen = await terminalCard(I, 'update-refused-by-typo', TYPO_RUN, { mask: COPIER_RUN_MASKS })

  assert.ok(screen.includes(TYPO_PLACE), 'The clean-up must name the file and the line of the typo:\n' + screen)
  assert.ok(screen.includes(STOPPED), screen)
  assert.ok(!screen.includes('Traceback'), 'A typo is explained, not reported as a crash:\n' + screen)
  assert.ok(screen.includes('task: Failed to run task "devsecops:update"'), screen)
  assert.ok(!screen.includes(ANNOUNCEMENT), screen)
  assert.equal(megalinterFiles(), before, 'A stopped migration must change no MegaLinter file')
  assert.deepEqual(workingTreeChanges(), RELEASE_FILES, 'Only the files Copier wrote may change')
  const remoteAfter = await remoteState()
  assert.deepEqual(remoteAfter.branches, remoteBefore.branches, 'A stopped update must push nothing')
  assert.deepEqual(remoteAfter.requests, [], 'A stopped update must open no merge request')
})

// Off camera: what the stopped update wrote is undone, the bracket is closed
// and committed, then the file is made read-only (git does not see that). On
// camera: the permissions, the update that names the file, and what the
// stopped update left. A clean-up that wrote as it went would already have
// changed config.flow.yml and config.yml when it reached shared.yml. The
// twins: no MegaLinter file changed, only Copier's two files in the working
// tree (no temporary file left), the message, and nothing on GitLab.
storyboardStep(Then, 'the framework update stops at a read-only settings file and names it, before it changes any MegaLinter setting', async () => {
  inProject([
    'git checkout -q -- . && git clean -fdq',
    `printf '%s' ${shellEscape(SHARED)} > ${LINK}`,
    `git commit -q --no-verify -am ${shellEscape("fix: close the list in the team's MegaLinter settings")}`,
    // The card prints every mode: set them, or the umask of the machine shows.
    'chmod 644 .config/megalinter/*.yml',
    `chmod a-w ${LINK}`
  ].join('\n'))
  const before = megalinterFiles()
  const remoteBefore = await remoteState()

  const screen = await terminalCard(I, 'update-refused-by-read-only', READ_ONLY_RUN, { mask: COPIER_RUN_MASKS })

  assert.equal(megalinterFiles(), before, 'A stopped migration must change no MegaLinter file:\n' + screen)
  assert.deepEqual(workingTreeChanges(), RELEASE_FILES, 'Only the files Copier wrote may change:\n' + screen)
  assert.ok(screen.includes(`444 ${LINK}`), screen)
  assert.ok(screen.includes(NO_WRITE + '\n' + STOPPED), 'The clean-up must name the read-only file:\n' + screen)
  assert.ok(!screen.includes('Traceback'), screen)
  assert.ok(screen.includes('task: Failed to run task "devsecops:update"'), screen)
  assert.ok(!screen.includes(ANNOUNCEMENT), screen)
  const remoteAfter = await remoteState()
  assert.deepEqual(remoteAfter.branches, remoteBefore.branches, 'A stopped update must push nothing')
  assert.deepEqual(remoteAfter.requests, [], 'A stopped update must open no merge request')
})

// The reset goes back to what GitLab holds (the commits with the link and with
// shared.yml, and the files the stopped update wrote go away), then the same
// update runs. The twins: one clean-up announcement per settings file, and the
// merge request on GitLab.
storyboardStep(When, 'the developer goes back to what GitLab holds and asks for the framework update again', async () => {
  const screen = await terminalCard(I, 'update-merge-request', ACCEPTED_RUN, {
    mask: [...COPIER_RUN_MASKS, [new RegExp(story.project, 'g'), 'project']]
  })
  for (const file of [FLOW_CONFIG, CONFIG]) {
    assert.equal(screen.split(ANNOUNCEMENT + file + '\n').length - 1, 1,
      'The migration must run once per settings file, after Copier has merged the project files:\n' + screen)
  }
  assert.ok(screen.includes(`Opened merge request ${UPDATE_BRANCH} → main.`), screen)
  const { requests } = await remoteState()
  assert.equal(requests.length, 1, JSON.stringify(requests))
  assert.equal(requests[0].source_branch, UPDATE_BRANCH)
  assert.equal(requests[0].target_branch, 'main')
  assert.ok(requests[0].title.includes(RELEASE), requests[0].title)
  story.mergeRequest = requests[0].iid
})

// The merge request's Changes tab, in a second tab so the terminal keeps its
// session. The twins: the four files the merge request changes, the settings
// on the update branch, and MegaLinter's loader, which now finds no retired
// linter and every other setting exactly as before.
storyboardStep(Then, 'the merge request removes only the retired linters and keeps every explanation and control', async () => {
  const root = await getRootHeaders()
  assert.deepEqual(await mergeRequestPaths(story.mergeRequest, root), [...RELEASE_FILES, FLOW_CONFIG, CONFIG].sort())

  await inNewTab(I, () => gitlabFrame(I, 'gitlab-merge-request-changes', gitlabUrl.mr(story.project, story.mergeRequest, 'diffs'), {
    waitText: 'Keep the legacy path explanation.',
    height: 960,
    prepare: () => foldDiffs(RELEASE_FILES)
  }))

  const config = await getRepositoryFile(story.project, CONFIG, UPDATE_BRANCH, root)
  COMMENTS.forEach(comment => assert.ok(config.includes(comment), 'The update must keep the comment: ' + comment))
  assert.ok(config.includes('FORMATTERS_DISABLE_ERRORS: false'))
  assert.ok(config.includes('ERROR_ON_MISSING_EXEC_BIT: true'))
  RETIRED.forEach(name => assert.ok(!config.includes(name), name))
  const flow = await getRepositoryFile(story.project, FLOW_CONFIG, UPDATE_BRANCH, root)
  assert.ok(flow.includes('JSON_V8R, # Keep this project explanation.'), 'The update must keep comments inside a compact YAML list')
  assert.ok(!flow.includes('REPOSITORY_GITLEAKS'), flow)

  const after = megalinterSettings(CONFIG)
  assert.deepEqual(after.removed_references, [], 'The update must remove the retired references')
  assert.deepEqual({ ...after, removed_references: [] }, { ...story.before, removed_references: [] })
  const flowAfter = megalinterSettings(FLOW_CONFIG)
  assert.deepEqual(flowAfter.removed_references, [])
  assert.deepEqual(flowAfter.supported_disabled_linters, ['JSON_V8R', 'YAML_V8R'])
})

// The same command once more, from the update branch. The twins: no clean-up
// announcement, the settings files byte for byte, and the update branch on
// GitLab where it was.
storyboardStep(Then, 'asking for the update a second time leaves nothing to change', async () => {
  const before = megalinterFiles()
  const remoteBefore = await remoteState()
  const screen = await terminalCard(I, 'update-repeated', REPEATED_RUN, { mask: COPIER_RUN_MASKS })
  assert.ok(screen.includes(`Keeping template version ${RELEASE}`), screen)
  assert.ok(!screen.includes(ANNOUNCEMENT), screen)
  assert.ok(screen.includes(`Nothing to commit on ${UPDATE_BRANCH}.`), screen)
  assert.equal(megalinterFiles(), before)
  assert.deepEqual((await remoteState()).branches, remoteBefore.branches, 'A second update must push nothing')
})
