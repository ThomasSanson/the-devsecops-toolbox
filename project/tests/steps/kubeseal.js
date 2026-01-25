const { resolvePath } = require('../step_objects/content')
const { assertFileExists } = require('../step_objects/assertions')

function register () {
  Then('the file {string} should exist', function (relativepath) { // eslint-disable-line no-undef
    const file = resolvePath(this, relativepath)
    assertFileExists(file)
  })
}

register()
module.exports = { register }
