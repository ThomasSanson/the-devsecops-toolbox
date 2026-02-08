const { resolvePath } = require('../step_objects/content')
const { assertFileExists } = require('../step_objects/assertions')
const fs = require('fs')

function register () {
  Then('the {string} file in the {string} directory should contain the following properties in the {string} array item matching {string}:', function (fileName, dirPath, arrayProperty, matchString, table) { // eslint-disable-line no-undef
    const item = getArrayItemFromFile(this, dirPath, fileName, arrayProperty, matchString)

    // Check expected properties
    const rows = table.rows.slice(1) // Skip header
    rows.forEach(row => {
      const prop = row.cells[0].value
      const expectedVal = row.cells[1].value

      // Handle boolean conversions
      let checkVal = expectedVal
      if (expectedVal === 'true') checkVal = true
      if (expectedVal === 'false') checkVal = false

      if (item[prop] !== checkVal) {
        throw new Error(`Expected '${prop}' to be '${checkVal}' but got '${item[prop]}' in item matching '${matchString}'`)
      }
    })
  })

  Then('the {string} file in the {string} directory should NOT contain the following properties in the {string} array item matching {string}:', function (fileName, dirPath, arrayProperty, matchString, table) { // eslint-disable-line no-undef
    const item = getArrayItemFromFile(this, dirPath, fileName, arrayProperty, matchString)

    // Check unexpectedly present properties
    const rows = table.rows.slice(1) // Skip header
    rows.forEach(row => {
      const prop = row.cells[0].value
      if (item[prop] !== undefined) {
        throw new Error(`Expected property '${prop}' to be undefined/absent, but it was '${item[prop]}' in item matching '${matchString}'`)
      }
    })
  })
}

/**
 * Helper to retrieve an item from a JSON array property in a file
 */
function getArrayItemFromFile (context, dirPath, fileName, arrayProperty, matchString) {
  const filePath = resolvePath(context, dirPath, fileName)
  assertFileExists(filePath)

  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const array = content[arrayProperty]

  if (!Array.isArray(array)) {
    throw new Error(`Property '${arrayProperty}' is not an array in ${fileName}`)
  }

  // stringify the item to search for the match string (simple heuristic)
  const item = array.find(i => JSON.stringify(i).includes(matchString))

  if (!item) {
    throw new Error(`Could not find an array item matching '${matchString}' in '${arrayProperty}'`)
  }

  return item
}

register()
module.exports = { register }
