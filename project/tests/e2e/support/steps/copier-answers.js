/* global inject When Then After */
// cspell:ignore francais
/**
 * Storyboards of features/01-install/copier-answers.feature: Copier refuses an
 * answer the new project could not use, before it writes a single file, and
 * the CI file stays valid YAML whatever a Docker address holds.
 *
 * Every card is a real ttyd terminal opened in THIS container (see
 * helpers/localTerminal.js), where Copier renders the working-branch template
 * at /workspace. One line is typed on camera and the whole answer is the card.
 * ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside the
 * step (tolerance: 0), twinned with a check of the same fact: the screen text,
 * the folder on disk, the rendered files.
 */
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { createRequire } = require('module')
const { COPIER, TEMPLATE_SRC } = require('../helpers/copierRender')
const { openLocalTerminal } = require('../helpers/localTerminal')
const { terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

// The Gherkin parser of the test engine: the one that reads the `# language:`
// line of a feature file, in this suite as in a generated project.
const engineRequire = createRequire(path.resolve(__dirname, '../../../../../.config/codeceptjs/node_modules/codeceptjs/package.json'))
const { dialects } = engineRequire('@cucumber/gherkin')

// Fixed folders, not mkdtemp: each is the terminal's working directory and
// shows in its prompt. One per scenario, and one port each, so the two can run
// side by side on two workers.
const LANGUAGE_DIR = '/tmp/e2e-copier-language'
const DOCKER_DIR = '/tmp/e2e-copier-docker'

const RENDER = `${COPIER} copy --quiet --defaults --skip-tasks`
// The same pinned uvx line, run off camera: ['--python', '3.14', '--from', 'copier==<version>', 'copier'].
const [UVX, ...COPIER_ARGS] = COPIER.split(' ')
// The same line on the refused and the accepted card: what Copier said last,
// its exit code, then the folder and the language the agent rules name.
const languageLine = (answer) =>
  `${RENDER} --data gherkin_language=${answer} ${TEMPLATE_SRC} acme 2>&1 | tail -n 1; echo "exit code \${PIPESTATUS[0]}"; ls -d acme && grep -r "# language:" acme/.agents | sort`

const BAD_DOCKER_ANSWERS = ['gitlab_docker_host=docker:2376', 'gitlab_docker_tls_certdir=certs', 'gitlab_docker_driver=overlay']
const SELF_HOSTED = `${RENDER} --data ci_platform=gitlab_self_hosted`
// --overwrite: even allowed to replace files, a refused answer writes none.
const DOCKER_REFUSALS = `for answer in ${BAD_DOCKER_ANSWERS.join(' ')}; do echo "$answer"; ${RENDER} --overwrite --data ci_platform=gitlab_self_hosted --data "$answer" ${TEMPLATE_SRC} runner 2>&1 | tail -n 1; done; ls -d runner`
const SPACED_HOST = 'tcp://docker: 2376'
const VARIABLES = '.config/gitlab/ci/variables.yml'
const SPACED_HOST_LINT = `${SELF_HOSTED} --data "gitlab_docker_host=${SPACED_HOST}" ${TEMPLATE_SRC} runner && grep "^ *DOCKER_HOST:" runner/${VARIABLES} && task -d runner yamllint TASK_YAMLLINT_PATH_TO_LINT=${VARIABLES}`
// go-task echoes the yamllint command with the Python and yamllint versions
// the project pins, both moved by Renovate.
const YAMLLINT_MASK = [[/--python [0-9.]+ --from yamllint==[0-9.]+/g, '--python <version> --from yamllint==<version>']]

const owns = (test, tag) => Boolean(test && test.tags && test.tags.includes(tag))
const terminals = {}

// The suite's own switches must not reach the terminal's shell.
function shellEnv () {
  const env = { ...process.env }
  for (const name of ['TASK_E2E_UPDATE_BASELINES', 'TASK_CODECEPTJS_GREP', 'TASK_CODECEPTJS_FEATURES', 'CI']) delete env[name]
  return env
}

async function openStoryTerminal (dir, port) {
  // Off camera: Copier's environment unpacked once, so uv's first-run line
  // never shows on a card.
  execFileSync(UVX, [...COPIER_ARGS, '--version'], { stdio: 'pipe', timeout: 300000 })
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  terminals[dir] = await openLocalTerminal(I, { cwd: dir, env: shellEnv(), port, height: 600 })
}

function closeStoryTerminal (dir) {
  if (terminals[dir]) terminals[dir]()
  delete terminals[dir]
  fs.rmSync(dir, { recursive: true, force: true })
}

After((test) => {
  if (owns(test, '@copier-gherkin-language')) closeStoryTerminal(LANGUAGE_DIR)
  if (owns(test, '@copier-docker-answers')) closeStoryTerminal(DOCKER_DIR)
})

function expectOnScreen (screen, said, card) {
  for (const text of said) assert.ok(screen.includes(text), `Expected the ${card} card to show ${JSON.stringify(text)}:\n${screen}`)
}

// The codes the gherkin_language validator accepts, read from copier.yml.
function acceptedLanguages () {
  const list = fs.readFileSync(path.join(TEMPLATE_SRC, 'copier.yml'), 'utf8').match(/gherkin_language not in \[([^\]]*)\]/)
  assert.ok(list, 'copier.yml must give gherkin_language a validator listing the codes it accepts')
  return [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).sort()
}

// Copier's own pinned Python environment carries PyYAML: no extra dependency.
function loadYaml (file) {
  return JSON.parse(execFileSync(UVX, [...COPIER_ARGS.slice(0, -1),
    'python', '-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
  { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))
}

// ---------------------------------------------------------------------------
// @copier-gherkin-language
// ---------------------------------------------------------------------------

storyboardStep(When, 'a developer answers francais for the Gherkin language, and Copier refuses before it writes a single file', async () => {
  await openStoryTerminal(LANGUAGE_DIR, 7695)
  const screen = await terminalCard(I, 'gherkin-language-refused', languageLine('francais'))
  expectOnScreen(screen, [
    "Validation error for question 'gherkin_language'",
    '"francais" is not a language Gherkin knows.',
    'exit code 1',
    "ls: cannot access 'acme'"
  ], 'refused language')
  assert.equal(fs.existsSync(path.join(LANGUAGE_DIR, 'acme')), false, 'A refused answer must leave no folder behind')
  // Copier accepts exactly the languages the Gherkin parser knows: no phantom
  // code, and none of the parser's left out.
  assert.deepEqual(acceptedLanguages(), Object.keys(dialects).sort())
})

storyboardStep(Then, 'the same line with fr writes the project, and its agent rules ask for Gherkin in fr', async () => {
  const screen = await terminalCard(I, 'gherkin-language-accepted', languageLine('fr'))
  expectOnScreen(screen, ['exit code 0', 'acme/.agents/skills/development-cycle/SKILL.md', 'acme/.agents/skills/tdd-step1-red/SKILL.md'], 'accepted language')
  assert.equal(screen.split('`# language: fr`').length - 1, 2, `Both agent rules must ask for "# language: fr":\n${screen}`)
  const answers = fs.readFileSync(path.join(LANGUAGE_DIR, 'acme/.config/devsecops/.copier-answers.yml'), 'utf8')
  assert.match(answers, /^gherkin_language: fr$/m)
})

// ---------------------------------------------------------------------------
// @copier-docker-answers
// ---------------------------------------------------------------------------

storyboardStep(When, 'a project on its own runners gets a Docker address without tcp://, a relative certificate folder and an unknown storage driver, and Copier refuses each one', async () => {
  await openStoryTerminal(DOCKER_DIR, 7696)
  const screen = await terminalCard(I, 'docker-answers-refused', DOCKER_REFUSALS)
  const refusals = [
    "Validation error for question 'gitlab_docker_host'",
    "Validation error for question 'gitlab_docker_tls_certdir'",
    'ValueError: Invalid choice'
  ]
  expectOnScreen(screen, [...refusals, "ls: cannot access 'runner'"], 'refused Docker answers')
  // Each refusal sits under its own answer.
  const rows = screen.split('\n')
  BAD_DOCKER_ANSWERS.forEach((answer, i) => {
    const at = rows.findIndex(row => row.trim() === answer)
    assert.ok(at !== -1 && (rows[at + 1] || '').includes(refusals[i]), `Expected "${refusals[i]}" right under ${answer}:\n${screen}`)
  })
  assert.equal(fs.existsSync(path.join(DOCKER_DIR, 'runner')), false, 'Refused answers must leave no folder behind')
})

storyboardStep(Then, 'an address with a space after its colon still gives a CI file that yamllint accepts', async () => {
  // Off camera: yamllint fetched once, so uv's first-run line never shows.
  const python = fs.readFileSync(path.join(TEMPLATE_SRC, '.config/python/.python-version'), 'utf8').trim()
  const yamllint = fs.readFileSync(path.join(TEMPLATE_SRC, '.config/yamllint/requirements.txt'), 'utf8').trim()
  execFileSync('uvx', ['--python', python, '--from', yamllint, 'yamllint', '--version'], { stdio: 'pipe', timeout: 300000 })

  const screen = await terminalCard(I, 'docker-host-quoted', SPACED_HOST_LINT, { mask: YAMLLINT_MASK })
  expectOnScreen(screen, [`DOCKER_HOST: "${SPACED_HOST}"`, 'All files correctly linted with yamllint!'], 'quoted address')
  // The address reaches the CI variables whole, space included.
  const ci = loadYaml(path.join(DOCKER_DIR, 'runner', VARIABLES))
  assert.equal(ci['.docker-variables'].variables.DOCKER_HOST, SPACED_HOST)
})
