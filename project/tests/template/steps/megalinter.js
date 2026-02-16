const fs = require('fs')
const { resolvePath } = require('../step_objects/content')

const APPEND_CONFIG_KEY = 'CONFIG_PROPERTIES_TO_APPEND'

function readFileFromContext (context, relativePath) {
  const absolutePath = resolvePath(context, relativePath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File ${relativePath} does not exist at ${absolutePath}`)
  }

  return fs.readFileSync(absolutePath, 'utf8')
}

function assertPropertyIsAppended (fileContent, file, key) {
  if (!fileContent.includes(APPEND_CONFIG_KEY) || !fileContent.includes(key)) {
    throw new Error(`Key ${key} not found in ${APPEND_CONFIG_KEY} of ${file}`)
  }
}

function register () {
  // Context step
  When('I check the Megalinter configuration', function () { // eslint-disable-line no-undef
  })

  // Context step
  When('I check the Megalinter base configuration', function () { // eslint-disable-line no-undef
  })

  Then('the file {string} should contain {string} in the list of properties to append', function (file, key) { // eslint-disable-line no-undef
    const fileContent = readFileFromContext(this, file)
    assertPropertyIsAppended(fileContent, file, key)
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
