@e2e
Feature: The test engine runs on the Node version the toolbox pins
  The toolbox pins one Node version for the projects it generates. Its test
  image must run that same Node, not the one its Playwright base image ships.

  @test-image-node
  Scenario: The test image runs the Node version pinned for generated projects
    # Note: The first line is the Node version the toolbox pins for the projects it generates. The second is the Node that runs the tests in this image. The picture keeps only the major version, so a patch update from Renovate leaves it unchanged. The test still compares both versions in full.
    # Copy: cat .config/node/version && node --version
    Then the test image runs the Node version the toolbox pins
