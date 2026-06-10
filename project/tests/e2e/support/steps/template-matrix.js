/* global inject Given When Then Before After */
/**
 * Template-matrix + copier-update steps.
 *
 * Renders the WORKING-BRANCH template inside the codeceptjs container with
 * non-default Copier answers and asserts the generated files — the coverage
 * layer the visual journey (all-default answers) cannot provide. The
 * "configuration layout" pixel baselines show the real rendered tree
 * (`ls -1A` of the project root and .config) so a structural regression is
 * visible at a glance, in the same visual-first spirit as the journey.
 */
const { I } = inject()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const {
  renderProject,
  prepareVersionedTemplate,
  renderProjectFromTemplate,
  updateProject,
  removeRendered
} = require('../helpers/copierRender')
const { stripAnsiEscapeSequences } = require('../helpers/docker')
const { assertTextVisualMatch } = require('../helpers/textRender')

// Per-scenario state. Worker processes run scenarios sequentially, so
// module-level state is safe; the Before hook resets it for every scenario.
let rendered = null
let template = null
let cleanupDirs = []
let renovateResult = null

Before(() => {
  rendered = null
  template = null
  cleanupDirs = []
  renovateResult = null
})

After(() => {
  cleanupDirs.forEach(removeRendered)
  cleanupDirs = []
})

function renderedPath (relative) {
  if (!rendered) throw new Error('No rendered project in this scenario — missing the Given step?')
  return path.join(rendered, relative)
}

function readRendered (relative) {
  const file = renderedPath(relative)
  if (!fs.existsSync(file)) {
    throw new Error(`Rendered file "${relative}" does not exist in ${rendered}`)
  }
  return fs.readFileSync(file, 'utf8')
}

function parseAnswers (answersSpec) {
  const answers = {}
  answersSpec.split(/\s+/).filter(Boolean).forEach(token => {
    const eq = token.indexOf('=')
    if (eq < 0) throw new Error(`Invalid answer token "${token}" (expected key=value)`)
    answers[token.slice(0, eq)] = token.slice(eq + 1)
  })
  return answers
}

function toolboxPackageRule () {
  const config = JSON.parse(readRendered('.config/renovate/config.json'))
  const rule = (config.packageRules || []).find(r => JSON.stringify(r).includes('DevSecOps Toolbox'))
  if (!rule) {
    throw new Error('No packageRules entry matching "DevSecOps Toolbox" in the rendered renovate config')
  }
  return rule
}

// ============================================
// GIVEN — render the template
// ============================================

Given('a project rendered from the working-branch template with default answers', () => {
  rendered = renderProject()
  cleanupDirs.push(rendered)
})

Given('a project rendered from the working-branch template with answers {string}', (answersSpec) => {
  rendered = renderProject(parseAnswers(answersSpec))
  cleanupDirs.push(rendered)
})

Given('a versioned working-branch template with releases {string} and {string}', (v1, v2) => {
  if (v1 !== '1.0.0' || v2 !== '1.0.1') {
    throw new Error('The versioned template fixture publishes exactly releases 1.0.0 and 1.0.1')
  }
  template = prepareVersionedTemplate()
  cleanupDirs.push(template)
})

Given('a project generated from the template at release {string}', (vcsRef) => {
  rendered = renderProjectFromTemplate(template, vcsRef)
  cleanupDirs.push(rendered)
})

Given('the project file {string} is customized with the marker {string}', (relative, marker) => {
  fs.appendFileSync(renderedPath(relative), `\n${marker}\n`)
  execSync(`git add -A && git commit --quiet --no-verify -m "test: customize ${relative}"`, { cwd: rendered })
})

// ============================================
// WHEN — copier update
// ============================================

When('the project is updated to template release {string}', (vcsRef) => {
  updateProject(rendered, vcsRef)
})

When('the project is updated to template release {string} with answers {string}', (vcsRef, answersSpec) => {
  updateProject(rendered, vcsRef, parseAnswers(answersSpec))
})

// ============================================
// THEN — rendered tree assertions
// ============================================

Then('the rendered path {string} should exist', (relative) => {
  if (!fs.existsSync(renderedPath(relative))) {
    throw new Error(`Expected rendered path "${relative}" to exist in ${rendered}`)
  }
})

Then('the rendered path {string} should not exist', (relative) => {
  if (fs.existsSync(renderedPath(relative))) {
    throw new Error(`Expected rendered path "${relative}" to NOT exist in ${rendered}`)
  }
})

Then('the rendered file {string} should contain {string}', (relative, expected) => {
  const content = readRendered(relative)
  if (!content.includes(expected)) {
    throw new Error(`Expected rendered "${relative}" to contain "${expected}"`)
  }
})

Then('the rendered root Taskfile should reference {string}', (taskfileRef) => {
  const content = readRendered('Taskfile.yml')
  if (!content.includes(taskfileRef)) {
    throw new Error(`Expected the rendered root Taskfile to reference "${taskfileRef}"`)
  }
})

Then('the rendered root Taskfile should not reference {string}', (taskfileRef) => {
  const content = readRendered('Taskfile.yml')
  if (content.includes(taskfileRef)) {
    throw new Error(`Expected the rendered root Taskfile to NOT reference "${taskfileRef}"`)
  }
})

Then('the rendered CI variables should contain {string}', (expected) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (!content.includes(expected)) {
    throw new Error(`Expected rendered CI variables to contain "${expected}"`)
  }
})

Then('the rendered CI variables should not contain {string}', (unexpected) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (content.includes(unexpected)) {
    throw new Error(`Expected rendered CI variables to NOT contain "${unexpected}"`)
  }
})

Then('the rendered CI variables should set {string} to an empty value', (variableName) => {
  const content = readRendered('.config/gitlab/ci/variables.yml')
  if (!content.includes(`${variableName}: ""`)) {
    throw new Error(`Expected rendered CI variables to set ${variableName} to an empty value`)
  }
})

Then('the rendered renovate config should be valid JSON', () => {
  JSON.parse(readRendered('.config/renovate/config.json'))
})

Then('the rendered toolbox package rule should enable fast-forward automerge', () => {
  const rule = toolboxPackageRule()
  if (rule.automerge !== true || rule.automergeStrategy !== 'fast-forward') {
    throw new Error(`Expected toolbox package rule to enable fast-forward automerge, got: ${JSON.stringify(rule)}`)
  }
})

Then('the rendered toolbox package rule should not enable automerge', () => {
  const rule = toolboxPackageRule()
  if ('automerge' in rule || 'automergeStrategy' in rule || 'automergeType' in rule || 'platformAutomerge' in rule) {
    throw new Error(`Expected toolbox package rule to NOT carry automerge properties, got: ${JSON.stringify(rule)}`)
  }
})

// ============================================
// Renovate — the REAL validator on the rendered config
// ============================================

When('I run the renovate config validation in the rendered project', () => {
  // task renovate:validate → npx --yes -p renovate renovate-config-validator.
  // The first invocation downloads the renovate package into the runner's npx
  // cache (a couple of minutes cold); later invocations are cached.
  try {
    const output = execSync('task renovate:validate 2>&1', {
      cwd: rendered,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 600000
    })
    renovateResult = { exitCode: 0, output }
  } catch (error) {
    renovateResult = {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout || ''}${error.stderr || ''}`
    }
  }
})

Then('the renovate validation should succeed', () => {
  if (renovateResult.exitCode !== 0) {
    throw new Error(`Expected renovate validation to succeed, exit=${renovateResult.exitCode}\n${renovateResult.output}`)
  }
})

Then('the renovate validation output should contain {string}', (expected) => {
  if (!renovateResult.output.includes(expected)) {
    throw new Error(`Expected renovate validation output to contain "${expected}"\n${renovateResult.output}`)
  }
})

// Verdict = the validator's own progress/verdict lines, the stable contract;
// npm/npx download noise above them is volatile. The per-run render dir is
// masked in case the validator echoes absolute paths.
Then('the renovate validation verdict should visually match {string}', async (baselineName) => {
  const lines = stripAnsiEscapeSequences(renovateResult.output)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('Validating ') || line.includes('Config validated successfully'))
    .map(line => line.replace(/\/tmp\/e2e-render-[0-9a-f]+/g, '<render-dir>'))
  if (lines.length === 0) {
    throw new Error(`No validator verdict lines found in output:\n${renovateResult.output}`)
  }
  await assertTextVisualMatch(I, baselineName, lines.join('\n'))
})

// ============================================
// THEN — visual proof of the rendered layout
// ============================================

Then('the rendered configuration layout should visually match {string}', async (baselineName) => {
  const listing = execSync('echo "$ ls -1A"; ls -1A; echo; echo "$ ls -1A .config"; ls -1A .config', {
    cwd: rendered,
    encoding: 'utf8'
  })
  await assertTextVisualMatch(I, baselineName, listing.trimEnd(), { columns: 2 })
})
