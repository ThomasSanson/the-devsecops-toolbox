/* global inject Then After */
/**
 * Storyboard for @renovate-runtime (features/03-evolution/renovate.feature).
 *
 * One terminal session in a freshly generated project, on a runner with no
 * Renovate installed: the real commands run in order, and their real output,
 * colours kept, is the card. The pinned validator refuses an unknown option,
 * then accepts the generated configuration once git puts it back.
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
const ENV = { ...process.env, FORCE_COLOR: '1', npm_config_loglevel: 'error', RENOVATE_X_IGNORE_RE2: 'true' }

function sh (dir, command) {
  try {
    return { status: 0, output: execFileSync('sh', ['-c', `${command} 2>&1`], { cwd: dir, env: ENV, encoding: 'utf8', timeout: 300000 }) }
  } catch (error) {
    return { status: error.status, output: `${error.stdout || ''}${error.stderr || ''}` }
  }
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
  const project = render()
  const version = fs.readFileSync(path.join(project, '.config/renovate/version'), 'utf8').trim()
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
  const text = session.map(({ command, output }) => `$ ${command}\n${output}`).join('').trimEnd()
    .replaceAll(project, '<project>').replaceAll(version, 'x.x.x')
  await sessionFrame('runtime-validate', text)

  // Twins: no Renovate on the runner, the pinned release through npx, the
  // refusal named, then the generated configuration accepted.
  assert.equal(installed.output.trim(), 'Renovate is not installed', 'The CodeceptJS runner must not include a global Renovate installation')
  assert.notEqual(refused.status, 0, 'The validator must reject the unknown option')
  assert.ok(stripAnsiEscapeSequences(refused.output).includes('Invalid configuration option: unknownOptionForTest'), refused.output)
  assert.equal(accepted.status, 0, accepted.output)
  assert.ok(accepted.output.includes('Config validated successfully'), accepted.output)
  for (const result of [refused, accepted]) assert.ok(result.output.includes(`npx --yes -p renovate@${version}`), result.output)
  // Twins: Renovate's run resolves the same pinned download, and the
  // configuration with automerge off is valid too.
  const run = sh(project, 'task renovate:dry-run --dry')
  assert.ok(run.status === 0 && run.output.includes(`renovate@${version}`), run.output)
  const automergeOff = sh(render({ devsecops_automerge: 'false' }), 'task renovate:validate')
  assert.ok(automergeOff.status === 0 && automergeOff.output.includes('Config validated successfully'), automergeOff.output)
})
