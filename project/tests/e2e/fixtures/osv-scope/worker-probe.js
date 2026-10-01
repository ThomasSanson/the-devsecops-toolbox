const assert = require('assert/strict')
const fs = require('fs')
const { Worker } = require('worker_threads')

// The CI screenshot needs a real worker too. This probe uses the same helper
// and saves its actual messages so the existing local assertions can compare.
const progress = []
const worker = new Worker(`
  const { parentPort } = require('worker_threads')
  const { runTask } = require('./taskProcess')
  runTask(process.cwd(), ['probe'], { timeout: 15000, colour: '0' })
    .then(result => parentPort.postMessage({ type: 'result', result }))
    .catch(error => { throw error })
`, { eval: true, stdout: true, workerData: { workerIndex: 1 } })
worker.stdout.resume()

worker.on('message', message => {
  if (message.type === 'task-output') {
    progress.push(message.output)
    // One stream preserves the order: actual progress bytes, then exit code.
    process.stdout.write(message.output)
  }
  if (message.type !== 'result') return
  const result = message.result
  assert.ok(progress.length > 0)
  assert.equal(progress.join(''), result.raw)
  assert.notEqual(result.exitCode, 0)
  fs.writeFileSync('worker-result.json', JSON.stringify({ ...result, progress }))
  console.log(`Worker task exit code: ${result.exitCode}`)
  process.exitCode = result.exitCode
})
