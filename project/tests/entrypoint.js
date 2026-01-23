/**
 * Test Entrypoint
 *
 * Loads step definitions and registers hooks to capture test metadata.
 */

const { setCurrentTest, clearCurrentTest } = require('./steps/support/testContext')

// Register Before hook to capture test metadata
// The 'test' parameter contains feature/scenario information
Before((test) => { // eslint-disable-line no-undef
  // Clean scenario name: remove tags like "@saas @default @self-hosted" from the title
  const rawScenario = test.title || 'default'
  const scenario = rawScenario.replace(/@[\w-]+\s*/g, '').trim()
  const feature = test.parent?.title || 'default'
  setCurrentTest(feature, scenario)
})

// Clear metadata after each test
After(() => { // eslint-disable-line no-undef
  clearCurrentTest()
})

// Load all step modules
require('./steps').registerAll()
