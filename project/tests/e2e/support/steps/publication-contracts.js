/* global inject Given When Then After */
/**
 * @publication-contracts: the publication's safety promises, typed into ONE
 * live terminal on throwaway repositories (support/helpers/publicationFixture.js),
 * GitLab's API played by a stand-in the test controls, and the release chapter
 * published to a real public project on the test GitLab.
 *
 * Each card types its commands one after the other, each on its own prompt,
 * and captures everything since the screen was cleared. Each is twinned with a
 * check of the same fact: the command's own output, the repositories in the
 * container, the requests the stand-in forge received, REST on GitLab.
 */
const assert = require('assert/strict')
const { storyboardStep, addStoryboardFrame } = require('../../../../../.config/codeceptjs/storyboard')
const { openTerminal, clearTerminal, captureTerminalFrame, terminalScreenText } = require('../terminal/capture')
const { gitlabFrame, gitlabUrl, inNewTab } = require('../helpers/gitlabCard')
const { listRepositoryTree, getRepositoryFile, listCommits, listProjectTags, createRepositoryTag } = require('../helpers/gitlabApi')
const { removeContainer } = require('../helpers/docker')
const {
  HOME,
  NOT_SIGNED_OFF,
  startFixtureForge,
  setupPublicationTerminal,
  writeContainerFile,
  inContainer,
  commitLabels,
  commitMasks,
  createPublicTarget,
  releaseEnv
} = require('../helpers/publicationFixture')
const { I } = inject()

const PROMPT_ROW = /^bootstrap@workspace:\S*\$ ?(.*)$/
const INIT_QUESTIONS = ['A token that may push to it', 'Refuse to publish when the secret scan cannot run?']
const FAILED = 'task: Failed to run task'
// Tall enough for the evidence on both GitLab cards, with no empty band below.
const PAGE_HEIGHT = 560

let ctx = null

const count = (text, part) => text.split(part).length - 1
const promptRows = screen => screen.split('\n').filter(row => PROMPT_ROW.test(row)).length

/**
 * Type one command and press Enter, answer each listed question with Enter the
 * way a developer accepts the defaults, and return as soon as the shell prints
 * a NEW bare prompt: bash prints it only once the command is done, so no fixed
 * pause is needed. A question counts when a new occurrence shows up, since an
 * earlier run of the same task may already show it.
 */
async function run (command, questions = [], timeoutMs = 180000) {
  const before = await terminalScreenText(I)
  await I.type(command, 0)
  await I.pressKey('Enter')
  const pending = [...questions]
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const screen = await terminalScreenText(I)
    const last = screen.split('\n').filter(Boolean).pop() || ''
    if (pending.length && count(screen, pending[0]) > count(before, pending[0])) {
      await I.pressKey('Enter')
      pending.shift()
      continue
    }
    if (promptRows(screen) > promptRows(before) && (last.match(PROMPT_ROW) || [])[1] === '') {
      if (pending.length) throw new Error(`"${command}" never asked "${pending[0]}":\n${screen}`)
      return
    }
    if (Date.now() > deadline) throw new Error(`"${command}" did not finish in ${timeoutMs} ms:\n${screen}`)
    await I.wait(0.2)
  }
}

// The screen, cut at each prompt: the output of every typed command, in order.
function commandOutputs (screen) {
  const outputs = []
  for (const row of screen.split('\n')) {
    const prompt = row.match(PROMPT_ROW)
    if (prompt) outputs.push({ command: prompt[1].trim(), output: '' })
    else if (outputs.length) outputs[outputs.length - 1].output += row + '\n'
  }
  // The last prompt, waiting for the next command, closes the last output.
  return outputs.filter(o => o.command)
}

/**
 * ONE card: reset the stand-in forge, clear the screen, type each line on its
 * own prompt (a line is a command, or { command, answers }), then capture the
 * whole session since the clear, commit ids replaced by their labels. Returns
 * the output of each typed command, unmasked, for the twins.
 */
async function card (frameName, lines) {
  ctx.forge.reset()
  await clearTerminal(I)
  const commands = lines.map(line => typeof line === 'string' ? { command: line, answers: [] } : line)
  for (const { command, answers } of commands) await run(command, answers)
  const screen = await terminalScreenText(I)
  const outputs = commandOutputs(screen)
  assert.deepEqual(outputs.map(o => o.command), commands.map(c => c.command),
    `The card shows other commands than the ones typed:\n${screen}`)
  // GitLab's public commits, oldest first; none while the project is empty.
  const publicCommits = ctx.target
    ? (await listCommits(ctx.target.projectName, 'main', ctx.target.headers).catch(() => [])).map(c => c.id).reverse()
    : []
  const mask = commitMasks(screen, commitLabels(ctx.container, publicCommits))
  await addStoryboardFrame(I, await captureTerminalFrame(I, frameName, { fromMarker: commands[0].command.slice(0, 40), mask }))
  return outputs.map(o => o.output)
}

const commitCount = repo => Number(inContainer(ctx.container, `git -C ${repo} rev-list --all --count`).trim())
const fileIn = file => inContainer(ctx.container, `cat ${file}`)
const requests = (method, fragment) => ctx.forge.requests.filter(r => r.method === method && r.url.includes(fragment))

storyboardStep(Given, 'a throwaway source repository whose files are approved for publication', async () => {
  ctx = { forge: await startFixtureForge() }
  ctx.container = setupPublicationTerminal()
  await openTerminal(I, ctx.container, { width: 1440, height: 1400 })
  const [files, lists] = await card('publication-contract-fixture', [
    'cd ~/source && git ls-files src .gitignore',
    'tail -n +1 .gitignore .config/publication/allowlist .config/publication/manifest .config/publication/owners .env'
  ])
  assert.equal(files, '.gitignore\nsrc/message.txt\n', 'The base repository does not track the file its ignore file matches')
  const tracked = inContainer(ctx.container, 'git -C source ls-files').split('\n')
  for (const path of ['.config/publication/denylist.base', 'Taskfile.yml']) {
    assert.ok(tracked.includes(path), `The base repository does not track ${path}`)
  }
  assert.match(lists, /==> \.gitignore <==\nsrc\/\*\.txt\n/, 'The ignore file no longer matches the approved source file')
  assert.match(lists, /==> \.config\/publication\/manifest <==\n\.gitignore\nsrc\/message\.txt\n/)
  assert.match(lists, /^TASK_PUBLICATION_TARGET_URL=\.\.\/source-public\.git$/m)
  assert.match(lists, /^TASK_PUBLICATION_API_URL=http:\/\/fixture-forge:8080\/api\/v4$/m)
  assert.equal(ctx.forge.requests.length, 0)
})

storyboardStep(Then, 'export copies the committed bytes, past a local smudge filter and into a folder whose name starts with a dash', async () => {
  const [setup, exported] = await card('publication-contract-export-bytes', [
    'cd ~/bytes && git ls-files -- -public src && cat .gitattributes && git config filter.private.smudge',
    'cat src/message.txt && task project:test:publication:export && tail -n +1 ../snapshot/*/message.txt'
  ])
  assert.match(setup, /^src\/message\.txt filter=private$/m)
  assert.match(exported, /^UNCOMMITTED CONTENT\n3\n/, `The smudge filter is not active, or the export failed:\n${exported}`)
  assert.equal(fileIn('snapshot/src/message.txt'), 'committed public source\n', 'An uncommitted smudge filter changed the published bytes')
  assert.equal(fileIn('snapshot/-public/message.txt'), 'source in a folder whose name starts with a dash\n',
    'A folder whose name starts with a dash lost its committed bytes')
})

storyboardStep(Then, 'the dry run names and refuses a symbolic link, an LFS pointer and a missing framework denylist', async () => {
  const [symlink, lfs, floor] = await card('publication-contract-unsupported-entries', [
    'cd ~/symlink && git show --format= --summary && task publication:check',
    'cd ~/lfs && git show HEAD:src/large.txt && task publication:check',
    'cd ~/no-floor && git show --format= --summary && task publication:check'
  ])
  assert.match(symlink, /create mode 120000 src\/host\n[\s\S]*Unsupported publication file: src\/host \(Git mode 120000\)/)
  assert.match(lfs, /^version https:\/\/git-lfs\.github\.com\/spec\/v1$[\s\S]*Unsupported publication file: src\/large\.txt \(Git LFS pointer\)/m)
  assert.match(floor, /delete mode 100644 \.config\/publication\/denylist\.base\n[\s\S]*Cannot read \.config\/publication\/denylist\.base/)
  for (const [name, output] of [['symlink', symlink], ['LFS pointer', lfs], ['missing denylist', floor]]) {
    assert.ok(output.includes(FAILED), `The dry run accepted the ${name}:\n${output}`)
  }
})

storyboardStep(Then, 'publication does nothing when it is switched off, or when CI starts it outside its manual or tag job', async () => {
  const [disabled, manual, tag, commits, calls] = await card('publication-contract-not-requested', [
    'cd ~/source && TASK_PUBLICATION_ENABLED=false task publication:publish',
    'CI=true TASK_PUBLICATION_ON=manual task publication:publish',
    'CI=true TASK_PUBLICATION_ON=tag task publication:publish',
    'git -C ../source-public.git rev-list --all --count',
    'curl -s fixture-forge:8080/fixture/requests | wc -l'
  ])
  assert.match(disabled, /Publication disabled \(TASK_PUBLICATION_ENABLED is not true\)\./)
  assert.match(manual, /Publication waits for a manual job/)
  assert.match(tag, /Publication waits for a tag pipeline/)
  assert.ok(![disabled, manual, tag].some(o => o.includes(FAILED)), 'A publication that was not requested failed instead of standing down')
  assert.equal(commits, '0\n')
  assert.equal(calls, '0\n')
  assert.equal(ctx.forge.requests.length, 0, 'A publication that was not requested contacted the forge')
  assert.equal(commitCount('source-public.git'), 0, 'A publication that was not requested reached the public repository')
})

storyboardStep(Then, 'the dry run never contacts the forge: it passes offline and refuses an absent ref instead of fetching it', async () => {
  const [check, absent, count] = await card('publication-contract-offline-check', [
    'cd ~/offline && git remote get-url origin && task publication:check',
    'TASK_PUBLICATION_SOURCE_REF=absent task publication:check',
    'curl -s fixture-forge:8080/fixture/requests | wc -l'
  ])
  assert.match(check, /^http:\/\/fixture-forge:8080\/team\/private\.git$/m)
  assert.match(check, /Publishing 2 files\n\s+\.gitignore\n\s+src\/message\.txt\n/)
  assert.ok(!check.includes(FAILED), `The offline dry run failed:\n${check}`)
  assert.match(absent, /No such ref: "absent"\./)
  assert.ok(absent.includes(FAILED), 'The dry run accepted an absent ref')
  assert.equal(count, '0\n')
  assert.equal(ctx.forge.requests.length, 0, 'The dry run contacted the forge, or fetched the absent ref')
})

storyboardStep(Then, 'publication refuses to skip the secret scan, and stops before the push when Git cannot read a file', async () => {
  const [done, early, late, counts] = await card('publication-contract-scan-required', [
    'cd ~/source && TASK_PUBLICATION_SCAN=done task publication:publish',
    'cd ~/export-fails && cat bin/git && PATH=$PWD/bin:$PATH task publication:publish; wc -l scan.log',
    'cd ~/index-fails && cat bin/git && PATH=$PWD/bin:$PATH task publication:publish; wc -l scan.log',
    'for r in ~/*-fails-public.git; do echo "$r: $(git -C $r rev-list --all --count) commits"; done'
  ])
  assert.match(done, /Invalid TASK_PUBLICATION_SCAN: use required or off\./)
  assert.ok(done.includes(FAILED), 'A caller-provided done flag bypassed the required scan')
  assert.equal(commitCount('source-public.git'), 0)
  assert.match(early, /Could not export every published file; the snapshot was not scanned\.[\s\S]*\n0 scan\.log\n/)
  assert.equal(fileIn('export-fails/scan.log'), '', 'The scanner ran after a failed read of a file')
  assert.match(late, /Cannot read the approved Git contents: \.gitignore\. Nothing was pushed\.[\s\S]*\n1 scan\.log\n/)
  assert.equal(fileIn('index-fails/scan.log'), 'scan passed\n', 'The fixture must reach a successful scan')
  assert.ok(early.includes(FAILED) && late.includes(FAILED), 'Publication accepted a failed read of a file')
  assert.equal(counts, `${HOME}/export-fails-public.git: 0 commits\n${HOME}/index-fails-public.git: 0 commits\n`)
  assert.equal(commitCount('export-fails-public.git') + commitCount('index-fails-public.git'), 0, 'A failed read reached a public repository')
})

storyboardStep(Then, 'only an owner\'s answer that names the current manifest and was not edited afterwards approves publication, and approval asks the owner again', async () => {
  const [hash, threads, publish, approve, log] = await card('publication-contract-approval-identity', [
    'cd ~/approval && git hash-object .config/publication/manifest',
    "jq '.[].notes[] | {body, resolved_by: .resolved_by.username, resolved_at, updated_at}' discussions.json",
    'task publication:publish',
    'task publication:approve',
    'curl -s fixture-forge:8080/fixture/requests'
  ])
  // The file on the card is what the stand-in forge answers for this project.
  assert.deepEqual(JSON.parse(fileIn('approval/discussions.json')), ctx.forge.discussions('team%2Fapproval'))
  assert.deepEqual(ctx.forge.discussions('team%2Fapproval'), NOT_SIGNED_OFF)
  assert.ok(threads.includes(`Publication-manifest: ${hash.trim()}`), 'The edited thread does not name the current manifest')
  assert.match(publish, /The approved list carries no owner signature\./)
  assert.ok(publish.includes(FAILED), 'An unrelated, stale or edited answer approved the publication')
  assert.equal(commitCount('approval-public.git'), 0)
  assert.match(approve, /Merge request !1 asks the owners to approve it: publication-owner/)
  assert.ok(!approve.includes(FAILED), `Approval could not ask again:\n${approve}`)
  assert.equal(requests('POST', '/merge_requests/1/discussions').length, 1, 'Approval did not ask the owner again')
  assert.match(log, /200 POST \/api\/v4\/projects\/team%2Fapproval\/merge_requests\/1\/discussions\n$/)
})

storyboardStep(Then, 'approval fails loudly when the forge refuses every request, or only the sign-off thread', async () => {
  const [added, everything, thread, log] = await card('publication-contract-approval-failures', [
    'cd ~/new-path && git show --format= --summary',
    "curl -s -d '* /api/v4' fixture-forge:8080/fixture/refuse && task publication:approve",
    "curl -s -d 'POST /discussions' fixture-forge:8080/fixture/refuse && task publication:approve",
    'curl -s fixture-forge:8080/fixture/requests'
  ])
  assert.match(added, /create mode 100644 src\/new\.txt/)
  for (const output of [everything, thread]) {
    assert.match(output, /The forge refused the approval request\. Nothing was approved\./)
    assert.ok(output.includes(FAILED), `Approval reported success although the forge refused it:\n${output}`)
  }
  const statuses = ctx.forge.requests.map(r => `${r.status} ${r.method}`)
  assert.equal(statuses.slice(0, 4).join(','), '403 GET,403 DELETE,403 GET,403 POST', 'The first run met a request the forge did not refuse')
  assert.equal(statuses[statuses.length - 1], '403 POST', 'The second run did not stop at the sign-off thread')
  assert.ok(ctx.forge.requests[ctx.forge.requests.length - 1].url.endsWith('/merge_requests/1/discussions'))
  assert.match(log, /^403 POST \/api\/v4\/projects\/team%2Fprivate\/merge_requests\/1\/discussions$/m)
})

storyboardStep(Then, 'neither token shows up, in process arguments or in the refusal of a target URL that carries one', async () => {
  const [publish, searched, check] = await card('publication-contract-credentials', [
    'cd ~/credentials && cat bin/git && PATH=$PWD/bin:$PATH task publication:publish',
    'grep -x -e clone -e push argv.log; grep -c -e fixture-target-token -e fixture-source-token argv.log',
    'TASK_PUBLICATION_TARGET_URL=https://fixture-url-token@example.invalid/public.git task publication:check'
  ])
  assert.match(publish, /Pushed main as \w+ to \.\.\/credentials-public\.git/)
  assert.ok(!publish.includes(FAILED), `The publication failed after it pushed:\n${publish}`)
  assert.equal(commitCount('credentials-public.git'), 1)
  assert.equal(searched, 'clone\npush\n0\n')
  const argv = fileIn('credentials/argv.log')
  assert.ok(argv.includes('push'), 'The argument recorders saw nothing')
  for (const token of ['fixture-target-token', 'fixture-source-token']) {
    assert.ok(!argv.includes(token), `${token} appeared in a process argument`)
  }
  assert.match(check, /The public repository URL must not contain credentials/)
  assert.ok(check.includes(FAILED), 'A target URL carrying a credential was accepted')
  assert.ok(!check.includes('fixture-url-token'), 'The refusal printed the token of the target URL')
})

storyboardStep(Then, 'setup keeps the working token and CI variables when the forge refuses their replacement', async () => {
  const [token, variables, log] = await card('publication-contract-setup-failures', [
    { command: "cd ~/setup && curl -s -d 'POST /access_tokens' fixture-forge:8080/fixture/refuse && task publication:init", answers: INIT_QUESTIONS },
    { command: "curl -s -d 'POST,PUT /variables' fixture-forge:8080/fixture/refuse && task publication:init", answers: INIT_QUESTIONS },
    'curl -s fixture-forge:8080/fixture/requests && cat .env.dist'
  ])
  assert.match(token, /Could not create the project access token TASK_RENOVATE_TOKEN\./)
  assert.ok(token.includes(FAILED) && variables.includes(FAILED), 'Setup accepted a refused replacement')
  assert.equal(requests('PUT', '/variables/').filter(r => r.status === 403).length, 1, 'The second run did not reach the variable update')
  assert.equal(requests('DELETE', '/access_tokens/42').length, 0, 'Setup revoked the working token before its replacement was stored')
  assert.equal(requests('DELETE', '/variables').length, 0, 'Setup deleted a working CI variable')
  assert.ok(!fileIn('setup/.env.dist').includes('TASK_PUBLICATION_ENABLED=true'), 'Incomplete setup switched publication on')
  assert.ok(!log.includes('DELETE'), 'The request log shows a deletion')
})

storyboardStep(Then, 'setup started from an onboarding branch turns on the discussion gate and schedules the main branch', async () => {
  const [init, log] = await card('publication-contract-setup-onboarding', [
    { command: 'cd ~/onboarding && git branch --show-current && task publication:init', answers: INIT_QUESTIONS },
    'curl -s fixture-forge:8080/fixture/requests'
  ])
  assert.match(init, /^onboarding\n/)
  assert.match(init, /GitLab requires all discussions to be resolved before merging\./)
  assert.match(init, /A nightly schedule runs it on main, at 0 4 \* \* \*\./)
  assert.ok(!init.includes(FAILED), `Setup failed:\n${init}`)
  assert.ok(requests('PUT', '/projects/team%2Fprivate').some(r => r.body.includes('only_allow_merge_if_all_discussions_are_resolved')),
    'Setup did not turn on the discussion merge gate')
  const schedule = requests('POST', '/pipeline_schedules')
  assert.equal(schedule.length, 1)
  assert.equal(JSON.parse(schedule[0].body).ref, 'main', 'Setup scheduled the onboarding branch instead of the default branch')
  assert.match(log, /DELETE \/api\/v4\/projects\/team%2Fprivate\/access_tokens\/42\n/)
})

storyboardStep(When, 'the first release is published to an empty public project on GitLab', async () => {
  ctx.target = await createPublicTarget()
  writeContainerFile(ctx.container, `${HOME}/release/.env`, releaseEnv(ctx.target))
  const [publish] = await card('publication-contract-first-release', [
    'cd ~/release && cat .gitignore && grep TARGET_URL .env && task publication:publish'
  ])
  assert.match(publish, /^src\/\*\.txt\n/)
  assert.ok(publish.includes('Pushed main as ') && publish.includes(`to ${ctx.target.url} (branch main)`), `The first release was not pushed:\n${publish}`)
  assert.ok(!publish.includes(FAILED), `The first release failed after it pushed:\n${publish}`)
  assert.ok(!publish.includes(ctx.target.token), 'The publication printed its token')
})

storyboardStep(Then, 'the public project holds every approved file, even one its ignore file matches', async () => {
  const { projectName, headers } = ctx.target
  const commits = await listCommits(projectName, 'main', headers)
  assert.equal(commits.length, 1)
  // The commit is named after the source commit: shown as the card labels it.
  assert.match(commits[0].title, /^publish [0-9a-f]{7,40}$/)
  await inNewTab(I, () => gitlabFrame(I, 'publication-contract-public-first', gitlabUrl.file(projectName, 'main', 'src/message.txt'), {
    waitText: 'committed public source',
    height: PAGE_HEIGHT,
    textMasks: [[/publish [0-9a-f]{7,40}/g, 'publish <source-commit-1>']]
  }))
  const tree = await listRepositoryTree(projectName, headers, '?ref=main&recursive=true&per_page=100')
  const files = tree.data.filter(entry => entry.type === 'blob').map(entry => entry.path).sort()
  assert.deepEqual(files, ['.gitignore', 'src/message.txt'], 'The public tree differs from the approved manifest')
  assert.equal(await getRepositoryFile(projectName, 'src/message.txt', 'main', headers), 'committed public source\n')
})

storyboardStep(When, 'a tag is added to that release later, then a new release with the same files is published twice', async () => {
  const [late, release, retry] = await card('publication-contract-later-releases', [
    'git tag 1.0.0 && task publication:publish',
    'git commit -q --allow-empty -m "chore: release 1.0.1" && git tag 1.0.1 && task publication:publish',
    'task publication:publish'
  ])
  assert.match(late, /The public repository is already up to date at 1\.0\.0\./)
  assert.match(release, /Pushed main as 1\.0\.1 to /)
  assert.match(retry, /The public repository is already up to date at 1\.0\.1\./)
  for (const output of [late, release, retry]) assert.ok(!output.includes(FAILED), `A release failed:\n${output}`)
})

storyboardStep(Then, 'the late tag sits on the commit already published, and the new release has its own commit and tag', async () => {
  const { projectName, headers } = ctx.target
  const commits = (await listCommits(projectName, 'main', headers)).reverse()
  assert.equal(commits.length, 2, 'A late tag or a retry created another public commit')
  const tags = Object.fromEntries((await listProjectTags(projectName, headers)).data.map(tag => [tag.name, tag.commit.id]))
  assert.deepEqual(Object.keys(tags).sort(), ['1.0.0', '1.0.1'])
  assert.equal(tags['1.0.0'], commits[0].id, 'The late tag did not land on the commit already published')
  assert.equal(tags['1.0.1'], commits[1].id)
  assert.equal(commits[1].title, 'publish 1.0.1')
  await inNewTab(I, () => gitlabFrame(I, 'publication-contract-public-tags', `${gitlabUrl.tags(projectName)}?sort=name_asc`, {
    waitText: '1.0.1',
    height: PAGE_HEIGHT,
    textMasks: [[/publish [0-9a-f]{7,40}/g, 'publish <source-commit-1>']]
  }))
})

storyboardStep(Then, 'a public tag that already names another commit stops the next release, and the main branch stays where it was', async () => {
  const { projectName, headers, url } = ctx.target
  const before = (await listCommits(projectName, 'main', headers))[0].id
  // Somebody tags the public project by hand, on its current commit.
  const tagged = await createRepositoryTag(projectName, '1.0.2', 'main', headers)
  assert.ok(tagged.status < 400, `Could not tag the public project: ${JSON.stringify(tagged.data)}`)
  const [listed, publish, after] = await card('publication-contract-tag-conflict', [
    `git ls-remote ${url}`,
    'echo "new wording" > src/message.txt && git commit -qam "fix: new wording" && git tag 1.0.2 && task publication:publish',
    `git ls-remote ${url} main 1.0.2`
  ])
  assert.match(listed, new RegExp(`^${before}\\s+refs/tags/1\\.0\\.2$`, 'm'))
  assert.match(publish, /The public tag 1\.0\.2 already identifies another commit\./)
  assert.ok(publish.includes(FAILED), 'A conflicting public tag was silently ignored')
  // xterm draws git's tab as spaces.
  assert.equal(after.replace(/\s+/g, ' ').trim(), `${before} refs/heads/main ${before} refs/tags/1.0.2`, 'The public main branch moved')
  const commits = await listCommits(projectName, 'main', headers)
  assert.equal(commits[0].id, before, 'The main branch moved despite the tag conflict')
  assert.equal(commits.length, 2)
})

After(async () => {
  if (!ctx) return
  const { forge, container, target } = ctx
  ctx = null
  if (container) removeContainer(container)
  if (target) await target.teardown()
  await forge.close()
})
