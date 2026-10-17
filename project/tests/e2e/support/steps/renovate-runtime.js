/* global inject Then After */
/**
 * Storyboard for @renovate-runtime (features/03-evolution/renovate.feature).
 *
 * One terminal session in a freshly generated project, on a runner with no
 * Renovate installed: the real commands run in order, and their real output,
 * colours kept, is the card. The pinned validator refuses an unknown option,
 * then accepts the generated configuration once git puts it back. An
 * unreachable registry is reported as a download problem, never as a verdict
 * on the configuration, and a damaged copy npx left in npm's cache never runs.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { ansiToHtml } = require('../helpers/textRender')
const { storyboardStep, addStoryboardFrame, captureElementFrame } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()
const rendered = []

After(() => {
  for (const dir of rendered.splice(0)) removeRendered(dir)
})

// RENOVATE_X_IGNORE_RE2: Renovate's optional RE2 engine is a native module
// npx fetches from GitHub. When that download fails, the validator prints a
// 40-line warning and validates the same way with JavaScript regexes: the card
// would change with the network, not with the toolbox.
// npm_config_update_notifier: npm announces its own newer release from an
// empty cache, so the card would change with npm's release day.
const ENV = { ...process.env, FORCE_COLOR: '1', npm_config_loglevel: 'error', npm_config_update_notifier: 'false', RENOVATE_X_IGNORE_RE2: 'true' }

// The project the first card renders: the next cards run in it too.
let project

function sh (dir, command, env = {}) {
  try {
    return { status: 0, output: execFileSync('sh', ['-c', `${command} 2>&1`], { cwd: dir, env: { ...ENV, ...env }, encoding: 'utf8', timeout: 300000 }) }
  } catch (error) {
    return { status: error.status, output: `${error.stdout || ''}${error.stderr || ''}` }
  }
}

function transcript (session) {
  return session.map(({ command, output }) => `$ ${command}\n${output}`).join('').trimEnd()
}

function pinnedVersion () {
  return fs.readFileSync(path.join(project, '.config/renovate/version'), 'utf8').trim()
}

function render (data) {
  const dir = renderProject(data)
  rendered.push(dir)
  return dir
}

// The session as one wide card, read at its real size: a full storyboard row.
async function sessionFrame (frameName, text) {
  I.resizeWindow(1440, 900)
  await I.usePlaywrightTo('render the terminal session', async ({ page }) => {
    await page.setContent(
      '<!DOCTYPE html><html><body style="background:#1e1e1e;margin:0">' +
      '<div id="session" style="display:inline-block;min-width:1040px;box-sizing:border-box;background:#1e1e1e;padding:16px 22px 16px 16px">' +
      '<pre style="margin:0;color:#d4d4d4;font-family:monospace;font-size:14px;line-height:1.4;white-space:pre">' +
      ansiToHtml(text) +
      '</pre></div></body></html>'
    )
  })
  await addStoryboardFrame(I, await captureElementFrame(I, frameName, '#session'))
  I.resizeWindow(1024, 768)
}

storyboardStep(Then, 'a project without Renovate installed gets the pinned validator, which refuses an unknown option and accepts the generated configuration', async () => {
  project = render()
  const version = pinnedVersion()
  // Off camera: the render becomes a repository, so git can put the generated
  // configuration back on camera.
  execFileSync('sh', ['-c', 'git init -q && git add -A && git -c user.email=e2e@test.local -c user.name=e2e commit -qm render'], { cwd: project })

  const session = [
    'command -v renovate || command -v renovate-config-validator || echo "Renovate is not installed"',
    'echo \'{ "unknownOptionForTest": true }\' > .config/renovate/config.json',
    'task renovate:validate',
    'git checkout -- .config/renovate/config.json',
    'task renovate:validate'
  ].map(command => ({ command, ...sh(project, command) }))
  const [installed, , refused, , accepted] = session
  // The pin moves with every Renovate release, the render path with every run.
  const text = transcript(session).replaceAll(project, '<project>').replaceAll(version, 'x.x.x')
  await sessionFrame('runtime-validate', text)

  // Twins: no Renovate on the runner, the pinned release, the refusal named,
  // then the generated configuration accepted.
  assert.equal(installed.output.trim(), 'Renovate is not installed', 'The CodeceptJS runner must not include a global Renovate installation')
  assert.notEqual(refused.status, 0, 'The validator must reject the unknown option')
  assert.ok(stripAnsiEscapeSequences(refused.output).includes('Invalid configuration option: unknownOptionForTest'), refused.output)
  assert.equal(accepted.status, 0, accepted.output)
  assert.ok(accepted.output.includes('Config validated successfully'), accepted.output)
  for (const result of [refused, accepted]) assert.ok(result.output.includes(`renovate@${version}`), result.output)
  // Twins: Renovate's run resolves the same pinned download, and the
  // configuration with automerge off is valid too.
  const run = sh(project, 'task renovate:dry-run --dry')
  assert.ok(run.status === 0 && run.output.includes(`renovate@${version}`), run.output)
  const automergeOff = sh(render({ devsecops_automerge: 'false' }), 'task renovate:validate')
  assert.ok(automergeOff.status === 0 && automergeOff.output.includes('Config validated successfully'), automergeOff.output)
})

storyboardStep(Then, 'when the npm registry cannot be reached, the task says the configuration was not checked, and the retry validates it once the registry answers', async () => {
  const version = pinnedVersion()
  const unreachable = 'npm_config_registry=http://registry.invalid/ npm_config_cache=$(mktemp -d) task renovate:validate' // DevSkim: ignore DS137138 -- A registry under .invalid, which never resolves, to prove a failed download.
  // Off camera, on the first run only: npm retries a failed download for
  // about a minute, and the card would only wait longer.
  const session = [
    { command: unreachable, ...sh(project, unreachable, { npm_config_fetch_retries: '0' }) },
    { command: 'task renovate:validate', ...sh(project, 'task renovate:validate') }
  ]
  const [failed, retry] = session
  const plain = stripAnsiEscapeSequences(failed.output)

  // Twins: the download problem named, with its own exit status, and no
  // verdict on the configuration; then the retry validates it.
  assert.notEqual(failed.status, 0, plain)
  assert.ok(plain.includes(`renovate@${version} could not be downloaded, so the configuration was NOT checked`), plain)
  assert.ok(plain.includes('exit status 2'), plain)
  for (const verdict of ['Invalid configuration', 'Found errors', 'Config validated']) assert.ok(!plain.includes(verdict), plain)
  assert.equal(retry.status, 0, retry.output)
  assert.ok(retry.output.includes('Config validated successfully'), retry.output)

  // npm names its log after the empty cache and the time of the run.
  const text = transcript(session).replace(/\/tmp\/tmp\.\w+\/_logs\/[\w.-]+\.log/g, '<npm-log>').replaceAll(version, 'x.x.x')
  await sessionFrame('runtime-registry-unreachable', text)
})

storyboardStep(Then, 'the task ignores a damaged copy that npx left in npm\'s cache and validates with a freshly checked copy', async () => {
  const version = pinnedVersion()
  // Off camera: a home folder of its own, so npm's cache and the damage stay
  // in this card.
  const home = fs.mkdtempSync('/tmp/e2e-renovate-home-')
  rendered.push(home)
  const npx = `npx --yes -p renovate@${version} renovate-config-validator --version`
  const damaged = '~/.npm/_npx/*/node_modules/renovate/dist/config-validator.js'
  const session = [
    npx,
    `truncate -s 200 ${damaged}`,
    `wc -c ${damaged}`,
    'task renovate:validate'
  ].map(command => ({ command, ...sh(project, command, { HOME: home }) }))
  const [copied, , size, validated] = session

  // Twins: npx unpacked the pinned release, the copy is still damaged after
  // the task and crashes when npx runs it, and the task validated anyway,
  // with the copy it installed and checked itself.
  assert.ok(copied.status === 0 && copied.output.trim() === version, copied.output)
  assert.match(size.output, /^200 \S+\/config-validator\.js\n$/, 'Exactly one copy of the validator must be damaged')
  assert.equal(fs.statSync(size.output.trim().split(' ')[1]).size, 200, 'The task must leave the damaged copy alone')
  const crash = sh(project, npx, { HOME: home })
  assert.notEqual(crash.status, 0, `npx must crash on the damaged copy:\n${crash.output}`)
  assert.equal(validated.status, 0, validated.output)
  assert.ok(validated.output.includes(`renovate@${version} installed fresh, checksums and version checked`), validated.output)
  assert.ok(validated.output.includes('Config validated successfully'), validated.output)

  // The pin moves with every Renovate release, and so does the folder npx
  // derives from it; the home folder moves with every run.
  const text = transcript(session).replaceAll(home, '~').replace(/_npx\/[0-9a-f]+\//g, '_npx/<hash>/').replaceAll(version, 'x.x.x')
  await sessionFrame('runtime-damaged-copy', text)
})
