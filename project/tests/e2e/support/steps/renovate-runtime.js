/* global inject Given When Then After */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()
let project
let version
let environment

After(() => {
  if (project) removeRendered(project)
  project = null
})

function task (args, env = environment) {
  try {
    return { status: 0, output: execFileSync('sh', ['-c', 'task "$@" 2>&1', 'task', ...args], { cwd: project, env, encoding: 'utf8', stdio: 'pipe', timeout: 120000 }) }
  } catch (error) {
    return { status: error.status, output: `${error.stdout || ''}${error.stderr || ''}` }
  }
}

function stable (output) {
  return output.replaceAll(project, '<project>')
}

storyboardStep(Given, 'a project has an invalid configuration and no installed Renovate', async () => {
  project = renderProject()
  environment = { ...process.env, FORCE_COLOR: '1', npm_config_loglevel: 'error' }
  version = fs.readFileSync(path.join(project, '.config/renovate/version'), 'utf8').trim()
  const installed = execFileSync('sh', ['-c', 'command -v renovate || command -v renovate-config-validator || true'], { encoding: 'utf8' }).trim()
  assert.equal(installed, '', 'The CodeceptJS runner must not include a global Renovate installation')
  fs.writeFileSync(path.join(project, '.config/renovate/config.json'), '{ "unknownOptionForTest": true }\n')
  const output = execFileSync('sh', ['-c', 'cat .config/renovate/config.json .config/renovate/version; command -v npx'],
    { cwd: project, encoding: 'utf8', env: environment })
  await renderPreFrame(I, 'runtime-setup', `$ cat .config/renovate/config.json .config/renovate/version; command -v npx\n${stable(output)}`)
})

storyboardStep(When, 'the pinned Renovate download rejects the invalid option', async () => {
  const result = task(['renovate:validate'])
  const output = stripAnsiEscapeSequences(result.output)
  assert.notEqual(result.status, 0, 'The actual validator must reject invalid configuration')
  assert.ok(output.includes('Invalid configuration option: unknownOptionForTest'), result.output)
  assert.ok(output.includes(`renovate@${version}`), result.output)
  await renderPreFrame(I, 'runtime-invalid', `$ task renovate:validate\n${stable(result.output)}`, { colour: true })
})

storyboardStep(Then, 'correcting the configuration passes the same Renovate task', async () => {
  fs.writeFileSync(path.join(project, '.config/renovate/config.json'), '{}\n')
  const result = task(['renovate:validate'])
  assert.equal(result.status, 0, result.output)
  assert.ok(result.output.includes('Config validated successfully'), result.output)
  assert.ok(result.output.includes(`renovate@${version}`), result.output)
  await renderPreFrame(I, 'runtime-valid', `$ cat .config/renovate/config.json\n{}\n$ task renovate:validate\n${stable(result.output)}`, { colour: true })
})

storyboardStep(Then, 'the Renovate download fallback uses the framework version for running and validating', async () => {
  const run = task(['renovate:dry-run', '--dry'])
  const validate = task(['renovate:validate', '--dry'])
  assert.equal(run.status, 0, run.output)
  assert.equal(validate.status, 0, validate.output)
  for (const result of [run, validate]) assert.ok(result.output.includes(`renovate@${version}`), result.output)
  await renderPreFrame(I, 'runtime-fallback', `$ task renovate:dry-run --dry\n${stable(run.output)}\n$ task renovate:validate --dry\n${stable(validate.output)}`, { colour: true })
})
