/* global inject Then */
/**
 * Framework-integrity VISUAL proof: the curl|sh installer's bootstrap version
 * pins must stay aligned with the canonical .config/<tool>/version files.
 *
 * install.sh runs standalone (before .config/ is fetched by Copier), so it has
 * to hardcode the versions it bootstraps. That duplication is deliberate but
 * dangerous if it drifts (copier already had: install.sh 9.13.1 vs framework
 * 9.14.3). Renovate is configured to bump both via the same datasource; this
 * pixel baseline (tolerance:0) is the legible safety net — the "aligned/DRIFT"
 * verdict is rendered per tool, so any divergence is a visible regression. An
 * aligned version is masked: it moves on every bump and proves nothing.
 *
 * Reads from /workspace — the working tree tarred into the codeceptjs container
 * by `task project:test:e2e` before the suite runs.
 */
const fs = require('fs')
const path = require('path')
const { assertTextVisualMatch } = require('../helpers/textRender')

const { I } = inject()
const REPO = '/workspace'

function readInstallPin (varName) {
  const sh = fs.readFileSync(path.join(REPO, '.config/devsecops/install.sh'), 'utf8')
  const match = sh.match(new RegExp(`^${varName}="([^"]+)"`, 'm'))
  if (!match) throw new Error(`Pin ${varName} not found in install.sh`)
  return match[1].replace(/^copier==/, '')
}

function readVersionFile (relative) {
  return fs.readFileSync(path.join(REPO, relative), 'utf8').trim()
}

function readCopierRequirement (relative) {
  const match = fs.readFileSync(path.join(REPO, relative), 'utf8').match(/copier==([0-9][0-9.]*)/)
  if (!match) throw new Error(`No "copier==<version>" requirement in ${relative}`)
  return match[1]
}

// tool | install.sh pin var | canonical framework source + reader
const PINS = [
  { tool: 'task', pinVar: 'TASK_VERSION', source: '.config/task/version', read: readVersionFile },
  { tool: 'copier', pinVar: 'COPIER_VERSION', source: '.config/copier/requirements.txt', read: readCopierRequirement },
  { tool: 'gum', pinVar: 'GUM_VERSION', source: '.config/gum/version', read: readVersionFile },
  { tool: 'glow', pinVar: 'GLOW_VERSION', source: '.config/glow/version', read: readVersionFile }
]

function buildPinReport () {
  const rows = PINS.map(({ tool, pinVar, source, read }) => {
    const pin = readInstallPin(pinVar)
    const canonical = read(source)
    const aligned = pin === canonical
    const status = aligned ? 'aligned' : `DRIFT ${pin} != ${canonical}`
    // What this picture proves is the STATUS column: the installer pins what the
    // framework pins. Printing the version itself proved nothing extra and cost
    // a regenerated baseline on every bump of task, copier, gum or glow — four
    // dependencies Renovate moves constantly, each one blocking its own merge
    // request on a picture. So an aligned pin is masked, and a drifted one is
    // spelled out twice over: in this column, and in the DRIFT verdict beside it.
    const shown = aligned ? '<version>' : pin
    return [tool.padEnd(8), shown.padEnd(10), source.padEnd(40), status].join(' ')
  })
  return [
    'install.sh bootstrap pins vs framework canonical versions',
    '',
    ['tool'.padEnd(8), 'pin'.padEnd(10), 'framework source'.padEnd(40), 'status'].join(' '),
    ...rows
  ].join('\n')
}

Then('the install.sh bootstrap pins should visually match {string}', async (baselineName) => {
  await assertTextVisualMatch(I, baselineName, buildPinReport())
})
