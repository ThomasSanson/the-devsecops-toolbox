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
let bin
let validatorVersion
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

storyboardStep(Given, 'a project has an installed Renovate validator and an invalid configuration', async () => {
  project = renderProject()
  bin = path.join(project, 'runtime-bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\necho "Unexpected npx download" >&2\nexit 99\n', { mode: 0o755 })
  environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FORCE_COLOR: '1' }
  validatorVersion = execFileSync('renovate', ['--version'], { encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(project, '.config/renovate/config.json'), '{ "unknownOptionForTest": true }\n')
  const output = execFileSync('sh', ['-c', 'cat .config/renovate/config.json; cat runtime-bin/npx; command -v renovate-config-validator'],
    { cwd: project, encoding: 'utf8', env: environment })
  await renderPreFrame(I, 'runtime-setup', `$ cat .config/renovate/config.json runtime-bin/npx; command -v renovate-config-validator\n${stable(output)}`)
})

storyboardStep(When, 'the installed validator rejects the invalid Renovate option', async () => {
  const result = task(['renovate:validate'])
  const output = stripAnsiEscapeSequences(result.output)
  assert.notEqual(result.status, 0, 'The actual validator must reject invalid configuration')
  assert.ok(output.includes('Invalid configuration option: unknownOptionForTest'), result.output)
  assert.ok(!output.includes('Unexpected npx download'), 'An installed validator must run without npx')
  await renderPreFrame(I, 'runtime-invalid', `$ task renovate:validate\n${stable(result.output)}`, { colour: true })
})

storyboardStep(Then, 'correcting the configuration passes the same Renovate task', async () => {
  fs.writeFileSync(path.join(project, '.config/renovate/config.json'), '{}\n')
  const result = task(['renovate:validate'])
  assert.equal(result.status, 0, result.output)
  assert.ok(result.output.includes('Config validated successfully'), result.output)
  assert.ok(!result.output.includes('Unexpected npx download'))
  await renderPreFrame(I, 'runtime-valid', `$ cat .config/renovate/config.json\n{}\n$ task renovate:validate\n${stable(result.output)}`, { colour: true })
})

storyboardStep(Then, 'the Renovate download fallback uses the framework version for running and validating', async () => {
  // Give Go Task a real PATH with npx and node, but no globally installed
  // Renovate. --dry exposes its resolved fallback without a network download.
  for (const name of ['task', 'node', 'sh', 'cat', 'grep', 'sed']) {
    const executable = execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()
    fs.symlinkSync(executable, path.join(bin, name))
  }
  const env = { ...environment, PATH: bin }
  const run = task(['renovate:dry-run', '--dry'], env)
  const validate = task(['renovate:validate', '--dry'], env)
  assert.equal(run.status, 0, run.output)
  assert.equal(validate.status, 0, validate.output)
  for (const result of [run, validate]) assert.ok(result.output.includes(`renovate@${validatorVersion}`), result.output)
  await renderPreFrame(I, 'runtime-fallback', `$ task renovate:dry-run --dry\n${stable(run.output)}\n$ task renovate:validate --dry\n${stable(validate.output)}`, { colour: true })
})
