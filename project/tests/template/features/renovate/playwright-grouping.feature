@copier @renovate @template @renovate-playwright-grouping
Feature: Playwright updates are grouped for codeceptjs
  As a DevSecOps engineer
  I want Renovate to open a single MR for Playwright updates in codeceptjs
  So that npm and Docker image updates stay aligned

  Scenario: Source Renovate config groups Playwright updates and disables the preset monorepo grouping
    Then the source template file ".config/renovate/config.json" should contain "\"ignorePresets\": ["
    And the source template file ".config/renovate/config.json" should contain "\"monorepo:playwright\""
    And the source template file ".config/renovate/config.json" should contain "\"groupName\": \"Playwright codeceptjs stack\""
    And the source template file ".config/renovate/config.json" should contain "\"groupSlug\": \"playwright-codeceptjs-stack\""
    And the source template file ".config/renovate/config.json" should contain "\"matchPackageNames\": [\"playwright\", \"mcr.microsoft.com/playwright\"]"
    And the source template file ".config/renovate/config.json" should contain "\"matchFileNames\": ["
    And the source template file ".config/renovate/config.json" should contain "\".config/codeceptjs/package.json\""
    And the source template file ".config/renovate/config.json" should contain "\".config/codeceptjs/package-lock.json\""
    And the source template file ".config/renovate/config.json" should contain "\".config/codeceptjs/Dockerfile\""
