/* global inject Then After */
/**
 * Storyboard for @publication-ci-version (features/03-evolution/version-pins.feature).
 *
 * The toolbox's full pipeline (.gitlab-ci.yml) and its publication update job
 * (.config/publication/gitlab-ci.yml) run on the toolbox image of the current
 * release, and the version bump moves both. Proven on GitLab: a throwaway copy
 * of the toolbox takes one fix commit, then the real `task commitizen:bump`,
 * and the card is the bump commit as GitLab shows it.
 */
const assert = require('assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { REPO, toolboxRepository } = require('../helpers/frameworkCopy')
const { publishToGitLab } = require('../helpers/gitlabProject')
const { gitlabFrame, gitlabUrl } = require('../helpers/gitlabCard')
const { BASE_URL, encodedProjectPath, getRepositoryFile } = require('../helpers/gitlabApi')
const { freshGet } = require('../helpers/http')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const CI_FILES = ['.gitlab-ci.yml', '.config/publication/gitlab-ci.yml']
const CZ_CONFIG = '.config/commitizen/cz.yaml'
const IMAGE_RE = /^(\s*image: registry\.gitlab\.com\/digital-commons\/devsecops\/the-devsecops-toolbox:)(\S+)$/m
// The copy starts at a fixture release, so the card never moves when the
// toolbox releases; commitizen bumps it like any other.
const FROM = '1.0.0'
const TO = '1.0.1'

let pub = null
let dir = null

After(async () => {
  if (pub) await pub.teardown()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  pub = null
  dir = null
})

function read (root, file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function git (...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
}

storyboardStep(Then, 'GitLab shows the version bump moving the full pipeline and the publication update job to the new toolbox image', async () => {
  // Twins on the real working tree: both image lines are on the current
  // release, and the bump keeps updating both files.
  const version = read(REPO, 'VERSION').trim()
  for (const file of CI_FILES) {
    const image = read(REPO, file).match(IMAGE_RE)
    assert.ok(image, `The toolbox image must be declared in ${file}`)
    assert.equal(image[2], version, `${file} must use the current toolbox release`)
    assert.ok(read(REPO, CZ_CONFIG).split('\n').some(line => line.trim() === `- ${file}`), `The version bump must keep updating ${file}`)
  }

  // Off camera: the copy at release 1.0.0 in its four version places, one fix
  // commit on main, then the version bump that task release runs, here without
  // the changelog.
  dir = toolboxRepository(fs.mkdtempSync('/tmp/e2e-toolbox-release-'))
  for (const file of ['VERSION', CZ_CONFIG, ...CI_FILES]) {
    const text = read(dir, file)
    assert.ok(text.includes(version), `${file} must hold the current release ${version}`)
    fs.writeFileSync(path.join(dir, file), text.replaceAll(version, FROM))
  }
  git('add', '-A')
  git('commit', '--quiet', '-m', `chore: the toolbox at release ${FROM}`)
  git('tag', FROM)
  git('commit', '--quiet', '--allow-empty', '-m', 'fix: a change worth a release')
  // A CI job's branch variables would turn the bump into a dev release.
  const env = { ...process.env }
  for (const name of ['CI_COMMIT_REF_NAME', 'GITHUB_REF_NAME', 'GIT_BRANCH']) delete env[name]
  execFileSync('task', ['commitizen:bump', 'TASK_COMMITIZEN_BUMP_YES=true', 'TASK_COMMITIZEN_BUMP_DRY_RUN=false'],
    { cwd: dir, env, encoding: 'utf8', stdio: 'pipe', timeout: 300000 })
  assert.equal(git('log', '-1', '--format=%s'), `build: bump version ${FROM} → ${TO}`)

  pub = await publishToGitLab(dir, { name: `e2e-toolbox-release-${crypto.randomBytes(4).toString('hex')}`, project: { jobs_enabled: false } })
  const sha = git('rev-parse', 'HEAD')
  // The parent, branch, tag and merge request box goes, so the four diffs fit.
  await gitlabFrame(I, 'framework-image-version', gitlabUrl.commit(pub.projectName, sha), {
    waitText: CI_FILES[1], height: 1100, hide: ['.info-well']
  })

  // Twins on GitLab: the bump commit changes exactly the four version places,
  // and both image lines on main name the new release.
  const diff = (await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(pub.projectName)}/repository/commits/${sha}/diff`, pub.headers)).data || []
  assert.deepEqual(diff.map(change => change.new_path).sort(), [...CI_FILES, CZ_CONFIG, 'VERSION'].sort())
  for (const file of CI_FILES) {
    const image = (await getRepositoryFile(pub.projectName, file, 'main', pub.headers)).match(IMAGE_RE)
    assert.ok(image && image[2] === TO, `${file} on GitLab must run on the ${TO} toolbox image`)
  }
})
