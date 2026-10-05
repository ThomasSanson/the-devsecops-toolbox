/* global inject Given When Then Before After */
/**
 * Copier-update CONFLICT storyboard — @toolbox-update-conflict.
 *
 * The counterpart to @toolbox-update: that story proves the update PRESERVES my
 * work; this one proves what happens when my own edit and a new release COLLIDE
 * on the same framework file. A project rendered from an older release has its
 * .gitlab-ci.yml toolbox image line hand-edited; the next release moves that very
 * line; `copier update` surfaces the clash instead of silently dropping either
 * change; the developer resolves it, keeping their intent on top of the release.
 *
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside its step
 * (tolerance: 0); every card twins its <pre> frame with a filesystem/git check.
 * Pure filesystem + git + copier inside the runner, no GitLab.
 */
const { I } = inject()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const {
  CI_FILE,
  CI_IMAGE_RE,
  prepareConflictTemplate,
  renderProjectFromTemplate,
  removeRendered
} = require('../helpers/copierRender')
const { runTask } = require('../helpers/taskProcess')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const IMAGE_BASE = 'registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox'

let rendered = null
let template = null
let cleanupDirs = []
let updateResult = null

Before(() => {
  rendered = null
  template = null
  cleanupDirs = []
  updateResult = null
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
})

function renderedPath (relative) {
  if (!rendered) throw new Error('No rendered project in this scenario — missing the Given step?')
  return path.join(rendered, relative)
}

function readCi () {
  return fs.readFileSync(renderedPath(CI_FILE), 'utf8')
}

function imageLineOf (content) {
  const match = content.match(CI_IMAGE_RE)
  if (!match) throw new Error(`No toolbox image line in ${CI_FILE}:\n${content}`)
  return match[0]
}

function git (cmd) {
  return execSync(`git ${cmd}`, { cwd: rendered, encoding: 'utf8', stdio: 'pipe' })
}

// A conflict may surface as inline markers in the file or as a .rej reject file,
// depending on copier's conflict mode. Detect both so the proof holds either way.
function conflictArtifact () {
  const content = readCi()
  const hasMarkers = /^<{7}/m.test(content) && /^>{7}/m.test(content)
  const rej = renderedPath(CI_FILE) + '.rej'
  const hasRej = fs.existsSync(rej)
  return { content, hasMarkers, hasRej, rej, rejContent: hasRej ? fs.readFileSync(rej, 'utf8') : '' }
}

// Show the conflicted region only: from the first "<<<<<<<" to the first
// ">>>>>>>" (inline case), else the .rej hunk. Volatile temp paths masked.
function conflictFrame (art) {
  const mask = text => text.replace(/\/tmp\/[A-Za-z0-9._-]+/g, '<tmp>').replace(/[0-9a-f]{7,40}/g, '<sha>')
  if (art.hasMarkers) {
    const lines = art.content.split('\n')
    const start = lines.findIndex(l => /^<{7}/.test(l))
    const end = lines.findIndex(l => /^>{7}/.test(l))
    return mask(lines.slice(start, end + 1).join('\n'))
  }
  return mask(`${CI_FILE}.rej\n${art.rejContent.trimEnd()}`)
}

// The resolution: strip any conflict markers, collapse the ours/theirs image
// lines into a single one carrying the developer's hardening on top of 1.0.1.
function resolveConflict () {
  let content = readCi()
    .split('\n')
    .filter(l => !/^(<{7}|={7}|>{7}|\|{7})/.test(l))
    .join('\n')
  content = content.replace(
    new RegExp(`(?:image: ${IMAGE_BASE.replace(/[.]/g, '\\.')}:[^\\n]*\\n){1,}`),
    `image: ${IMAGE_BASE}:1.0.1-hardened\n`
  )
  fs.writeFileSync(renderedPath(CI_FILE), content)
  const rej = renderedPath(CI_FILE) + '.rej'
  if (fs.existsSync(rej)) fs.rmSync(rej)
}

storyboardStep(Given, 'a project generated from an earlier toolbox release pins its CI image to that release', async () => {
  template = prepareConflictTemplate()
  cleanupDirs.push(template)
  rendered = renderProjectFromTemplate(template, '1.0.0')
  cleanupDirs.push(rendered)
  const line = imageLineOf(readCi())
  await renderPreFrame(I, 'ci-image-old', `$ grep '^image:' ${CI_FILE}\n${line}`)
  if (!line.endsWith(':1.0.0')) {
    throw new Error(`Expected the rendered CI image to be pinned to 1.0.0, got: ${line}`)
  }
})

storyboardStep(When, 'the developer hand-edits that framework file and commits the change', async () => {
  const edited = readCi().replace(CI_IMAGE_RE, `image: ${IMAGE_BASE}:1.0.0-hardened`)
  fs.writeFileSync(renderedPath(CI_FILE), edited)
  git('add -A')
  git('commit --quiet --no-verify -m "ci: pin our hardened image"')
  const line = imageLineOf(readCi())
  await renderPreFrame(I, 'ci-image-edited', `$ grep '^image:' ${CI_FILE}\n${line}`)
  if (!line.endsWith(':1.0.0-hardened')) {
    throw new Error(`Expected the developer's hand-edit to pin :1.0.0-hardened, got: ${line}`)
  }
})

storyboardStep(When, 'a newer release moves the same line and the developer runs the toolbox update', async () => {
  // A fresh runner must not record dependency setup that a warm runner omits.
  const warmup = path.join(rendered, 'tmp/copier-warmup.json')
  fs.mkdirSync(path.dirname(warmup), { recursive: true })
  fs.writeFileSync(warmup, JSON.stringify({
    version: '3',
    tasks: {
      warm: {
        dir: rendered,
        cmds: ['uv run --quiet --no-project --with-requirements .config/copier/requirements.txt python -c pass']
      }
    }
  }))
  const warmed = await runTask(rendered, ['--silent', '--taskfile', warmup, 'warm'])
  if (warmed.exitCode !== 0) throw new Error(warmed.raw)
  const options = '--defaults --skip-answered --skip-tasks --quiet --conflict=rej --vcs-ref 1.0.1'
  updateResult = await runTask(rendered, ['--silent', 'copier:update',
    'TASK_COPIER_PYTHON_VERSION=3.14', 'TASK_COPIER_CLI_OPTS=' + options])
  const output = updateResult.raw
    .replace(/\/tmp\/[A-Za-z0-9._-]+/g, '<tmp>')
    .replace(/[0-9a-f]{7,40}/g, '<sha>')
    .replace(/\n+$/, '')
  const command = 'task --silent copier:update TASK_COPIER_PYTHON_VERSION=3.14 ' +
    `TASK_COPIER_CLI_OPTS='${options}'`
  await renderPreFrame(I, 'update-runs', `$ ${command}\n${output}`, { colour: true })
})

storyboardStep(Then, 'the update keeps the new line and saves my change in a reject file', async () => {
  const art = conflictArtifact()
  if (!art.hasMarkers && !art.hasRej) {
    throw new Error(`Expected copier update to leave a conflict (markers or .rej) in ${CI_FILE}, found neither:\n${art.content}`)
  }
  await renderPreFrame(I, 'conflict-shown', conflictFrame(art))
})

storyboardStep(When, 'the developer resolves the conflict and keeps their pin on the new release', async () => {
  resolveConflict()
  const line = imageLineOf(readCi())
  if (/^<{7}/m.test(readCi()) || /^>{7}/m.test(readCi())) {
    throw new Error(`Expected all conflict markers to be gone after resolution:\n${readCi()}`)
  }
  await renderPreFrame(I, 'conflict-resolved', `$ grep '^image:' ${CI_FILE}\n${line}`)
  if (!line.endsWith(':1.0.1-hardened')) {
    throw new Error(`Expected the resolution to pin :1.0.1-hardened, got: ${line}`)
  }
})

storyboardStep(Then, "the tree is clean again and the developer's own intent is preserved", async () => {
  git('add -A')
  git('commit --quiet --no-verify -m "chore: apply toolbox update, keep hardened image"')
  const status = git('status --short').trimEnd()
  const line = imageLineOf(readCi())
  await renderPreFrame(I, 'tree-clean', `$ git status --short\n${status || '(clean)'}\n\n$ grep '^image:' ${CI_FILE}\n${line}`)
  if (status !== '') {
    throw new Error(`Expected a clean working tree after resolving, got:\n${status}`)
  }
  if (!line.endsWith(':1.0.1-hardened')) {
    throw new Error(`Expected the final image to carry the developer's hardening on 1.0.1, got: ${line}`)
  }
})
