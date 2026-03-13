const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const { I } = inject()
const { executeCopier } = require('../../template/step_objects/commands')

const CONTAINER_WORKDIR = '/workspace'
const TTYD_READY_TIMEOUT = 15000
const TERMINAL_CMD_TIMEOUT = 120000

const activeContainers = []

function runCommand (command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    timeout: 120000,
    ...options
  })
}

function runCommandWithResult (command, options = {}) {
  try {
    const output = runCommand(command, options)
    return { exitCode: 0, output: output || '' }
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : ''
    const stderr = error.stderr ? String(error.stderr) : ''

    return {
      exitCode: typeof error.status === 'number' ? error.status : 1,
      output: `${stdout}${stderr}`
    }
  }
}

function shellEscape (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = quote + '"' + quote + '"' + quote

  return quote + String(value).replace(/'/g, escapedQuote) + quote
}

function containerName () {
  return `ttyd-bootstrap-${crypto.randomBytes(4).toString('hex')}`
}

function randomPort () {
  const min = 20000
  const max = 30000

  return min + Math.floor(Math.random() * (max - min))
}

function execInContainer (name, command) {
  return runCommandWithResult(
    `docker exec ${shellEscape(name)} sh -c ${shellEscape(command)}`
  )
}

function removeContainer (name) {
  try {
    runCommand(`docker rm -f ${shellEscape(name)}`)
  } catch (_) {
    // Ignore cleanup failures.
  }
}

function waitForTtyd (port, timeoutMs) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      runCommand(`curl -sf http://127.0.0.1:${port}/ >/dev/null 2>&1`) // DevSkim: ignore DS162092
      return true
    } catch (_) {
      execSync('sleep 0.5')
    }
  }

  throw new Error(`ttyd did not become ready on port ${port} within ${timeoutMs}ms`)
}

Before(function () { // eslint-disable-line no-undef
  this.ttydPort = null
  this.ttydContainerName = null
  this.ttydGeneratedProjectDir = null
})

After(function () { // eslint-disable-line no-undef
  if (this.ttydContainerName) {
    removeContainer(this.ttydContainerName)
    const index = activeContainers.indexOf(this.ttydContainerName)

    if (index !== -1) {
      activeContainers.splice(index, 1)
    }
  }

  if (this.ttydGeneratedProjectDir) {
    fs.rmSync(path.dirname(this.ttydGeneratedProjectDir), { recursive: true, force: true })
  }
})

Given('a generated toolbox project is mounted in a fresh Ubuntu ttyd container', function () { // eslint-disable-line no-undef
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyd-bootstrap-'))
  this.ttydGeneratedProjectDir = path.join(tempBaseDir, 'generated')
  fs.mkdirSync(this.ttydGeneratedProjectDir, { recursive: true })

  executeCopier(this.ttydGeneratedProjectDir)

  const taskBinary = fs.realpathSync(runCommand('command -v task').trim())
  this.ttydPort = randomPort()
  this.ttydContainerName = containerName()

  runCommand(
    [
      'docker run -d',
      `--name ${shellEscape(this.ttydContainerName)}`,
      `-p 127.0.0.1:${this.ttydPort}:7681`,
      'ubuntu:24.04',
      'bash -c', shellEscape('while :; do sleep 10 & wait; done')
    ].join(' ')
  )
  activeContainers.push(this.ttydContainerName)

  execInContainer(this.ttydContainerName, `mkdir -p ${CONTAINER_WORKDIR}`)

  runCommand(`docker cp ${shellEscape(taskBinary)} ${shellEscape(`${this.ttydContainerName}:/usr/local/bin/task`)}`)
  runCommand(`docker cp ${shellEscape(`${this.ttydGeneratedProjectDir}/.`)} ${shellEscape(`${this.ttydContainerName}:${CONTAINER_WORKDIR}`)}`)

  const prepareResult = execInContainer(this.ttydContainerName, [
    'set -eu',
    'apt-get update -qq',
    'apt-get install -y -qq sudo curl',
    'if ! id bootstrap >/dev/null 2>&1; then',
    '  useradd -m -s /bin/bash bootstrap',
    'fi',
    'echo "bootstrap ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bootstrap',
    'chmod 0440 /etc/sudoers.d/bootstrap',
    `chown -R bootstrap:bootstrap ${CONTAINER_WORKDIR}`,
    'chmod 0755 /usr/local/bin/task',
    'echo \'PROMPT_COMMAND="touch /tmp/ttyd-cmd-done"\' >> /home/bootstrap/.bashrc'
  ].join('\n'))

  if (prepareResult.exitCode !== 0) {
    throw new Error(`Failed to prepare ttyd container:\n${prepareResult.output}`)
  }

  const ttydInstall = execInContainer(this.ttydContainerName, [
    'set -eu',
    'TTYD_VERSION="1.7.7"',
    'UNAME_ARCH="$(uname -m)"',
    'curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${UNAME_ARCH}" -o /usr/local/bin/ttyd',
    'chmod +x /usr/local/bin/ttyd'
  ].join('\n'))

  if (ttydInstall.exitCode !== 0) {
    throw new Error(`Failed to install ttyd:\n${ttydInstall.output}`)
  }

  const ttydStart = execInContainer(this.ttydContainerName, [
    'set -eu',
    `nohup su - bootstrap -c 'cd ${CONTAINER_WORKDIR} && ttyd -p 7681 -W -t scrollback=5000 bash' >/tmp/ttyd.log 2>&1 &`,
    'sleep 1'
  ].join('\n'))

  if (ttydStart.exitCode !== 0) {
    throw new Error(`Failed to start ttyd:\n${ttydStart.output}`)
  }

  waitForTtyd(this.ttydPort, TTYD_READY_TIMEOUT)
})

When('I open the web terminal', async function () { // eslint-disable-line no-undef
  I.amOnPage(`http://127.0.0.1:${this.ttydPort}`) // DevSkim: ignore DS162092
  I.waitForElement('.xterm-screen', 10)
  I.wait(1)
})

When('I type {string} in the terminal and wait for completion', async function (command) { // eslint-disable-line no-undef
  execInContainer(this.ttydContainerName, 'rm -f /tmp/ttyd-cmd-done')
  I.click('.xterm-screen')
  I.type(command)
  I.pressKey('Enter')
  await I.wait(3)

  const name = shellEscape(this.ttydContainerName)
  const cmd = 'while [ ! -f /tmp/ttyd-cmd-done ]; do sleep 1; done; sleep 2'

  try {
    execSync(`docker exec ${name} bash -c ${shellEscape(cmd)}`, {
      encoding: 'utf-8',
      timeout: TERMINAL_CMD_TIMEOUT
    })
  } catch (error) {
    if (error.killed) {
      throw new Error(`Timed out waiting for command to finish after ${TERMINAL_CMD_TIMEOUT}ms`)
    }
    throw error
  }
})

Then('the terminal output should visually match {string}', async function (baselineName) { // eslint-disable-line no-undef
  await I.wait(1)
  I.resizeWindow(1920, 1080)
  await I.wait(2)

  const outputDir = path.resolve(__dirname, '..', '_output')

  const scrollInfo = await I.executeScript(function () {
    var vp = document.querySelector('.xterm-viewport')
    if (!vp) return null
    return { scrollHeight: vp.scrollHeight, clientHeight: vp.clientHeight }
  })

  if (scrollInfo && scrollInfo.scrollHeight > scrollInfo.clientHeight) {
    const pageHeight = scrollInfo.clientHeight
    const totalHeight = scrollInfo.scrollHeight
    const pageCount = Math.ceil(totalHeight / pageHeight)
    const contentPages = []

    for (let i = 0; i < pageCount; i++) {
      const scrollPos = (i < pageCount - 1) ? i * pageHeight : totalHeight - pageHeight
      await I.executeScript(function (pos) {
        document.querySelector('.xterm-viewport').scrollTop = pos
      }, scrollPos)
      await I.wait(0.5)
      I.moveCursorTo('body', 1, 1)
      await I.wait(0.3)

      const pagePath = path.resolve(outputDir, `_scroll_${baselineName}_p${i}.png`)
      await I.usePlaywrightTo('capture scroll page', async ({ page }) => {
        await page.screenshot({ path: pagePath })
      })
      contentPages.push(pagePath)
    }

    const pagesBase64 = contentPages.map(function (f) {
      return fs.readFileSync(f).toString('base64')
    })
    const lastPageVisible = totalHeight - (pageCount - 1) * pageHeight
    const stitchHeight = (contentPages.length - 1) * pageHeight + lastPageVisible
    const fullPath = path.resolve(outputDir, `${baselineName}-full.png`)

    await I.usePlaywrightTo('stitch scrolling screenshots', async ({ browser }) => {
      const stitchPage = await browser.newPage()
      await stitchPage.setViewportSize({ width: 1920, height: Math.min(stitchHeight, 16000) })
      await stitchPage.setContent(
        '<!DOCTYPE html><html><body style="margin:0;padding:0">' +
        '<canvas id="c" width="1920" height="' + stitchHeight + '"></canvas>' +
        '</body></html>'
      )

      for (let i = 0; i < pagesBase64.length; i++) {
        const isLast = (i === pagesBase64.length - 1)
        const yDest = i * pageHeight
        const srcY = isLast ? (pageHeight - lastPageVisible) : 0
        const drawH = isLast ? lastPageVisible : pageHeight

        await stitchPage.evaluate(async (args) => {
          return new Promise(function (resolve) {
            var img = new Image()
            img.onload = function () {
              var ctx = document.getElementById('c').getContext('2d')
              ctx.drawImage(img, 0, args.srcY, 1920, args.drawH, 0, args.yDest, 1920, args.drawH)
              resolve()
            }
            img.src = 'data:image/png;base64,' + args.b64
          })
        }, { b64: pagesBase64[i], srcY, drawH, yDest })
      }

      await stitchPage.screenshot({ path: fullPath, fullPage: true })
      await stitchPage.close()
    })

    contentPages.forEach(function (f) { try { fs.unlinkSync(f) } catch (e) { /* ignore */ } })

    await I.executeScript(function (max) {
      document.querySelector('.xterm-viewport').scrollTop = max
    }, totalHeight)
    await I.wait(0.5)
  }

  I.moveCursorTo('body', 1, 1)
  I.takeScreenshot(baselineName)
  I.assertVisualMatch(baselineName)
  I.resizeWindow(1024, 768)
  await I.wait(1)
})

Then('I take a terminal screenshot named {string}', async function (name) { // eslint-disable-line no-undef
  I.wait(1)
  I.saveScreenshot(`${name}.png`)
})
