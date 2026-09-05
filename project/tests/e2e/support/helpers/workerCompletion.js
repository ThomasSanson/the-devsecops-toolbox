#!/usr/bin/env node
/**
 * CodeceptJS can overwrite a worker's nonzero exit with a successful aggregate
 * result. Certify this launch from its selected Gherkin scenarios and fresh
 * per-worker JUnit reports, not from the aggregate exit code alone.
 *
 * This is the repository's run-workers/pool entrypoint. Other distribution
 * strategies and configuration overrides are refused explicitly: guessing at
 * their selection would make an incomplete run look complete.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { parseArgs } = require('util')
const { createRequire } = require('module')

const dependencies = path.resolve(__dirname, '../../../../../.config/codeceptjs/node_modules')
const engineRequire = createRequire(path.join(dependencies, 'codeceptjs/package.json'))
const { globSync } = engineRequire('glob')
const Mocha = engineRequire('mocha')
const { DOMParser } = engineRequire('@xmldom/xmldom')
const Config = require(path.join(dependencies, 'codeceptjs/lib/config.js')).default
const parseFeature = require(path.join(dependencies, 'codeceptjs/lib/mocha/gherkin.js')).default

function selectionOptions (args) {
  if (args[1] !== 'run-workers' || !/^[1-9][0-9]*$/.test(args[2] || '')) {
    throw new Error('Expected: workerCompletion.js <codeceptjs> run-workers <workers> --features --by pool --config <file>')
  }
  const { values } = parseArgs({
    args: args.slice(3),
    strict: true,
    allowPositionals: false,
    options: {
      config: { type: 'string', short: 'c' },
      grep: { type: 'string', short: 'g' },
      invert: { type: 'boolean', short: 'i' },
      features: { type: 'boolean' },
      by: { type: 'string' },
      debug: { type: 'boolean' },
      verbose: { type: 'boolean' },
      reporter: { type: 'string', short: 'R' },
      'reporter-options': { type: 'string', short: 'O' }
    }
  })
  if (!values.features || values.by !== 'pool' || !values.config) {
    throw new Error('Worker completion requires --features --by pool and an explicit --config file')
  }
  return values
}

async function selectedScenarios (options) {
  const configFile = path.resolve(options.config)
  if (!fs.statSync(configFile).isFile()) throw new Error('--config must name a file')
  const config = await Config.load(configFile)
  const root = path.dirname(configFile)
  const mochaOptions = { ...config.mocha }
  if (config.grep && !options.grep) mochaOptions.grep = config.grep
  const mocha = new Mocha({ ...mochaOptions, ...options })
  const pattern = mocha.options.grep || /.*/
  const files = [...new Set(globSync(config.gherkin.features, { cwd: root }))]
    .filter(file => !file.includes('node_modules/')).sort()
  const selected = new Map()
  for (const file of files) {
    const absolute = path.resolve(root, file)
    const suite = parseFeature(fs.readFileSync(absolute, 'utf8'), absolute)
    suite.eachTest(test => {
      const title = test.fullTitle()
      const match = pattern.test(title)
      if (mocha.options.invert ? match : !match) return
      if (selected.has(title)) throw new Error('Ambiguous duplicate scenario title: ' + title)
      selected.set(title, file)
    })
  }
  if (selected.size === 0) throw new Error('No Gherkin scenario matches this selection')
  return { selected, reports: path.join(root, '_output/junit') }
}

function readWorkerReports (directory) {
  const latest = new Map()
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []
  for (const worker of files) {
    if (!/^results-[0-9]+\.xml$/.test(worker)) throw new Error('Unexpected JUnit file: ' + worker)
    const xml = fs.readFileSync(path.join(directory, worker), 'utf8')
    const parser = new DOMParser({ onError: (level, message) => { throw new Error('Invalid JUnit: ' + message) } })
    const document = parser.parseFromString(xml, 'application/xml')
    if (document.documentElement.tagName !== 'testsuites') throw new Error('Invalid JUnit root in ' + worker)
    for (const testcase of Array.from(document.getElementsByTagName('testcase'))) {
      const title = testcase.getAttribute('name')
      const previous = latest.get(title)
      if (previous && previous.worker !== worker) throw new Error('Scenario reported by multiple workers: ' + title)
      // Retries in one worker are ordered in its report. Only the last attempt
      // certifies completion; a later failure or skip cannot reuse an earlier
      // pass. Never sum testcase counts to hide a missing scenario.
      const passed = !['failure', 'error', 'skipped'].some(tag => testcase.getElementsByTagName(tag).length)
      latest.set(title, { worker, passed })
    }
  }
  return latest
}

function certify (selected, latest, engineStatus) {
  const problems = []
  let passed = 0
  for (const title of [...selected.keys()].sort()) {
    const result = latest.get(title)
    if (!result) problems.push('missing: ' + title)
    else if (!result.passed) problems.push('not passed: ' + title)
    else passed++
  }
  for (const title of latest.keys()) {
    if (!selected.has(title)) problems.push('outside selection: ' + title)
  }
  if (engineStatus !== 0) problems.push('engine exit: ' + engineStatus)
  const accepted = problems.length === 0
  console.log(`Worker completion: ${accepted ? 'PASS' : 'FAIL'} (${passed}/${selected.size} selected scenarios)`)
  for (const problem of problems) console.log('  ' + problem)
  return accepted ? 0 : 1
}

async function main (args) {
  const options = selectionOptions(args)
  const { selected, reports } = await selectedScenarios(options)
  // The repository JUnit plugin writes this fixed directory. Clearing it
  // immediately before this launch excludes earlier attempts and stale worker
  // files even when a worker dies before producing any report this time.
  fs.rmSync(reports, { recursive: true, force: true })
  const engine = spawnSync(args[0], args.slice(1), { stdio: 'inherit' })
  if (engine.error) throw engine.error
  const status = engine.signal ? 'signal ' + engine.signal : engine.status
  return certify(selected, readWorkerReports(reports), status)
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => {
    console.error('Worker completion: FAIL\n  ' + error.message)
    process.exitCode = 1
  })
}

module.exports = { selectionOptions, selectedScenarios, readWorkerReports, certify }
