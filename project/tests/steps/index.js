/**
 * Steps Index
 *
 * Central point to load all step modules.
 */

function registerAll () {
  // Support helpers (generic steps)
  require('./support/copierSteps').register()
  require('./support/contentSteps').register()

  // Domain-specific steps
  require('./domains/ansible').register()
  require('./domains/copier').register()
  require('./domains/devsecops').register()
  require('./domains/docker').register()
  require('./domains/gitlab').register()
  require('./domains/podman').register()
  require('./domains/renovate').register()
}

module.exports = { registerAll }
