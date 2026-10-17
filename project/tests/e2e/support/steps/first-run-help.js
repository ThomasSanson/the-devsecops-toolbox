/* global inject After Given When Then */
/**
 * first-run-help storyboard: before the toolbox can reach GitLab, the GitLab
 * check (`task glab:auth:ensure`) and init (`task devsecops:init`) stop at the
 * first missing piece and name the fix. ONE fresh Ubuntu container holding a
 * copy of the toolbox, ONE live terminal, and each card follows the advice the
 * card before it printed. Nobody ever signs in, so nothing reaches a GitLab
 * server: every card is the terminal, one typed line (the card's # Copy) and
 * its whole answer, in the real colours of gum and glow.
 *
 * Every card is twinned with a check of the same fact: the screen text, and for
 * the GitLab host the non-interactive branch of the same check, run off camera.
 */

const { I } = inject()
const {
  storyboardStep,
  addStoryboardFrame
} = require('../../../../../.config/codeceptjs/storyboard')
const {
  setupFreshUbuntuTerminal,
  runInFreshUbuntu,
  teardownFreshUbuntu
} = require('../helpers/freshUbuntu')
const {
  COMMAND_TIMEOUT_MS,
  openTerminal,
  clearTerminal,
  terminalCard,
  waitForTerminalText,
  waitForPromptReturn,
  captureTerminalFrame,
  terminalScreenText
} = require('../terminal/capture')

const SELF_HOSTED = 'gitlab.selfhosted-corp.example'
const SELF_HOSTED_REMOTE = `https://${SELF_HOSTED}/acme/widgets.git`
const GITLABSSH_REMOTE = 'git@gitlabssh.selfhosted-corp.example:acme/widgets.git'
const GITHUB_REMOTE = 'https://github.com/acme/widgets.git'
const GITLAB_COM_REMOTE = 'https://gitlab.com/acme/widgets.git'

// The lines the developer types, one per card, quoted verbatim by its # Copy.
// 1440 px of terminal (157 columns after the prompt's 32) holds the longest
// one on a single row.
const TOOLS_LINE = 'git remote -v; gum --version; glow --version; glab --version'
const CHECK_LINE = 'task glab:auth:ensure'
const SETUP_LINE = 'task dev:setup-environment && task glab:auth:ensure'
const GITLABSSH_LINE = `git remote set-url origin ${GITLABSSH_REMOTE} && git remote -v && task glab:auth:ensure`
const GITHUB_LINE = `git remote set-url origin ${GITHUB_REMOTE} && git remote -v && task glab:auth:ensure`
const INIT_LINE = `git remote set-url origin ${GITLAB_COM_REMOTE} && task devsecops:init`
const OPT_OUT_LINE = `git remote set-url origin ${GITHUB_REMOTE} && TASK_GLAB_ENABLED=false task devsecops:init`

const SIGN_IN_QUESTION = 'Continue and sign in now?'
const SIGN_IN_CARD = 'GitLab Authentication Required'
const CHECK_FAILED = 'task: Failed to run task "glab:auth:ensure"'
// The setup installs every tool, a long run that scrolls off the screen: the
// cards that run it start at its last line.
const SETUP_DONE = '🎉 Development environment setup completed successfully'
// The pinned tool versions (and glab's build commit) move with every Renovate
// bump and say nothing about the check.
const VERSION_MASK = [[/\d+\.\d+\.\d+/g, 'X.Y.Z'], [/\(([0-9a-f]{7,40})\)/g, '(<commit>)']]
// The init rerun lists every tool it finds installed: docker adds its build
// commit, uv its build date, and lefthook names its hooks in map order.
const RERUN_MASK = [
  ...VERSION_MASK,
  [/build [0-9a-f]{7,40}/g, 'build <commit>'],
  [/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD'],
  [/commit-msg, pre-commit|pre-commit, commit-msg/g, 'commit-msg, pre-commit']
]

let container = null
// The command the check named on its first stop, for the card that runs it.
let named = null

After(() => {
  teardownFreshUbuntu(container)
  container = null
})

function expectOnScreen (screen, said, card) {
  for (const text of said) {
    if (!screen.includes(text)) throw new Error(`Expected the ${card} card to show ${JSON.stringify(text)}:\n${screen}`)
  }
}

function expectOffScreen (screen, unsaid, card) {
  for (const text of unsaid) {
    if (screen.includes(text)) throw new Error(`Expected the ${card} card NOT to show ${JSON.stringify(text)}:\n${screen}`)
  }
}

// The rows the check printed under its sign-in card, where it names the host.
// glow pads the host as code, so runs of spaces read as one.
function signInCardRows (screen) {
  const at = screen.lastIndexOf(SIGN_IN_CARD)
  if (at === -1) throw new Error(`Expected the sign-in card "${SIGN_IN_CARD}" on screen:\n${screen}`)
  return screen.slice(at).replace(/ +/g, ' ')
}

// The same check off camera, without a terminal: it takes the non-interactive
// branch, the one CI gets, and must name the same host.
function expectNonInteractiveHost (host) {
  const res = runInFreshUbuntu(container, 'CI=true task glab:auth:ensure', { timeout: 120000 })
  if (res.exitCode === 0) throw new Error(`Expected the non-interactive check to fail without a sign-in:\n${res.output}`)
  expectOnScreen(res.output, ['GitLab authentication required', `host        ${host}`, 'run locally task glab:auth'], 'non-interactive check')
  expectOffScreen(res.output, ['gitlabssh'], 'non-interactive check')
}

// A card whose line ends on gum's live question. gum erases a question once it
// is answered, so the card is taken while it waits. The developer then answers
// No and the prompt comes back. Returns the screen text of the card.
async function signInOfferCard (frame, line, fromMarker = line.slice(0, 40)) {
  await clearTerminal(I)
  I.type(line)
  I.pressKey('Enter')
  await waitForTerminalText(I, SIGN_IN_QUESTION, COMMAND_TIMEOUT_MS)
  await addStoryboardFrame(I, await captureTerminalFrame(I, frame, { fromMarker, mask: VERSION_MASK }))
  const screen = await terminalScreenText(I)
  I.click('.xterm-screen')
  I.pressKey('n')
  await waitForPromptReturn(I, line)
  return screen
}

// Off camera: a fresh Ubuntu box with a copy of the toolbox, committed with the
// company's own GitLab as its origin, and its live terminal 1440 px wide.
storyboardStep(Given, "a developer's project points at the company's own GitLab, with none of the toolbox's tools installed yet", async () => {
  container = setupFreshUbuntuTerminal({ gitRemote: SELF_HOSTED_REMOTE })
  await openTerminal(I, container, { width: 1440 })
  const screen = await terminalCard(I, 'tools-missing', TOOLS_LINE)
  expectOnScreen(screen, [
    `${SELF_HOSTED_REMOTE} (fetch)`,
    'bash: gum: command not found',
    'bash: glow: command not found',
    'bash: glab: command not found'
  ], 'tools')
})

// The check on the bare machine: it stops at gum and names the setup that
// installs every tool.
storyboardStep(When, 'the developer runs the GitLab check, it names the missing tool and the setup that installs it', async () => {
  const screen = await terminalCard(I, 'check-names-setup', CHECK_LINE)
  expectOnScreen(screen, ['Required UI dependency missing: gum', 'Then rerun:', '  task devsecops:init', CHECK_FAILED], 'missing tool')
  expectOffScreen(screen, ['glow', 'GitLab CLI not found'], 'missing tool')
  const advice = /^Run:\n\s+(\S.*)$/m.exec(screen)
  if (!advice) throw new Error(`Expected the check to name a command to run:\n${screen}`)
  named = advice[1].trim()
  if (named !== 'task dev:setup-environment') throw new Error(`Expected the check to name the setup, it names "${named}":\n${screen}`)

  // Off camera, the two other stops: with gum alone the check names glow and
  // the same setup, with both it asks for the GitLab CLI. Both tools go again,
  // so the setup the next card runs starts from the same bare machine.
  const glow = runInFreshUbuntu(container, `.config/gum/install.sh >/dev/null && CI=true ${CHECK_LINE}`, { timeout: 120000 })
  if (glow.exitCode === 0) throw new Error(`Expected the check to stop without glow:\n${glow.output}`)
  expectOnScreen(glow.output, ['Required UI dependency missing: glow', '  task dev:setup-environment'], 'glow stop')
  const cli = runInFreshUbuntu(container, `.config/glow/install.sh >/dev/null && CI=true ${CHECK_LINE}`, { timeout: 120000 })
  if (cli.exitCode === 0) throw new Error(`Expected the check to stop without the GitLab CLI:\n${cli.output}`)
  expectOnScreen(cli.output, ['GitLab CLI not found', 'install     glab'], 'GitLab CLI stop')
  expectOffScreen(cli.output, ['Required UI dependency missing'], 'GitLab CLI stop')
  const bare = runInFreshUbuntu(container, 'rm -f "$HOME/.local/bin/gum" "$HOME/.local/bin/glow" && ! command -v gum && ! command -v glow', { timeout: 60000 })
  if (bare.exitCode !== 0) throw new Error(`Expected gum and glow to be gone again:\n${bare.output}`)
})

// Each card follows the advice the card before it printed: the setup the check
// named installs every tool, glab included, and the check gets past all three
// to glow's sign-in card for the host it read from the remote.
storyboardStep(When, "the developer runs that setup, the check names the company's GitLab host and offers to sign in", async () => {
  if (!SETUP_LINE.startsWith(`${named} `)) throw new Error(`The check said to run "${named}", but the developer types: ${SETUP_LINE}`)
  const screen = await signInOfferCard('signin-offer-selfhosted', SETUP_LINE, SETUP_DONE)
  expectOnScreen(screen, [SETUP_DONE, SIGN_IN_QUESTION], 'sign-in offer')
  expectOnScreen(signInCardRows(screen), [`Target Host: ${SELF_HOSTED}`], 'sign-in offer')
  const tools = runInFreshUbuntu(container, 'command -v gum && command -v glow && command -v glab', { timeout: 60000 })
  if (tools.exitCode !== 0) throw new Error(`Expected the setup to install gum, glow and glab:\n${tools.output}`)
  expectNonInteractiveHost(SELF_HOSTED)
})

// The SSH address a self-hosted GitLab gives out: the remote rows show
// gitlabssh, the sign-in card below them names the gitlab host.
storyboardStep(Then, 'an SSH-style gitlabssh remote still leads the check to the same GitLab host', async () => {
  const screen = await signInOfferCard('signin-offer-gitlabssh', GITLABSSH_LINE)
  expectOnScreen(screen, ['git@gitlabssh.selfhosted-corp.example:acme/widgets.git (fetch)'], 'gitlabssh')
  const card = signInCardRows(screen)
  expectOnScreen(card, [`Target Host: ${SELF_HOSTED}`], 'gitlabssh sign-in')
  expectOffScreen(card, ['gitlabssh'], 'gitlabssh sign-in')
  expectNonInteractiveHost(SELF_HOSTED)
})

// A GitHub remote: the check refuses before it ever looks for the CLI or a
// sign-in, and prints the line that points the remote back at GitLab.
storyboardStep(Then, 'a GitHub remote is refused, with the exact command to point it back at GitLab', async () => {
  const screen = await terminalCard(I, 'github-refused', GITHUB_LINE)
  expectOnScreen(screen, [
    'https://github.com/acme/widgets.git (fetch)',
    'No GitLab repository remote was detected.',
    'Align your repository remote, then rerun:',
    'git remote set-url origin https://gitlab.com/<namespace>/<project>.git',
    CHECK_FAILED
  ], 'GitHub refusal')
  expectOffScreen(screen, [SIGN_IN_CARD], 'GitHub refusal')
})

// The developer follows that advice and runs init: the one full toolchain
// install of the story, then init reaches the sign-in, the developer answers
// No and init pauses with the commands to run. The card ends on the second of
// them: go-task's nested failure line under it is wider than the terminal and
// would wrap in the middle of a word, so it is checked on the screen text.
storyboardStep(When, 'the developer points the remote back at GitLab and runs init, it stops at the sign-in and names the command to run', async () => {
  await clearTerminal(I)
  I.type(INIT_LINE)
  I.pressKey('Enter')
  await waitForTerminalText(I, SIGN_IN_QUESTION, COMMAND_TIMEOUT_MS)
  I.click('.xterm-screen')
  I.pressKey('n')
  await waitForPromptReturn(I, INIT_LINE)
  const screen = await terminalScreenText(I)
  const rows = screen.split('\n')
  const from = rows.findIndex((row) => row.includes(SETUP_DONE))
  const to = rows.findIndex((row, i) => i > from && /^\s*then\s+task devsecops:init/.test(row))
  if (from === -1 || to === -1) throw new Error(`Expected the init card to run from the setup line to "then task devsecops:init":\n${screen}`)
  await addStoryboardFrame(I, await captureTerminalFrame(I, 'init-stops-at-signin', { fromMarker: SETUP_DONE, maxRows: to - from + 1, mask: VERSION_MASK }))
  expectOnScreen(screen, ['Configuring GitLab project', 'Initialization paused', 'task glab:auth', 'task: Failed to run task "devsecops:init:default"'], 'init sign-in')
  expectOnScreen(signInCardRows(screen), ['Target Host: gitlab.com'], 'init sign-in')
  expectOffScreen(screen, ['DevSecOps project initialization completed'], 'init sign-in')
})

// The whole rerun, from the typed line with the flag: every tool is already
// there, and with the GitLab part turned off init goes straight from the setup
// to "completed", even on a GitHub remote the check would refuse.
storyboardStep(Then, 'a project that stays on GitHub turns the GitLab integration off, and init finishes cleanly', async () => {
  const screen = await terminalCard(I, 'init-gitlab-off', OPT_OUT_LINE, { mask: RERUN_MASK })
  expectOnScreen(screen, ['task: Task "devsecops:init:configure" is up to date', 'DevSecOps project initialization completed'], 'GitLab off')
  expectOffScreen(screen, ['Configuring GitLab project', 'No GitLab repository remote', SIGN_IN_CARD, 'Failed to run task'], 'GitLab off')
  const origin = runInFreshUbuntu(container, 'git remote get-url origin', { timeout: 60000 })
  if (origin.output.trim() !== GITHUB_REMOTE) throw new Error(`Expected the project to stay on ${GITHUB_REMOTE}, origin is ${origin.output.trim()}`)
})
