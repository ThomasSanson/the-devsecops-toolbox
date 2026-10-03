const { spawn } = require('child_process')
const { parentPort, workerData } = require('worker_threads')

// Keep real task output flowing to CodeceptJS's worker monitor while retaining
// the complete output for assertions. A silent synchronous image pull can make
// the monitor terminate a worker that is still running MegaLinter.
function runTask (directory, args, { timeout = 900000, colour = '1' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('task', args, {
      cwd: directory,
      env: { ...process.env, FORCE_COLOR: colour },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout
    })
    let raw = ''
    const collect = chunk => {
      const text = chunk.toString()
      raw += text
      console.log(text.trimEnd())
      // CodeceptJS monitors worker messages, independently of stdout.
      if (parentPort) parentPort.postMessage({ type: 'task-output', workerIndex: workerData.workerIndex, output: text })
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', reject)
    child.on('close', code => resolve({ raw, exitCode: code == null ? 1 : code }))
  })
}

module.exports = { runTask }
