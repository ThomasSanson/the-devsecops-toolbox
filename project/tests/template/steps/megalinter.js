const fs = require('fs')
const { resolvePath } = require('../step_objects/content')

function register () {
  // Context step
  When('I check the Megalinter configuration', function () { // eslint-disable-line no-undef
  })

  // Context step
  When('I check the Megalinter base configuration', function () { // eslint-disable-line no-undef
  })

  Then('the file {string} should contain {string} in the list of properties to append', function (file, key) { // eslint-disable-line no-undef
    const absolutePath = resolvePath(this, file)

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File ${file} does not exist at ${absolutePath}`)
    }

    const fileContent = fs.readFileSync(absolutePath, 'utf8')
    if (!fileContent.includes('CONFIG_PROPERTIES_TO_APPEND') || !fileContent.includes(key)) {
      throw new Error(`Key ${key} not found in CONFIG_PROPERTIES_TO_APPEND of ${file}`)
    }
  })
}

// Auto-register when loaded by CodeceptJS
register()

module.exports = { register }
