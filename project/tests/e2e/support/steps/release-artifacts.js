/* global inject Given When Then Before After */
/**
 * Release-artifacts storyboard — the deliverables of a generated project's very
 * first `task release`. release-window already proves the push-window toggle on
 * the framework repo; this story proves what the release LEAVES BEHIND on a
 * freshly generated project (VERSION 0.1.0): it runs the release's own
 * version-bump step (`task commitizen:bump`, exactly what Taskfile.release.yml
 * calls) for real and asserts the artifacts — VERSION and the Helm chart bumped
 * to 0.2.0, a plain `0.2.0` tag (no v prefix, the cz.yaml `tag_format: $version`
 * contract) and a 0.2.0 changelog section. No GitLab is needed: every artifact
 * is a local git/file fact. ONE Gherkin sentence = ONE card = ONE pixel baseline
 * (tolerance: 0); every card twins its terminal frame with a git/file check.
 */
const { I } = inject()
const { execSync } = require('child_process')
const fs = require('fs')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame, assertContains, assertZeroExit } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const BUMP_CMD =
  'TASK_COMMITIZEN_BUMP_YES=true TASK_COMMITIZEN_BUMP_CHANGELOG=true task commitizen:bump'

// A minimal-but-valid Helm chart pinned to the project's starting version. It is
// what a project adopting Helm adds itself (copier lists iac/helm/Chart.yaml in
// _skip_if_exists and cz.yaml lists it in version_files), so the release must
// lift its `version` alongside VERSION. Only the `version` line carries 0.1.0,
// so the cz `iac/helm/Chart.yaml:version` rule touches exactly that line.
const CHART = [
  'apiVersion: v2',
  'name: e2e-release-artifacts',
  'description: A Helm chart used to prove the release bumps the chart version',
  'type: application',
  'version: 0.1.0',
  ''
].join('\n')

let project

function git (repo, cmd) {
  return execSync(`git -C ${repo} ${cmd}`, { encoding: 'utf8' }).trim()
}

// Render a vanilla project at 0.1.0, add the Helm chart, and commit an initial
// snapshot plus one eligible `feat:` — the change the first release versions.
function scaffoldReleasableProject () {
  const dir = renderProject()
  fs.mkdirSync(`${dir}/iac/helm`, { recursive: true })
  fs.writeFileSync(`${dir}/iac/helm/Chart.yaml`, CHART)
  git(dir, 'init --quiet --initial-branch=main')
  git(dir, 'config user.email "e2e@test.local"')
  git(dir, 'config user.name "E2E"')
  // Fresh init: no hooks to bypass; point hooksPath at a void so nothing the
  // rendered project might carry can interfere with the deterministic commits.
  git(dir, 'config core.hooksPath /dev/null')
  git(dir, 'add -A')
  git(dir, 'commit --quiet -m "chore: initial render"')
  git(dir, 'commit --quiet --allow-empty -m "feat: ship the first feature"')
  return dir
}

function chartVersion (repo, ref) {
  const file = ref ? git(repo, `show ${ref}:iac/helm/Chart.yaml`) : fs.readFileSync(`${repo}/iac/helm/Chart.yaml`, 'utf8')
  const line = file.split('\n').find(l => l.startsWith('version:')) || ''
  return line.replace('version:', '').trim()
}

Before(() => {
  project = null
})

After(() => {
  if (project) removeRendered(project)
  project = null
})

storyboardStep(Given, 'a freshly generated project sitting at version 0.1.0', async () => {
  project = scaffoldReleasableProject()
  const versionFile = fs.readFileSync(`${project}/VERSION`, 'utf8').trim()
  const chart = chartVersion(project)
  await renderPreFrame(
    I,
    'before-0-1-0',
    `$ cat VERSION\n${versionFile}\n\n$ grep version: iac/helm/Chart.yaml\nversion: ${chart}`
  )
  // Twin: the project really starts at 0.1.0 in both version-tracking files.
  if (versionFile !== '0.1.0') throw new Error(`Expected VERSION 0.1.0, got ${versionFile}`)
  if (chart !== '0.1.0') throw new Error(`Expected chart version 0.1.0, got ${chart}`)
})

storyboardStep(When, 'the first release bumps the version', async () => {
  let output
  let exitCode = 0
  try {
    output = execSync(BUMP_CMD, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`
    exitCode = error.status || 1
  }
  // The deterministic heart of the bump — no SHAs, no dates: the version move,
  // the tag it will cut and the increment it detected.
  const slice = output
    .split('\n')
    .filter(l => /^(build: bump version|tag to create:|increment detected:)/.test(l.trim()))
    .map(l => l.trim())
  await renderPreFrame(I, 'bump-to-0-2-0', `$ task commitizen:bump\n${slice.join('\n')}`)
  // Twin: the bump succeeded and moved the project 0.1.0 -> 0.2.0.
  assertZeroExit(exitCode, output)
  assertContains(output, '0.1.0 → 0.2.0')
})

storyboardStep(Then, 'VERSION and the Helm chart both carry the new 0.2.0', async () => {
  const versionFile = git(project, 'show HEAD:VERSION')
  const chart = chartVersion(project, 'HEAD')
  await renderPreFrame(
    I,
    'version-stamped',
    `$ git show HEAD:VERSION\n${versionFile}\n\n$ git show HEAD:iac/helm/Chart.yaml | grep version:\nversion: ${chart}`
  )
  // Twin: both version-tracking files now hold 0.2.0 at HEAD (the bump commit).
  if (versionFile !== '0.2.0') throw new Error(`Expected VERSION 0.2.0 at HEAD, got ${versionFile}`)
  if (chart !== '0.2.0') throw new Error(`Expected chart version 0.2.0 at HEAD, got ${chart}`)
})

storyboardStep(Then, 'it stamps a plain 0.2.0 tag and opens the changelog', async () => {
  const tags = git(project, 'tag --sort=-v:refname')
  const changelog = fs.readFileSync(`${project}/CHANGELOG.md`, 'utf8')
  // The changelog header date is the only volatile token — mask it so the card
  // stays pixel-stable while still proving the 0.2.0 section exists.
  const entry = (changelog.split('\n').find(l => l.includes('## 0.2.0')) || '')
    .replace(/\d{4}-\d{2}-\d{2}/, '<date>')
    .trim()
  await renderPreFrame(I, 'tag-and-changelog', `$ git tag\n${tags}\n\n$ grep '## 0.2.0' CHANGELOG.md\n${entry}`)
  // Twin: a plain X.Y.Z tag (no v prefix, cz tag_format: $version) exists and it
  // is 0.2.0, and the changelog really opened a 0.2.0 section.
  const semver = tags.split('\n').map(t => t.trim()).find(t => /^\d+\.\d+\.\d+$/.test(t))
  if (semver !== '0.2.0') throw new Error(`Expected a plain 0.2.0 tag (no v prefix), got: ${JSON.stringify(tags)}`)
  if (!changelog.includes('## 0.2.0')) throw new Error('Expected CHANGELOG.md to open a 0.2.0 section')
})
