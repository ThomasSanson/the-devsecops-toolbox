/* global inject Given When Then After */
/**
 * Storyboard for @go-install-zsh and @go-install-goroot
 * (features/01-install/go-install-zsh.feature).
 *
 * Without sudo, .config/go/install.sh installs Go under ~/.local and writes
 * GOROOT and GOPATH to a startup file. It must be the one the developer's
 * login shell reads: here zsh, on a fresh Ubuntu machine, in a real terminal.
 *
 * With sudo, it installs Go from the package manager and links /usr/local/go
 * to it, also on a machine without `which`, as a base Arch Linux install is.
 */
const assert = require('assert/strict')
const {
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd
} = require('../helpers/docker')
const { openTerminal, terminalCard } = require('../terminal/capture')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')

const { I } = inject()

const USER = 'bootstrap'
const HOME = `/home/${USER}`
const INSTALLER = '.config/go/install.sh'
const GOROOT_LINE = `export GOROOT="${HOME}/.local/go"`
const GOPATH_LINE = `export GOPATH="${HOME}/.local"`
// What Ubuntu writes in ~/.profile, which zsh never reads: ~/.local/bin joins
// the PATH when it exists.
const ZSHRC = `# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
`
// The prompt the terminal engine waits for (SHELL_PROMPT_RE in capture.js), in
// zsh's syntax. Set machine-wide, so ~/.zshrc on screen holds only the
// developer's own lines.
const PROMPT = "PROMPT='%B%F{green}bootstrap@workspace%f%b:%B%F{blue}%~%f%b$ '"

let box = null

After(() => {
  if (!box) return
  removeContainer(box.name)
  box = null
})

function asRoot (script) {
  const result = execInContainer(box.name, `set -eu\n${script}`, { user: 'root' })
  assert.equal(result.exitCode, 0, `Machine setup failed:\n${result.output}`)
  return result.output
}

function asDeveloper (script) {
  return execInContainerAsUser(box.name, USER, script)
}

const readHome = (file) => asDeveloper(`cat ~/${file}`).stdout

function goLines () {
  const lines = readHome('.zshrc').split('\n')
  return { goroot: lines.filter(l => l === GOROOT_LINE).length, gopath: lines.filter(l => l === GOPATH_LINE).length }
}

storyboardStep(Given, 'a developer whose login shell is zsh has no sudo and no Go', async () => {
  box = { name: containerName() }
  runCommand(`cd /workspace/project && docker compose run -d --name ${box.name} ubuntu`, { timeout: 300000 })
  // Off camera: zsh becomes the account's login shell, and the account loses
  // sudo, so the installer takes its no-sudo road.
  asRoot([
    'apt-get update -qq && apt-get install -y -qq --no-install-recommends zsh >/dev/null',
    `usermod -s /bin/zsh ${USER}`,
    `rm /etc/sudoers.d/${USER}`,
    `printf '%s\\n' ${JSON.stringify(PROMPT)} >> /etc/zsh/zshrc`,
    'mkdir -p /workspace/.config/go'
  ].join('\n'))
  runCommand(`docker cp /workspace/${INSTALLER} ${box.name}:/workspace/${INSTALLER}`)
  asDeveloper(`cat > ~/.zshrc <<'EOF'\n${ZSHRC}EOF`)
  box.bashrc = readHome('.bashrc')
  // The login shell comes from the account, as a login would set it.
  const start = asDeveloper([
    `export SHELL="$(getent passwd ${USER} | cut -d: -f7)"`,
    'cd /workspace && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom zsh >/tmp/ttyd.log 2>&1 &',
    'sleep 1'
  ].join('\n'))
  assert.equal(start.exitCode, 0, `ttyd did not start:\n${start.output}`)
  waitForTtyd(box.name, 30000)
  await openTerminal(I, box.name, { height: 800 })

  const screen = await terminalCard(I, 'zsh-user-without-sudo', 'echo "$SHELL"; sudo -n true; type go; cat ~/.zshrc')
  for (const said of ['/bin/zsh', 'sudo: a password is required', 'go not found', 'PATH="$HOME/.local/bin:$PATH"']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  // Twins on the machine: zsh is the account's shell, sudo refuses, no Go.
  assert.match(asDeveloper(`getent passwd ${USER}`).stdout, /:\/bin\/zsh$/m)
  assert.notEqual(asDeveloper('sudo -n true').exitCode, 0, 'The account must have no sudo')
  assert.equal(readHome('.zshrc'), ZSHRC)
})

storyboardStep(When, 'the Go installer runs without sudo, it adds GOROOT and GOPATH to ~/.zshrc', async () => {
  const screen = await terminalCard(I, 'go-installer-writes-zshrc', `${INSTALLER}; echo "exit code: $?"; cat ~/.zshrc`)
  for (const said of ['sudo unavailable or blocked. Installing go via user-space tarball...', 'Go user-space installation successful.', 'exit code: 0', GOROOT_LINE, GOPATH_LINE]) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  // Twins: each line once in ~/.zshrc, and ~/.bashrc as it was.
  assert.deepEqual(goLines(), { goroot: 1, gopath: 1 }, `Expected GOROOT and GOPATH once each in ~/.zshrc:\n${readHome('.zshrc')}`)
  assert.equal(readHome('.bashrc'), box.bashrc, 'The installer must leave ~/.bashrc alone for a zsh user')
})

storyboardStep(Then, 'a new zsh has GOROOT and GOPATH set and runs Go', async () => {
  const screen = await terminalCard(I, 'new-zsh-runs-go', 'zsh -ic \'echo "GOROOT=$GOROOT"; echo "GOPATH=$GOPATH"; go version\'')
  for (const said of [`GOROOT=${HOME}/.local/go`, `GOPATH=${HOME}/.local`, 'go version go1.24.2 linux/amd64']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  // Twin: Go itself, in a new zsh, reports the two settings.
  const env = asDeveloper('zsh -ic "go env GOROOT GOPATH"')
  assert.equal(env.exitCode, 0, `go env failed in a new zsh:\n${env.output}`)
  assert.equal(env.stdout.trim(), `${HOME}/.local/go\n${HOME}/.local`)
})

storyboardStep(Then, 'a second run of the installer does not add the lines twice', async () => {
  const screen = await terminalCard(I, 'second-run-adds-nothing', `${INSTALLER}; echo "exit code: $?"; grep -n GO ~/.zshrc`)
  for (const said of ['Go user-space installation successful.', 'exit code: 0', `6:${GOROOT_LINE}`, `7:${GOPATH_LINE}`]) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  assert.deepEqual(goLines(), { goroot: 1, gopath: 1 }, `Expected GOROOT and GOPATH still once each in ~/.zshrc:\n${readHome('.zshrc')}`)
})

// @go-install-goroot: the developer keeps sudo, so the installer runs again as
// root and takes the package manager's road. /usr/bin/which is gone, as on a
// base Arch Linux install.
storyboardStep(Given, 'a developer with sudo is on a machine without which and without Go', async () => {
  box = { name: containerName() }
  runCommand(`cd /workspace/project && docker compose run -d --name ${box.name} ubuntu`, { timeout: 300000 })
  asRoot(['rm -f /usr/bin/which', 'mkdir -p /workspace/.config/go'].join('\n'))
  runCommand(`docker cp /workspace/${INSTALLER} ${box.name}:/workspace/${INSTALLER}`)
  const start = asDeveloper([
    'cd /workspace && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &',
    'sleep 1'
  ].join('\n'))
  assert.equal(start.exitCode, 0, `ttyd did not start:\n${start.output}`)
  waitForTtyd(box.name, 30000)
  // Tall: apt-get prints a line per package before the installer's own lines,
  // and the command the card starts from has to stay on screen.
  await openTerminal(I, box.name, { height: 6000 })

  const screen = await terminalCard(I, 'machine-without-which', 'type which go; sudo -n true && echo "sudo works"')
  for (const said of ['which: not found', 'go: not found', 'sudo works']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  // Twins on the machine: no which, no Go, and sudo answers without a password.
  assert.notEqual(asDeveloper('command -v which').exitCode, 0, 'which must be gone')
  assert.notEqual(asDeveloper('command -v go').exitCode, 0, 'Go must not be installed yet')
  assert.equal(asDeveloper('sudo -n true').exitCode, 0, 'The account must have sudo')
})

storyboardStep(Then, 'the Go installer links /usr/local/go to the Go it installed, and Go\'s standard library is there', async () => {
  // The Go Ubuntu ships moves with its updates: its version is masked.
  const mask = [[/go1\.\d+(?:\.\d+)?/g, 'go<version>'], [/go-1\.\d+/g, 'go-<version>']]
  const screen = await terminalCard(I, 'go-root-link', `${INSTALLER}; echo "exit code: $?"; readlink /usr/local/go; ls -d /usr/local/go/src/runtime`, { timeoutMs: 600000, mask })
  for (const said of ['Detected: Debian/Ubuntu (apt-get)', 'exit code: 0', '/usr/local/go/src/runtime']) {
    assert.ok(screen.includes(said), `Expected "${said}" on screen:\n${screen}`)
  }
  assert.ok(!screen.includes('No such file'), `ls must find src/runtime under /usr/local/go:\n${screen}`)
  // Twin: /usr/local/go is the folder the installed go command lives in.
  const goroot = asDeveloper('dirname "$(dirname "$(readlink -f "$(command -v go)")")"').stdout.trim()
  assert.equal(asDeveloper('readlink -f /usr/local/go').stdout.trim(), goroot, `/usr/local/go must lead to ${goroot}`)
  assert.equal(asDeveloper('test -d /usr/local/go/src/runtime').exitCode, 0, 'Go\'s standard library must be under /usr/local/go')
})
