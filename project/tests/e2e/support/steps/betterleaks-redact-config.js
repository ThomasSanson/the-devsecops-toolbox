/* global inject Before After Given When Then */
const assert = require('assert/strict')
const { execFileSync, spawnSync } = require('child_process')
const { renderProject, removeRendered } = require('../helpers/copierRender')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

let project

Before(() => { project = null })
After(() => { if (project) removeRendered(project) })

async function checkScans (name, expected, override) {
  const env = { ...process.env }
  delete env.TASK_BETTERLEAKS_REDACT
  if (override === 'environment') env.TASK_BETTERLEAKS_REDACT = expected
  let frame
  for (const mode of ['docker', 'binary']) {
    for (const scan of ['scan-full', 'protect', 'scan-branch']) {
      const args = [`betterleaks:${scan}`, '--dry', '--verbose', `TASK_BETTERLEAKS_MODE=${mode}`]
      if (override === 'variable') args.push(`TASK_BETTERLEAKS_REDACT=${expected}`)
      const result = spawnSync('task', args, { cwd: project, env, encoding: 'utf8', timeout: 30000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${mode}/${scan}: dry run must finish`)
      const output = result.stdout + result.stderr
      const flags = [...output.matchAll(/--redact=(?:"([^"]*)"|([^\s]+))/g)]
      assert.equal(flags.length, 1, `${mode}/${scan}: one redaction argument`)
      assert.equal(flags[0][1] ?? flags[0][2], expected, `${mode}/${scan}: redaction must be ${expected}`)
      if (mode === 'binary' && scan === 'scan-full') {
        const prefix = override === 'environment' ? `TASK_BETTERLEAKS_REDACT=${expected} ` : ''
        // Root-task startup resolves unrelated tool versions before the scan.
        // Keep the scan's complete dry-run output, from its own start marker.
        const start = output.indexOf(`task: "betterleaks:${scan}" started`)
        assert.notEqual(start, -1, 'The scanner must appear in the dry run')
        frame = `$ ${prefix}task ${args.join(' ')}\n${output.slice(start)}`
      }
    }
  }
  await renderPreFrame(I, name, frame.trimEnd(), { height: 1600, colour: true })
}

storyboardStep(Given, 'a generated project exposes the Betterleaks redaction setting', async () => {
  project = renderProject()
  const output = execFileSync('grep', ['-E', 'TASK_BETTERLEAKS_REDACT|--redact', '.config/betterleaks/Taskfile.yml'], { cwd: project, encoding: 'utf8' })
  assert.equal((output.match(/--redact=/g) || []).length, 6)
  await renderPreFrame(I, 'redaction-setting', `$ grep -E 'TASK_BETTERLEAKS_REDACT|--redact' .config/betterleaks/Taskfile.yml\n${output.trimEnd()}`)
})
storyboardStep(Then, 'all six scans use 100 percent redaction by default', () => checkScans('redaction-default', '100'))
storyboardStep(When, 'redaction is set to 25 through the environment all six scans use 25', () => checkScans('redaction-environment', '25', 'environment'))
storyboardStep(Then, 'a task variable can set redaction to zero in all six scans', () => checkScans('redaction-zero', '0', 'variable'))
