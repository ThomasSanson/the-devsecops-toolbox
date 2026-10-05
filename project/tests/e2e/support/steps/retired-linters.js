/* global inject Given When Then Before After */
const { I } = inject()
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { prepareVersionedTemplate, renderProjectFromTemplate, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { runTask } = require('../helpers/taskProcess')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const IMAGE = 'ghcr.io/oxsecurity/megalinter:v10.1.0@sha256:b09486c423063200d6f203b63121e0967719eee03c234844f6f1dd658f00a31b'
const RETIRED = ['REPOSITORY_GITLEAKS', 'REPOSITORY_KICS', 'SQL_TSQLLINT']
const UPDATE = [
  '--silent', 'copier:update', 'TASK_COPIER_PYTHON_VERSION=3.14',
  'TASK_COPIER_CLI_OPTS=--defaults --skip-answered --skip-tasks --quiet --vcs-ref 1.0.1'
]
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
const FLOW_CONFIG = '.config/megalinter/config.flow.yml'
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

let template
let project
let before

Before(() => { template = null; project = null; before = null })
After(() => { if (project) removeRendered(project); if (template) removeRendered(template) })

async function task (commands, cleanup) {
  const file = path.join(project, 'tmp/retired-linters/task.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const cmds = cleanup ? [{ defer: cleanup }, ...commands] : commands
  fs.writeFileSync(file, JSON.stringify({ version: '3', tasks: { probe: { dir: project, cmds } } }))
  const result = await runTask(project, ['--silent', '--taskfile', file, 'probe'])
  assert.equal(result.exitCode, 0, result.raw)
  return result.raw
}

async function settings (config = '.config/megalinter/config.yml') {
  fs.copyFileSync(path.join(__dirname, '../helpers/megalinterConfigProbe.py'), path.join(project, 'tmp/retired-linters/probe.py'))
  const container = 'ml-retired-' + crypto.randomBytes(8).toString('hex')
  const raw = await task([
    'docker create --name ' + container + ' --network none --workdir /tmp/lint ' +
    '--env MEGALINTER_CONFIG=' + config + ' --entrypoint python ' + IMAGE +
    ' /tmp/lint/tmp/retired-linters/probe.py >/dev/null',
    'docker cp "' + project + '/." ' + container + ':/tmp/lint',
    'docker start --attach ' + container
  ], 'docker rm --force ' + container + ' >/dev/null')
  const start = raw.indexOf('{\n')
  assert.ok(start >= 0, raw)
  return { raw, value: JSON.parse(raw.slice(start)) }
}

storyboardStep(Given, 'a generated project keeps its own settings and references three retired linters', async () => {
  template = prepareVersionedTemplate()
  project = renderProjectFromTemplate(template, '1.0.0')
  fs.writeFileSync(path.join(project, '.config/megalinter/config.yml'), CUSTOM)
  await task(['git add -- .config/megalinter/config.yml', 'git commit --quiet -m "test: project linter settings"'])
  await renderPreFrame(I, 'project-linter-settings', await task(['cat .config/megalinter/config.yml']), { colour: true })
})

storyboardStep(When, 'MegaLinter reads the project settings before the framework update', async () => {
  before = await settings()
  assert.deepEqual(before.value.removed_references, RETIRED)
  assert.deepEqual(before.value.supported_disabled_linters, ['JSON_V8R', 'YAML_V8R'])
  assert.equal(before.value.formatters_disable_errors, 'false')
  assert.equal(before.value.error_on_missing_exec_bit, 'true')
  await renderPreFrame(I, 'retired-references-before', before.raw, { colour: true })
})

storyboardStep(Given, 'the project also keeps an explanation inside a compact YAML linter list', async () => {
  fs.writeFileSync(path.join(project, FLOW_CONFIG), FLOW)
  await task(['git add -- ' + FLOW_CONFIG, 'git commit --quiet -m "test: compact linter settings"'])
  await renderPreFrame(I, 'compact-project-settings', await task(['cat ' + FLOW_CONFIG]), { colour: true })
})

storyboardStep(When, 'the developer updates the framework through the real Copier task', async () => {
  // Warm the existing Copier environment before recording the update itself.
  await task(['uv run --no-project --python 3.14 --with-requirements .config/copier/requirements.txt python -c pass'])
  const result = await runTask(project, UPDATE)
  assert.equal(result.exitCode, 0, result.raw)
  for (const file of ['.config/megalinter/config.yml', FLOW_CONFIG]) {
    const announcement = '[megalinter migration] removed retired references from ' + file
    assert.equal(result.raw.split(announcement).length - 1, 1,
      'The migration must run once per configuration, after Copier has merged the project files')
  }
  const raw = result.raw.split(template).join('<template>').split(project).join('<project>')
  await renderPreFrame(I, 'copier-linter-update', raw, { colour: true })
})

storyboardStep(Then, 'MegaLinter reports no retired references and keeps the same supported controls', async () => {
  const after = await settings()
  assert.deepEqual(after.value.removed_references, [], 'Copier must remove the retired references')
  assert.deepEqual({ ...after.value, removed_references: [] }, { ...before.value, removed_references: [] })
  await renderPreFrame(I, 'supported-controls-after', after.raw, { colour: true })
})

storyboardStep(Then, 'the project settings and their explanations survive the migration', async () => {
  const raw = await task(['cat .config/megalinter/config.yml'])
  assert.ok(raw.includes('# Keep the project settings and this explanation.'))
  assert.ok(raw.includes('# Keep the supported exclusions.'))
  for (const comment of ['# Keep the reason for this project exclusion.',
    '# Keep this project explanation.', '# Keep the configuration rationale.',
    '# Keep the legacy path explanation.']) {
    assert.ok(raw.includes(comment), 'Copier must preserve inline project comments: ' + comment)
  }
  assert.ok(raw.includes('FORMATTERS_DISABLE_ERRORS: false'))
  assert.ok(raw.includes('ERROR_ON_MISSING_EXEC_BIT: true'))
  RETIRED.forEach(name => assert.ok(!raw.includes(name), name))
  await renderPreFrame(I, 'project-settings-preserved', raw, { colour: true })
})

storyboardStep(Then, 'the compact YAML list keeps its explanation and supported exclusions', async () => {
  const raw = await task(['cat ' + FLOW_CONFIG])
  assert.ok(raw.includes('# Keep this project explanation.'), 'Copier must preserve comments inside compact YAML lists')
  assert.ok(!raw.includes('REPOSITORY_GITLEAKS'))
  const after = await settings(FLOW_CONFIG)
  assert.deepEqual(after.value.removed_references, [])
  assert.deepEqual(after.value.supported_disabled_linters, ['JSON_V8R', 'YAML_V8R'])
  await renderPreFrame(I, 'compact-project-settings-preserved', raw, { colour: true })
})

storyboardStep(Then, 'repeating the Copier update leaves the migrated configuration unchanged', async () => {
  const directory = path.join(project, '.config/megalinter')
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.yml'))
  const saved = files.map(file => fs.readFileSync(path.join(directory, file), 'utf8'))
  await task(['git add -A', 'git commit --quiet -m "test: migrated framework"'])
  const result = await runTask(project, UPDATE)
  assert.equal(result.exitCode, 0, result.raw)
  assert.ok(!result.raw.includes('[megalinter migration]'), result.raw)
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(directory, file), 'utf8')), saved)
  await renderPreFrame(I, 'repeated-copier-update', result.raw, { colour: true })
})
