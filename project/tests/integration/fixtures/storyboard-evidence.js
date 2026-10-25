const fs = require('node:fs')
const path = require('node:path')

module.exports = function recordEvidence (name, contents) {
  const dir = process.env.TASK_NATIVE_STORY_EVIDENCE
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), contents)
}
