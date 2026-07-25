<!-- markdownlint-disable MD024 MD037 -->

# Changelog

## 22.9.5 (2026-07-25)

### Fix

- **deps**: update dependency codeceptjs to v3.7.9

## 22.9.4 (2026-07-25)

### Fix

- **deps**: open one merge request per dependency, keep the runner's browser

## 22.9.3 (2026-07-25)

### Fix

- **test**: wait for GitLab to recompute the merge-request diff before reading it
- **test**: mask a pipeline duration that lands on a round minute

## 22.9.2 (2026-07-24)

### Fix

- **gitleaks**: stop allowlisting every .env and secrets.yaml so the scanner sees real secrets

## 22.9.1 (2026-07-24)

### Fix

- **release**: keep main locked when the release is killed, and surface a failed re-lock

## 22.9.0 (2026-07-22)

### Feat

- **template**: generated projects release without a default Helm chart
- **template**: ship generic AGENTS.md/CLAUDE.md to generated projects
- **test**: ship a blank gitlab-runner service in the test compose stack
- **tests**: restructure e2e suite to three acts, flatten storyboards
- **visual**: enhance regression reporting and scrub terminal output
- **storyboard**: add failure band and docs for visual regression
- **storyboard**: add per‑sentence card baseline, baseDir handling
- **storyboard**: add SVG storyboard with frame baselines, update docs
- **journey**: bind Gherkin When steps to storyboard panels
- **test**: add storyboard visual capture for agent-mode journey, preinstall toolchain

### Fix

- **test**: anchor copier question cards on the question itself
- **ci**: drop the pages job and keep the shard guard framework-only
- **test**: mask token-page IPs and track the runner pin in renovate baselines
- **test**: make the lambda UI login self-sufficient on a virgin GitLab
- **test**: size the installer wait for CI contention
- **test**: retire fresh-Ubuntu containers per chapter in first-run-help
- **scripts**: restore executable bit on check-include-coverage.sh
- **test**: make lambda user lookup idempotent in gitlabApi helper
- **test**: exclude .task from the e2e workspace tarball
- **task**: resolve kubeseal/sealed-secrets includes and guard include paths
- **journeyContainer**: chmod project dir and .git to 755 for CI
- **e2e**: chmod .git to 755 after clone to fix CI umask

### Refactor

- use # Note/# Copy in storyboard, add guide, rename port var
- **test**: remove notes, copy metadata and unused imports from steps
- **e2e**: tidy steps, update globals, improve notes, add skipLogin
- rename PORT, improve storyboard layout, rename test domains, update docs
- **e2e**: use storyboard steps in tests and rename port constant
- **e2e**: migrate steps to storyboard and improve assertions
- **storyboard**: simplify rendering, add helpers; improve docs
- integrate storyboard API, replace visual helper, update docs, server port

### Perf

- **ci**: split the e2e suite into 8 shards and size UI waits for load
- **ci**: shard the e2e suite across 5 parallel jobs
- **ci**: reclaim BuildKit cache and probe disk around the e2e suite
- **test**: share the uv download cache across throwaway containers

## 22.8.0 (2026-06-28)

### Feat

- **cspell**: split config, add migration script, docs and e2e tests

### Fix

- **cspell**: ignore Caddyfile named in the e2e journey step comment
- **install**: pin agent-mode context permissions to 0755/0644
- **node**: strip a stale npm prefix before nvm activation
- **e2e**: exclude .impeccable and .ruff_cache from the render tar

## 22.7.0 (2026-06-18)

### Feat

- **e2e**: add renovate config validation and visual tests
- **textRender**: render ANSI colors in e2e test output
- **e2e**: add Renovate centralization scenarios to template tests
- **install**: add UI for selective component install (agent mode)

## 22.6.0 (2026-06-15)

### Feat

- **gitlabApi**: add project helpers and improve token handling
- **taskfile**: add init options, bootstrap task, and remote checks
- **check-test-coverage**: support umbrella delegation for CI test tasks
- **devsecops**: add bootstrap‑main and init‑merge‑request tasks
- **e2e**: add terminal capture helper for deterministic screenshots
- **e2e**: add template-matrix step definitions for copier update tests
- **e2e**: add comprehensive developer journey test steps
- **e2e**: add shared text-to-pixel rendering helper for visual assertions
- **e2e**: add pageVisual helper for visual match assertions
- **e2e**: add GitLabRepositoryPage for repository visual regression
- **e2e**: add GitLabMergeRequestPage for visual regression
- **e2e**: add matrix feature file to test non‑default Copier answers
- **e2e**: add token lifecycle feature tests for init command
- **e2e**: add init-framework-mr feature file for developer journey
- **e2e**: add parallel runner, init guidance & auth tests, update docs
- **e2e**: replace individual test tasks with unified project:test:e2e suite

### Fix

- **glab**: restore the protect-reset line in the init output contract
- **test**: eliminate the shared-toolchain race between e2e workers
- **ci**: stabilize the suite under SaaS-runner load and fix lint regressions
- **ci**: align dind and compose network MTU on 1360 per GitLab KB
- **ci**: set dind and compose network MTU to 1460 for SaaS runners
- **build**: harden toolchain downloads with curl retry and timeouts
- **devsecops**: use GIT_CONFIG env vars for safe.directory, not global
- **devsecops**: stop adding global safe.directory, use env vars instead
- **devsecops**: add fallback for branch detection to prevent errors
- **taskfile**: add robust fallback for CURRENT_BRANCH detection in CI
- **commitizen**: add fallback for git branch name to prevent errors

### Refactor

- **e2e**: destructure token and use shared visual match helper
- **docker**: remove unused GitLab helper functions and constants
- **tests**: drop unused homepage and visual regression methods
- **GitLabProjectPage**: add path‑free check with polling after delete
- delete legacy test/template files and rename port constant

## 22.5.0 (2026-05-06)

### Feat

- **glab**: cap token expiry at 90 days and add GitLab limit test

## 22.4.0 (2026-05-05)

### Feat

- **devsecops**: add --skip-answered to Taskfile and related tests

## 22.3.0 (2026-04-30)

### Feat

- **gitlab**: add token resync utilities for hidden vars and rotation

## 22.2.2 (2026-04-22)

### Fix

- **deps**: update playwright monorepo

## 22.2.1 (2026-04-22)

### Fix

- **helpers**: drop 2>&1 redirection in runCommandWithResult wrapper

### Refactor

- **helpers**: separate stdout/stderr capture for command runs
- **node**: use nvm with pinned version, remove legacy nodejs setup

## 22.2.0 (2026-04-21)

### Feat

- **dev**: add gum and glow taskfiles, update glab auth tests, set hostname
- **setup**: add gum & glow tools with user‑space install fallback

### Fix

- **bootstrap**: make premium glab auth UI testable from scratch

### Refactor

- **ci**: add uv, Docker CLI and adjust bootstrap tests for paths

## 22.1.7 (2026-04-17)

### Fix

- **deps**: update playwright monorepo

## 22.1.6 (2026-04-17)

### Fix

- **deps**: update gitlab/gitlab-ce docker tag to v18.11.0

## 22.1.5 (2026-04-11)

### Fix

- **deps**: update dependency commitizen to v4.13.10

## 22.1.4 (2026-04-10)

### Fix

- **deps**: update playwright monorepo

## 22.1.3 (2026-04-09)

### Fix

- **deps**: update playwright monorepo

## 22.1.2 (2026-04-08)

### Fix

- **deps**: update playwright monorepo

## 22.1.1 (2026-04-06)

### Fix

- **deps**: update playwright monorepo to v1.59.1

## 22.1.0 (2026-04-06)

### Feat

- **renovate**: add ignorePresets for Playwright grouping and test feature

## 22.0.4 (2026-04-03)

### Fix

- **deps**: update dependency @types/node to v24.12.2

## 22.0.3 (2026-04-02)

### Fix

- **deps**: update dependency gitlab-org/cli to v1.91.0

## 22.0.2 (2026-04-01)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.3.4

## 22.0.1 (2026-03-31)

### Fix

- **deps**: update dependency copier to v9.14.1

## 22.0.0 (2026-03-31)

### Feat

- **megalinter**: switch default task from npx to docker
- **glab**: auto-detect host/project and replace :id in API calls

## 21.9.1 (2026-03-30)

### Fix

- **deps**: update dependency lizard to v1.21.3

## 21.9.0 (2026-03-28)

### Feat

- **glab**: add auth:ensure task with premium UI
- **glab**: auto-detect GitLab host, normalize gitlabssh, update tests

### Fix

- **test**: align auth-ensure scenarios with bootstrap container reality

## 21.8.2 (2026-03-28)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.3.3

## 21.8.1 (2026-03-26)

### Fix

- **deps**: update gitlab/gitlab-ce docker tag to v18.10.1

## 21.8.0 (2026-03-26)

### Feat

- **glab**: add host‑scoped glab auth detection and related tests

## 21.7.7 (2026-03-25)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.3.2

## 21.7.6 (2026-03-24)

### Fix

- **deps**: update dependency typescript to v6

## 21.7.5 (2026-03-24)

### Fix

- **deps**: update dependency ansible-core to v2.20.4

## 21.7.4 (2026-03-24)

### Fix

- **deps**: update dependency gitlab-org/cli to v1.90.0

## 21.7.3 (2026-03-20)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.3.1

## 21.7.2 (2026-03-20)

### Fix

- **devsecops**: support interactive piped installer via tty

## 21.7.1 (2026-03-20)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.3.0

## 21.7.0 (2026-03-20)

### Feat

- **bootstrap**: add commitlint readiness test and robust output handling

## 21.6.0 (2026-03-19)

### Feat

- **task**: add full diagnostic script and defer step to bootstrap test
- add Ubuntu test container and sudo checks to install scripts
- **ttyd_steps**: add stripAnsiEscapeSequences to clean ANSI output
- **devsecops**: centralize git checks, add retry and template overrides
- **test**: add ttyd terminal and visual regression for bootstrap e2e
- **init**: add installer, rename init tasks, update GitLab config

### Fix

- **test**: curl via docker compose and set Gitlab URL to <http://gitlab:80>
- **ttyd_steps.js**: replace hardcoded 127.0.0.1 with detected Docker host

### Refactor

- fix task command syntax and add GitLab diagnostics

## 21.5.5 (2026-03-19)

### Fix

- **deps**: update dependency codeceptjs to v3.7.7

## 21.5.4 (2026-03-16)

### Fix

- **deps**: update commitlint monorepo to v20.5.0

## 21.5.3 (2026-03-14)

### Fix

- **deps**: update dependency copier to v9.14.0

## 21.5.2 (2026-03-13)

### Fix

- **deps**: update commitlint monorepo to v20.4.4

## 21.5.1 (2026-03-11)

### Fix

- **deps**: update gitlab/gitlab-ce docker tag to v18.9.2

## 21.5.0 (2026-03-11)

### Feat

- update GitLab e2e tests for v18 and add container down/destroy tasks

### Fix

- **deps**: update gitlab/gitlab-ce docker tag to v18

## 21.4.1 (2026-03-09)

### Fix

- **deps**: update dependency copier to v9.13.1

## 21.4.0 (2026-03-09)

### Feat

- **task**: improve install script with sudo fallback and version pinning
- **task**: add sudo removal of binary in install script, test and cspell
- **renovate**: add go-task version tracking and pin Taskfile install

### Fix

- **deps**: update gitlab/gitlab-ce docker tag to v17.11.7

## 21.3.2 (2026-03-07)

### Fix

- **project-token.sh**: switch to Bearer auth header for API calls
- **project-token.sh**: use PRIVATE-TOKEN header and simplify verification
- **config**: enhance CI token verification and correct yaml list indent
- **deps**: update dependency gitlab-org/cli to v1.89.0

## 21.3.1 (2026-03-06)

### Fix

- **renovate**: add extractVersionTemplate for glab version tracking

## 21.3.0 (2026-03-06)

### Feat

- **init**: add unzip prerequisite tasks, bootstrap test, rename port

### Refactor

- **python**: centralize version file and improve uv install flow

## 21.2.4 (2026-03-06)

### Fix

- **deps**: update dependency @types/node to v24.12.0

## 21.2.3 (2026-03-06)

### Fix

- **deps**: update dependency @types/node to v24.11.1

## 21.2.2 (2026-03-05)

### Fix

- **deps**: update dependency copier to v9.13.0

## 21.2.1 (2026-03-05)

### Fix

- **deps**: update python docker tag to v3.14

## 21.2.0 (2026-03-05)

### Feat

- **node**: add retry logic to Node install script and related tests
- switch Commitizen from SSH deploy key to project access token

### Refactor

- **release**: rename lock-default-branch task to glab namespace
- **gitlab**: rename lock-default-branch task and add helper
- **devsecops**: use project-token, add lock-default-branch task

## 21.1.1 (2026-03-04)

### Fix

- **deps**: update commitlint monorepo to v20.4.3

## 21.1.0 (2026-03-04)

### Feat

- **glab**: add protected‑branch task, script, tests; fix key newline

## 21.0.0 (2026-03-04)

### Feat

- **renovate**: drop prConcurrentLimit, add rule to ignore Docker image
- **deploy-key**: add verification and idempotent tests for setup
- add GitLab deploy key task, script, and end‑to‑end tests
- **gitlab**: add protected‑branch page, steps, feature and config updates
- **gitlab**: add default‑branch configuration support and related tests

### Refactor

- share fresh HTTP helpers, extract scroll helper, rename port

## 20.0.0 (2026-03-03)

### Feat

- **ci**: add idempotent token verification and exclude .claude checks
- **devsecops**: add test coverage check script, task and CI job
- **gitlab**: add idempotent, resync and dedup scenarios with freshGet
- **renovate-token**: add token verification, sync check and tests
- add Renovate token task, script and tests; update configs
- **glab**: replace merge-method task with configurable merge-settings
- **copier**: add post‑copy devsecops:init task and update tests
- **glab**: improve merge method error message and add test scenario
- **glab**: prefer Homebrew install and add it to cross‑platform test matrix
- add DevSecOps init, GitLab merge‑method, jq installer, and CI tests
- **gitlab**: add public project creation feature and related tests
- **tests**: add lambda user test support and related config
- **gitlab**: add GitLab CE test service, CI env, docs and related tasks

### Fix

- **renovate-token**: use Bearer header and disable xtrace to hide token

### Refactor

- **gitlab**: rename Promise callback param to resolve for clarity
- **devsecops**: simplify init and plan tasks, remove token setup

## 19.2.9 (2026-03-03)

### Fix

- **deps**: update dependency lizard to v1.21.2

## 19.2.8 (2026-03-01)

### Fix

- **deps**: update dependency mega-linter-runner to v9.4.0

## 19.2.7 (2026-03-01)

### Fix

- **deps**: update dependency @types/node to v24.11.0

## 19.2.6 (2026-02-27)

### Fix

- **deps**: update dependency @types/node to v24.10.15

## 19.2.5 (2026-02-26)

### Fix

- **deps**: update dependency commitizen to v4.13.9

## 19.2.4 (2026-02-24)

### Fix

- **deps**: update dependency ansible-core to v2.20.3

## 19.2.3 (2026-02-22)

### Fix

- **deps**: update dependency copier to v9.12.0

## 19.2.2 (2026-02-20)

### Fix

- **deps**: update commitlint monorepo to v20.4.2

## 19.2.1 (2026-02-20)

### Fix

- **deps**: update dependency commitizen to v4.13.8

## 19.2.0 (2026-02-16)

### Feat

- **gitleaks**: add selective copy to Taskfile and comprehensive tests

## 19.1.0 (2026-02-16)

### Feat

- **megalinter**: add base config, inheritance support and related tests

### Refactor

- **tests**: extract file helpers and normalize docstring handling

## 19.0.3 (2026-02-11)

### Fix

- **deps**: update dependency @types/node to v24.10.13

## 19.0.2 (2026-02-11)

### Fix

- **deps**: update dependency commitizen to v4.13.7

## 19.0.1 (2026-02-09)

### Fix

- **deps**: update commitlint monorepo to v20

## 19.0.0 (2026-02-09)

### Feat

- **gitleaks**: use docker exec/cp pattern and add ignore paths
- **gitleaks**: add proxy argument handling and tests
- **megalinter**: add proxy handling and related tests

### Fix

- **tests**: export register after invoking it to ensure proper init

### Refactor

- **jinja**: wrap agent docs with raw blocks for proper template rendering
- **taskfile**: rename side_effect tasks to side-effect
- **copier**: remove unused import and dead code from test step object
- **config**: drop unused scenario ID generator and legacy base path
- **taskfile**: prefix tasks with project: and add flatten include
- **tests**: centralize file existence steps in content.js and delete kubeseal step
- **ci**: remove proxy configuration support and related tests

## 18.0.4 (2026-02-08)

### Fix

- **deps**: update dependency commitizen to v4.13.6

## 18.0.3 (2026-02-08)

### Fix

- **deps**: update dependency @types/node to v24.10.12

## 18.0.2 (2026-02-07)

### Fix

- **deps**: update mcr.microsoft.com/playwright docker tag to v1.58.2

## 18.0.1 (2026-02-07)

### Fix

- **deps**: update dependency playwright to v1.58.2

## 18.0.0 (2026-02-06)

### Feat

- **gitlab-ci**: add conditional Docker variables, prompts, and tests
- **dev**: add lefthook to setup-environment and tests for Taskfile
- **proxy**: split proxy_urls into http_proxy, https_proxy and no_proxy

## 17.2.5 (2026-02-06)

### Fix

- **deps**: update dependency commitizen to v4.13.5

## 17.2.4 (2026-02-06)

### Fix

- **deps**: update dependency @types/node to v24.10.11

## 17.2.3 (2026-02-05)

### Fix

- **deps**: update dependency lizard to v1.21.0

## 17.2.2 (2026-02-05)

### Fix

- **deps**: update dependency commitizen to v4.13.4

## 17.2.1 (2026-02-05)

### Fix

- **deps**: update dependency @types/node to v24.10.10

## 17.2.0 (2026-02-01)

### Feat

- **scaffolding**: add Docker Compose generation with tests

## 17.1.0 (2026-02-01)

### Feat

- **renovate**: add configurable automerge and test suite

## 17.0.1 (2026-02-01)

### Fix

- **deps**: update dependency commitizen to v4.13.0

## 17.0.0 (2026-02-01)

### Feat

- **dev**: add glab installation to development environment setup
- **taskfiles**: add emojis, summaries and docs; rename server port var
- **git**: rename var to TASK_GIT_CONFIG_DIR, add summary and tests
- **sealed-secrets**: add Taskfile and BDD test for sealed-secrets setup
- **kubeseal**: add Taskfile, tests and cspell entry
- **glab**: add GitLab CLI integration with taskfiles, scripts, and tests
- **tests**: rename copier steps to commitizen/devsecops and add tests
- **tests**: restructure test framework, add step objects and docs
- **tests**: add generic copier step definitions for project generation
- **tests**: add content step definitions for file and dir assertions
- **tests**: add steps index to register all test step modules
- **devsecops**: add cucumber step definitions for project mode testing
- **tests**: add Ansible domain step definitions for integration testing
- **tests**: add BDD feature for Project Taskfile configuration
- **Taskfile**: add checks to ensure no blank lines in Taskfile.yml and its includes section
- **devsecops**: add sync-templates task to Taskfile and update tests to verify its presence

### Refactor

- **tests**: consolidate step registration into single module

## 16.4.8 (2026-02-01)

### Fix

- **deps**: update mcr.microsoft.com/playwright docker tag to v1.58.1

## 16.4.7 (2026-02-01)

### Fix

- **deps**: update dependency playwright to v1.58.1

## 16.4.6 (2026-01-30)

### Fix

- **deps**: update dependency ansible-core to v2.20.2

## 16.4.5 (2026-01-24)

### Fix

- **deps**: update mcr.microsoft.com/playwright docker tag to v1.58.0

## 16.4.4 (2026-01-24)

### Fix

- **deps**: update dependency playwright to v1.58.0

## 16.4.3 (2026-01-24)

### Fix

- **deps**: update dependency copier to v9.11.3

## 16.4.2 (2026-01-23)

### Fix

- **deps**: update dependency commitizen to v4.12.1

## 16.4.1 (2026-01-21)

### Fix

- **deps**: update dependency copier to v9.11.2

## 16.4.0 (2026-01-20)

### Feat

- **copier**: exclude .agent from copier configuration and update tests accordingly

## 16.3.1 (2026-01-20)

### Fix

- **deps**: update dependency commitizen to v4.12.0

## 16.3.0 (2026-01-19)

### Feat

- **container-runtime**: add support for Docker and Podman as container runtimes with corresponding tests and configurations

## 16.2.0 (2026-01-18)

### Feat

- **proxy**: add proxy configuration support for GitLab CI/CD with related tests and environment variables
- **workflow**: add new Copier template feature workflow with TDD guidelines and Gherkin tests

## 16.1.6 (2026-01-18)

### Fix

- **deps**: update dependency yamllint to v1.38.0

## 16.1.5 (2026-01-18)

### Fix

- **deps**: update dependency lizard to v1.20.0

## 16.1.4 (2026-01-18)

### Fix

- **deps**: update dependency copier to v9.11.1

## 16.1.3 (2026-01-18)

### Fix

- **deps**: update dependency commitizen to v4.11.6

## 16.1.2 (2026-01-18)

### Fix

- **deps**: update dependency codeceptjs to v3.7.6

## 16.1.1 (2026-01-18)

### Fix

- **deps**: update dependency @types/node to v24.10.9

## 16.1.0 (2026-01-18)

### Feat

- **tests**: add CI platform specific steps for copier command execution and project updates to enhance testing capabilities
- **tests**: add GitLab CI specific assertions to validate tags configuration and runner usage
- **tests**: add GitLab specific step definitions for tags tests and CI platform generation
- **copier.yml**: add ci_platform question to specify CI/CD platform options
- **ci**: add conditional tag for GitLab SaaS platform in CI configuration
- **tests**: add GitLab CI tags feature tests for SaaS and Self-Hosted configurations
- **ci**: add GitLab CI configuration for code quality checks and rules

### Fix

- **entrypoint.js**: clean scenario names by removing tags from test titles for better readability

## 16.0.9 (2026-01-18)

### Fix

- **deps**: update dependency mega-linter-runner to v9.3.0

## 16.0.8 (2025-12-30)

### Fix

- **deps**: update dependency commitizen to v4.11.0

## 16.0.7 (2025-12-14)

### Fix

- **deps**: update dependency @types/node to v24.10.4

## 16.0.6 (2025-12-12)

### Fix

- **deps**: update dependency commitizen to v4.10.1

## 16.0.5 (2025-12-11)

### Fix

- **deps**: update dependency @types/node to v24.10.3

## 16.0.4 (2025-12-10)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.2.3

## 16.0.3 (2025-12-10)

### Fix

- **tables.js**: enhance getTableRows function to handle empty tables and improve column value extraction logic

## 16.0.2 (2025-12-09)

### Fix

- **deps**: update dependency mega-linter-runner to v9.2.0

## 16.0.1 (2025-12-09)

### Fix

- **deps**: update dependency ansible-core to v2.20.1

## 16.0.0 (2025-12-09)

### Feat

- **gitlab**: add script to list GitLab projects in a tree format with output options
- **megalinter**: update TASK_MEGALINTER_VERSION to use grep and sed for better compatibility with package.json format
- **megalinter**: update Taskfile.yml to use dynamic versioning for mega-linter-runner and add package.json for dependency management
- **Taskfile**: add init task to streamline development environment setup process
- **codeceptjs**: add Docker task for running CodeceptJS with Playwright to ensure consistent test environments across platforms
- **create-issues.sh**: add script for idempotent GitLab issue creation and update with dry-run support
- **docker-compose**: add sample docker-compose configuration for CodeceptJS to streamline testing setup
- **codeceptjs**: add Dockerfile for setting up CodeceptJS environment with Bun for faster dependency management
- upgrade lock file

### Fix

- **create-issues.sh**: update French messages to English for consistency and clarity
- **check-build-coverage.sh**: enhance task extraction logic to support flattening and improve namespace handling in build tasks

## 15.2.2 (2025-12-09)

### Fix

- **deps**: update dependency @types/node to v24.10.2

## 15.2.1 (2025-12-03)

### Fix

- **deps**: update dependency @digital-commons-official/codeceptjs-visual-helper to v1.2.1

## 15.2.0 (2025-12-01)

### Feat

- **Taskfile.yml**: refactor task variables to improve package management and installation process for CodeceptJS and Playwright
- **Taskfile.yml**: update playwright installation commands to use version variable for consistency in CI environments
- **Taskfile.yml**: streamline package version retrieval and installation commands for CodeceptJS and Playwright
- **Taskfile.yml**: add version variables for CodeceptJS and dependencies to ensure consistent package usage

### Fix

- **package.json**: update devDependencies for CodeceptJS and TypeScript to latest versions for improved stability and features

## 15.1.1 (2025-11-29)

### Fix

- **renovate_plugin_only.feature**: update feature description to reflect correct versioning terminology for clarity
- **default.feature**: update scenario step to reflect correct terminology for DevSecOps tool
- **copier.js**: update step definition to reflect correct terminology from 'plugin' to 'toolbox' for clarity

## 15.1.0 (2025-11-29)

### Feat

- **ci**: add input variables for DevSecOps release task and feedback schedule in GitLab CI configuration

### Fix

- **ci**: update RUN_FEEDBACK_SCHEDULE variable type to boolean and adjust its default value for consistency in feedback configuration
- **renovate**: update task command syntax and correct matchPaths to matchFileNames in configuration tests
- **renovate**: update allowed commands and match paths for better dependency management and automation

## 15.0.0 (2025-11-29)

### Feat

- **Taskfile**: update codeceptjs visual helper package to use official version from digital-commons-official

## 14.4.4 (2025-11-29)

### Fix

- **deps**: update dependency playwright to v1.57.0

## 14.4.3 (2025-11-29)

### Fix

- **deps**: update dependency copier to v9.11.0

## 14.4.2 (2025-11-29)

### Fix

- **deps**: update dependency @types/node to v24.10.1

## 14.4.1 (2025-11-29)

### Fix

- **Taskfile.yml**: remove sudo from go installation command for better compatibility

## 14.4.0 (2025-11-29)

### Feat

- **install.sh**: enhance Go installation script to configure GOROOT and GOPATH with symlink creation for compatibility
- **Taskfile**: add environment variables for GOROOT, GOPATH, and PATH to enhance Go development setup
- **dev**: add Go installation script to development setup tasks for improved environment configuration
- **Taskfile**: add flatten option for project taskfile and prefix tasks for better organization and clarity
- **copier**: enable project workspace by default and update related tests and scenarios for project mode integration

### Fix

- **install.sh**: remove space before output redirection to ensure correct file creation
- **Taskfile.yml**: improve exclusion argument handling in lizard analysis to support spaces in patterns
- **Taskfile.yml**: update go installation command to use sudo for proper permissions
- **Taskfile**: add lefthook task to the development environment setup for improved pre-commit checks
- **ci**: update Docker-in-Docker service version from 24.0.5 to 29 to ensure compatibility and improvements

## 14.3.1 (2025-11-11)

### Fix

- **deps**: update dependency commitizen to v4.10.0

## 14.3.0 (2025-11-05)

### Feat

- **entrypoint.js**: add project.js step definition to enhance test coverage
- **copier.yml**: add project_enabled question to configure project workspace management during setup
- **tests**: add feature tests for project mode integration in copier functionality to ensure expected behavior with and without project mode
- **tests**: add step definitions for Project mode optional feature testing to enhance test coverage and isolation
- **linter**: add initial Megalinter configuration file for improved code quality checks
- **devsecops**: add Taskfile for managing test infrastructure and tasks
- **devsecops**: add Taskfile.release.yml.jinja for managing release tasks and configurations
- **devsecops**: add Taskfile.plan.yml.jinja for managing DevSecOps planning tasks
- **devsecops**: add Taskfile for operate tasks to streamline DevSecOps processes
- **devsecops**: add Taskfile.monitor.yml.jinja for monitoring tasks configuration
- **devsecops**: add Taskfile.feedback.yml.jinja for managing feedback tasks in the DevSecOps pipeline
- **devsecops**: add Taskfile.deploy.yml.jinja for deployment automation tasks
- **devsecops**: add Taskfile for managing code tasks and project templates in DevSecOps environment
- **devsecops**: add Taskfile.build.yml.jinja for managing build tasks in the DevSecOps pipeline

### Fix

- **ansible.js**: update copier command to include --defaults for consistency in Ansible tests
- **Taskfile.yml.jinja**: conditionally include project taskfile based on project_enabled flag to enhance configurability

## 14.2.1 (2025-11-05)

### Fix

- **deps**: update dependency ansible-core to v2.20.0

## 14.2.0 (2025-11-04)

### Feat

- **ansible**: add copier configuration for Ansible setup questions and exclusions
- **tests**: add default feature tests for project scaffolding with Copier to ensure correct project generation and configuration
- **tests**: add Ansible integration feature tests for project generation and updates
- **tests**: add scenarios for generating and updating projects with Ansible integration options
- **ansible.js**: add new step definitions for Ansible project generation and validation in end-to-end tests
- **entrypoint.js**: add ansible step definitions to enhance test coverage
- **copier.yml**: add Ansible integration option to enable infrastructure automation
- **tests**: add Ansible optional integration feature test for project generation without Ansible
- **tests**: add end-to-end tests for Ansible optional feature in copier command
- **Taskfile**: add a new Taskfile.yml.jinja for orchestrating development operations and DevSecOps workflows

### Fix

- **ansible.js**: update Ansible command data flags from ansible=true/false to ansible_enabled=true/false for consistency and clarity
- **Taskfile**: update conditional check for ansible to ansible_enabled for clarity and accuracy
- **copier.yml**: rename ansible key to ansible_enabled for clarity in configuration options
- **ansible.js**: update test steps to reflect enabling Ansible and simplify taskfile reference assertions
- **copier.yml**: update default value of ansible from true to false to reflect configuration needs
- **copier.js**: always regenerate project directory to ensure consistent state with all features enabled

## 14.1.9 (2025-11-04)

### Fix

- **deps**: update dependency lizard to v1.19.0

## 14.1.8 (2025-11-04)

### Fix

- **deps**: update dependency @types/node to v24.10.0

## 14.1.7 (2025-10-29)

### Fix

- **deps**: update dependency @types/node to v24.9.2

## 14.1.6 (2025-10-29)

### Fix

- **deps**: update dependency @types/node to v24

## 14.1.5 (2025-10-21)

### Fix

- **deps**: update dependency @types/node to v22.18.12

## 14.1.4 (2025-10-17)

### Fix

- **deps**: update dependency playwright to v1.56.1

## 14.1.3 (2025-10-17)

### Fix

- **deps**: update dependency copier to v9.10.3

## 14.1.2 (2025-10-17)

### Fix

- **deps**: update dependency @types/node to v22.18.11

## 14.1.1 (2025-10-14)

### Fix

- **ci**: add color settings for terminal output in GitLab CI variables configuration

## 14.1.0 (2025-10-14)

### Feat

- **setup-docker.sh**: add check and creation of docker group if it doesn't exist to enhance setup process
- **megalinter**: add new variables and npx task for running MegaLinter locally without Docker

### Fix

- **megalinter**: update post commands to check for directory existence before changing permissions and ownership to prevent errors

## 14.0.0 (2025-10-11)

### Feat

- **codecept.conf.js**: add output directory for CodeceptJS test results to organize generated files
- **lefthook**: add gitleaks command to pre-commit hooks for security checks
- **Taskfile**: add support for additional environment files and include new taskfiles for git and gitleaks
- **renovate**: enhance configuration to support DevSecOps updates and auto-detect project dependencies
- **ci**: update test job to use Ubuntu 24.04 image and add artifacts for diagnostics and project files on failure
- **ci**: add pipx installation of copier in feedback CI job for enhanced task management
- **ci**: enhance CI configuration by adding gitleaks job and refining rules for scheduled pipelines and specific tags/branches
- **devsecops**: add build coverage validation task to ensure Docker Compose files have corresponding build tasks
- **devsecops**: add gitleaks scan-branch task to enhance security checks
- **install.sh**: add installation script for Python3 on Debian/Ubuntu systems
- **install.sh**: add installation script for Node.js with support for multiple package managers
- **gitleaks**: add Taskfile configuration for gitleaks to scan for secrets in repository and staged files
- **ci**: add GitLab CI cache configuration for Playwright to optimize pipeline performance
- **Taskfile**: add Taskfile.yml for managing Git tasks and hooks installation
- **docker**: add installation script for Docker CLI to streamline setup process
- **devsecops**: add a script to check Docker Compose build coverage against Taskfiles for improved validation

### Fix

- **commitizen**: remove unnecessary version files from configuration to streamline version management
- **deps**: update dependency @types/node to v22.18.10
- **ci**: update gitleaks task from 'gitleaks:ci' to 'gitleaks:scan-branch' for accurate scanning functionality
- **renovate**: update feature file to reflect changes in configuration keys for Renovate plugin settings
- **Taskfile.yml**: update CMD to include package flag for renovate command to ensure proper execution
- **Taskfile**: update codeceptjs task to use npx for better execution context

## 13.1.22 (2025-10-09)

### Fix

- **deps**: update dependency @types/node to v22.18.9

## 13.1.21 (2025-10-06)

### Fix

- **deps**: update dependency playwright to v1.56.0

## 13.1.20 (2025-10-06)

### Fix

- **deps**: update dependency ansible-core to v2.19.3

## 13.1.19 (2025-10-02)

### Fix

- **deps**: update dependency @codeceptjs/ui to v1.3.8

## 13.1.18 (2025-10-01)

### Fix

- **deps**: update dependency lizard to v1.18.0

## 13.1.17 (2025-09-30)

### Fix

- **deps**: update dependency @types/node to v22.18.8

## 13.1.16 (2025-09-30)

### Fix

- **deps**: update dependency typescript to v5.9.3

## 13.1.15 (2025-09-29)

### Fix

- **deps**: update dependency @types/node to v22.18.7

## 13.1.14 (2025-09-23)

### Fix

- **deps**: update dependency playwright to v1.55.1

## 13.1.13 (2025-09-23)

### Fix

- **deps**: update dependency codeceptjs to v3.7.5

## 13.1.12 (2025-09-22)

### Fix

- **deps**: update codeceptjs/codeceptjs docker tag to v3.7.5

## 13.1.11 (2025-09-18)

### Fix

- **deps**: update dependency @types/node to v22.18.6

## 13.1.10 (2025-09-16)

### Fix

- **deps**: update dependency @types/node to v22.18.5

## 13.1.9 (2025-09-15)

### Fix

- **deps**: update dependency @types/node to v22.18.4

## 13.1.8 (2025-09-13)

### Fix

- **deps**: update dependency @types/node to v22.18.3

## 13.1.7 (2025-09-10)

### Fix

- **deps**: update dependency commitizen to v4.9.1

## 13.1.6 (2025-09-09)

### Fix

- **deps**: update dependency copier to v9.10.2

## 13.1.5 (2025-09-08)

### Fix

- **deps**: update dependency ansible-core to v2.19.2

## 13.1.4 (2025-09-08)

### Fix

- **ci**: reorder rules in code.yml for better clarity and organization

## 13.1.3 (2025-09-07)

### Fix

- **ci**: update comments and reorder rules in code.yml for clarity and consistency

## 13.1.2 (2025-09-07)

### Fix

- **commitizen**: add changelog_file configuration to specify changelog location

## 13.1.1 (2025-09-07)

### Fix

- **changelog**: update changelog to reflect new features, fixes, and refactors for version 13.1.0 and previous versions

## 13.1.0 (2025-09-07)

### Feat

- **copier.js**: add git tag command to mark the initial version of the project
- **ci**: restructure GitLab CI configuration to implement multiple code checks in parallel and improve maintainability
- **install.sh**: add installation script for UV to ensure proper setup if not present
- **install.sh**: add a script for automatic installation of unzip across various Linux distributions
- **install.sh**: add installation script for Taskfile to automate setup process
- **install.sh**: add a script for automated pipx installation across various Linux distributions
- **install.sh**: add a generic script for installing git on common Linux distributions
- **curl**: add generic curl installation script for common Linux distros to simplify setup process

## 13.0.11 (2025-09-05)

### Fix

- **deps**: update dependency commitizen to v4.8.4

## 13.0.10 (2025-09-04)

### Fix

- **deps**: update dependency @types/node to v22.18.1

## 13.0.9 (2025-09-01)

### Fix

- **deps**: update dependency @codeceptjs/ui to v1.3.7

## 13.0.8 (2025-08-30)

### Fix

- **deps**: update dependency copier to v9.10.1

## 13.0.7 (2025-08-30)

### Fix

- **deps**: update dependency @types/node to v22.18.0

## 13.0.6 (2025-08-30)

### Fix

- **deps**: update dependency ansible-core to v2.19.1

## 13.0.5 (2025-08-29)

### Fix

- **deps**: update dependency @codeceptjs/ui to v1.3.1

## 13.0.4 (2025-08-25)

### Fix

- **deps**: update dependency commitizen to v4

## 13.0.3 (2025-08-25)

### Fix

- **deps**: update dependency yamllint to v1.37.1

## 13.0.2 (2025-08-25)

### Fix

- **deps**: update dependency typescript to v5.9.2

## 13.0.1 (2025-08-25)

### Fix

- **deps**: update dependency playwright to v1.55.0

## 13.0.0 (2025-08-25)

### Fix

- **feedback.yml**: update needs section to include optional release job for better job dependency management

## 12.6.5 (2025-08-24)

### Fix

- **deps**: update dependency commitizen to v3.31.0

## 12.6.4 (2025-08-24)

### Fix

- **deps**: update dependency ansible-core to v2.19.0

## 12.6.3 (2025-08-24)

### Fix

- **deps**: update dependency @types/node to v22.17.2

## 12.6.2 (2025-08-24)

### Fix

- **deps**: update dependency @codeceptjs/ui to v1.3.0

## 12.6.1 (2025-08-24)

### Fix

- **deps**: update dependency lizard to v1.17.31

## 12.6.0 (2025-08-24)

### Feat

- **linter**: add pnpm task to run megalinter using pnpm dlx for improved linting process
- **yamllint**: add support for specifying Python version in Taskfile.yml for improved compatibility
- **taskfile**: add new variables for Python version and command to enhance configurability of lizard analysis tasks
- **Taskfile**: add support for dynamic Python version retrieval in copier tasks to enhance flexibility
- **commitizen**: add Python version handling to Taskfile for better compatibility with Python environments
- **ansible**: add Python version handling to Taskfile for improved compatibility

### Refactor

- **ansible**: streamline Ansible command handling and remove deprecated virtualenv references for improved clarity and functionality

## 12.5.0 (2025-08-22)

### Feat

- **devcontainer**: add Python 3.12 and related packages to install script for enhanced development environment
- **devcontainer**: add script to install UV for Python environment setup

### Fix

- **install-uv.sh**: add quotes around command substitution for safer parsing of Python version

## 12.4.2 (2025-08-22)

### Fix

- **ci**: update TASK_RENOVATE_REPOSITORY variable to use CI_PROJECT_PATH for accuracy

## 12.4.1 (2025-08-22)

### Feat

- **commitizen**: add TASK_COMMITIZEN_COMMAND to define default command for commitizen tasks
- **ci**: add pipx installation and setup for managing Python packages in before_script configuration

### Fix

- **Taskfile.feedback.yml**: enhance current branch resolution logic to prioritize CI variables before falling back to git commands

## 12.4.0 (2025-08-22)

## 12.3.1 (2025-08-21)

### Feat

- **Taskfile.feedback.yml**: add echo commands to display Git and Renovate variables for better debugging

### Fix

- **ci**: update pipeline rules to allow non-push sources and restrict blocking conditions for better flexibility

## 12.3.0 (2025-08-20)

### Feat

- **ci**: extend default tags in the DevSecOps plan configuration for better consistency
- **ci**: extend monitor job with default tags for improved configuration management
- **ci**: extend feedback job with default tags for better configuration management
- **ci**: add project-specific runner tags configuration for CI jobs
- **ci**: add test job configuration for DevSecOps pipeline in GitLab CI
- **ci**: add release configuration for GitLab CI to manage Docker tasks and scheduling rules
- **ci**: add operate job configuration for scheduled pipeline execution in GitLab CI
- **ci**: add monitor job configuration for scheduled pipeline execution in GitLab CI
- **ci**: add feedback job to CI pipeline for scheduled tasks and conditions
- **ci**: add deploy configuration for GitLab CI to manage deployment rules and scheduling
- **ci**: add DevSecOps code job configuration for GitLab CI pipeline
- **ci**: add build configuration for DevSecOps pipeline to enhance CI/CD process
- **ci**: add DevSecOps plan configuration for scheduled pipeline execution
- **ci**: add GitLab CI workflow rules to manage pipeline execution conditions
- **ci**: add stages configuration for GitLab CI to define the pipeline flow
- **ci**: add before_script configuration to install Taskfile and initialize environment
- **ci**: update GitLab CI configuration to refine pipeline rules for better control over job execution based on commit tags and branches

## 12.2.0 (2025-08-20)

## 12.1.3 (2025-08-20)

### Fix

- **deps**: update dependency codeceptjs to v3.7.4

## 12.1.2 (2025-08-20)

### Fix

- **copier**: update copier version from 9.4.1 to 9.9.1 for improved features and fixes
- **deps**: update codeceptjs/codeceptjs docker tag to v3.7.4

## 12.1.1 (2025-08-19)

### Feat

- **ci**: add renovate variables for repository and platform in CI configuration
- **devsecops**: add default branch variable and check for current branch in Taskfile for enhanced feedback tasks
- **devsecops**: add renovate task to validate Renovate configuration during the code phase
- **renovate**: add support for GitLab platform and enhance task descriptions for clarity
- **Taskfile.feedback.yml**: add renovate task to feedback phase for improved dependency management
- **renovate**: add log level variable to Taskfile for better logging control
- **tests**: add assertFileContains function to verify file content includes expected substring
- **Taskfile**: add CodeceptJS configuration and enablement variables for testing setup
- **Taskfile**: add renovate taskfile inclusion for better automation management
- **tests**: add feature test for Renovate plugin-only configuration to ensure correct project generation
- **renovate**: add Renovate configuration for managing dependencies with regex manager
- **renovate**: add Taskfile.yml for managing Renovate tasks and configurations

### Fix

- **deps**: update dependency @codeceptjs/ui to v1.2.5
- **renovate**: change default platform from gitlab to local and update environment variable handling for consistency
- **Taskfile.feedback.yml**: simplify renovate task command by removing unnecessary run suffix
- **renovate**: update enabledManagers and configuration fields in renovate_plugin_only.feature to reflect new plugin requirements
- **Taskfile.yml**: specify package for renovate-config-validator command to ensure correct execution

### Refactor

- **renovate**: enhance Taskfile with safer shell practices and improved command construction for Renovate execution

## 12.1.0 (2025-07-02)

### Feat

- **README**: add installation instructions for Taskfile to enhance setup guidance

## 12.0.1 (2025-06-18)

### Fix

- **ci**: update GitLab CI configuration by removing unused dependency proxy login script and adding CodeceptJS runner variable
- **README**: update license description from French to English for clarity

## 12.0.0 (2025-06-18)

### Feat

- **ci**: add TASK_CODECEPTJS_COMMAND to create Docker directory and link certificates for CodeceptJS execution
- **codeceptjs**: enhance Taskfile with additional Docker configuration options and improve command structure for running tests
- **ci**: add dependency proxy login logic to GitLab CI configuration for improved security and flexibility
- **megalinter**: add TASK_MEGALINTER_IMAGE_PREFIX variable for customizable image prefix in Taskfile configuration
- **devcontainer**: add Ubuntu dev container configuration for improved development environment setup
- **setup-user.sh**: add script to set up a non-root user with sudo access and shell configurations in the devcontainer environment
- **setup-proxy.sh**: add script to configure HTTP, HTTPS, and FTP proxy settings for development environment
- **setup-go.sh**: add script to configure Go environment variables system-wide
- **setup-docker.sh**: add script to configure Docker for the development environment
- **devcontainer**: add script to install Taskfile for development environment setup
- **devcontainer**: add script to install necessary packages for development environment setup
- **devcontainer**: add init.sh script to orchestrate the setup process for the development container
- **cleanup.sh**: add cleanup script for environment cleanup and resource management
- **devcontainer**: add Dockerfile for development container setup with necessary configurations and scripts

### Fix

- **Taskfile.yml**: simplify Docker run options by removing unnecessary flags for cleaner configuration
- **Taskfile.yml**: update Dockerfile path from debian to ubuntu for consistency with environment setup
- **kaniko**: update Dockerfile path from debian to ubuntu and change base image to ubuntu:24.04 for consistency with project requirements
- **docker-compose**: switch service from debian to ubuntu for better compatibility and updated user settings

## 11.0.0 (2025-06-16)

### Feat

- **tests**: add project scaffolding feature tests for Copier template generation and validation
- **python**: update Python version from 3.11 to 3.12 for compatibility improvements

### Fix

- **codecept.conf.js**: update feature path to correct relative location for Gherkin integration

## 10.1.0 (2025-06-07)

### Feat

- **ci**: remove unnecessary dependencies in GitLab CI stages to allow parallel execution of jobs

## 10.0.1 (2025-06-07)

### Fix

- **Taskfile.yml**: change default value of TASK_BUN_ENABLED from false to true to enable bun tasks by default

## 10.0.0 (2025-06-06)

### Feat

- breaking change
- **tests**: add diagnostic logging for git configuration in e2e tests to ensure proper setup and identity configuration for CI environment
- **env**: add TASK_CODECEPTJS_ENABLED variable to enable task configuration for CodeceptJS tests
- **tests**: add entrypoint.js.jinja for loading step definitions in e2e tests
- **tests**: add entrypoint.js to load step definitions for e2e tests
- **tests**: add end-to-end tests for the copier functionality to ensure project generation and validation of expected files and directories
- **tests**: add CodeceptJS configuration file for end-to-end testing setup
- **copier**: add project scaffolding feature to generate projects from templates for improved setup efficiency
- **codeceptjs**: add sample configuration file for CodeceptJS to streamline testing setup and provide default settings

### Fix

- **Taskfile.yml**: change default value of TASK_GO_ENABLED from false to true to enable Go tasks by default
- **Taskfile.yml**: change default value of TASK_PODMAN_ENABLED from true to false to prevent unintended podman usage
- **Taskfile.yaml**: change default value of TASK_KUBESEAL_ENABLED to false and clear default values for KUBECONFIG, SECRETS_FILE, and SEALED_FILE to enhance flexibility in configuration
- **Taskfile.yml**: change default value of TASK_K3D_ENABLED to false and remove default path for TASK_K3D_KUBECONFIG_DIR to enhance configuration flexibility
- **Taskfile.yml**: change default value of TASK_HELM_ENABLED to false and TASK_HELM_DIR to an empty string to prevent unintended behavior in helm tasks
- **Taskfile.yml**: change default value of TASK_GO_ENABLED from true to false to disable Go tasks by default
- **cspell**: update ignore patterns to reflect new project structure for sealed-secrets.yaml and secrets.yaml files
- **Taskfile.yml**: change default value of TASK_CODECEPTJS_ENABLED to false and update TASK_CODECEPTJS_CONFIG to point to sample config file to prevent unintended test runs in CI environments
- **Taskfile.yml**: change default value of TASK_BUN_ENABLED from true to false to prevent unintended task execution

### Refactor

- **Taskfile.yml**: replace hardcoded kubeconfig paths with a variable for better maintainability and flexibility

## 9.3.0 (2025-05-14)

### Feat

- **Taskfile.test.yml**: add helm dependency update task to ensure all dependencies are up to date before installation
- **Taskfile.yml**: add TASK_K3D_LOAD_IMAGE_RUN_TYPE variable to configure image run type dynamically

## 9.2.0 (2025-05-11)

### Feat

- add VERSION.jinja file to define the application version

## 9.1.0 (2025-05-11)

### Feat

- **copier.yml**: add _skip_if_exists configuration to prevent overwriting existing files during template generation

### Fix

- **copier-answers**: add YAML document start marker to ensure proper parsing of the file

## 9.0.2 (2025-05-11)

### Fix

- **copier.yml**: remove unnecessary _skip_if_exists configuration to simplify template setup

## 9.0.1 (2025-05-11)

### Fix

- **copier.yml**: remove obsolete migration for version 8.0.0 to clean up the configuration and simplify the file

## 9.0.0 (2025-05-10)

### Feat

- **Taskfile**: add copier test task to enhance project testing capabilities and ensure copier functionality
- **Taskfile**: add TASK_CODECEPTJS_GREP variable to CodeceptJS task for better test filtering options
- **ci**: add parallel execution for test jobs with different grep commands to enhance testing efficiency
- **project_scaffolding**: add tags for better categorization of the feature in the project scaffolding process
- **admin_authentication**: add tags for authentication, admin, login, and dashboard to enhance feature categorization and discoverability
- **Taskfile.test.yml**: enhance test infrastructure management with new destroy and cleanup options and restructure tasks for better clarity and flow
- **Taskfile.test.yml**: restructure test tasks to include infrastructure bootstrap and teardown phases for improved organization and clarity
- **ci**: add GitLab CI configuration for automated build, test, and deployment processes to streamline development workflow
- **ci**: add artifacts for build and pages jobs to ensure necessary files are available for subsequent stages
- **helm**: update build destination path and rename build task to package for clarity
- **docker**: add BuildKit support with caching options and save functionality for Docker images to enhance build performance and flexibility
- **index.html**: add initial HTML page for the Helm repository to provide documentation and usage instructions for users

### Fix

- **ci**: update test command to use project:test:copier for clarity and consistency in CI pipeline
- **copier.js**: update command execution to include TASK_CODECEPTJS_GREP variable for proper test execution in DevSecOps task
- **Taskfile.yml**: update task from reset to teardown:infrastructure for clarity in development environment reset process
- **Taskfile.yml**: increase timeout from 15m to 30m for project deployment to ensure sufficient time for completion
- **Taskfile.yml**: update TASK_DOCKER_CE_IMAGE_NAME to point to the correct Docker image path for the DevSecOps plugin
- **Taskfile.deploy.yml**: replace helm build task with helm package task to ensure proper packaging of Helm charts during deployment
- **Taskfile.build.yml**: change helm build task to helm package task to ensure correct packaging process during build phase

## 8.1.0 (2025-05-07)

### Feat

- **Taskfile.yml**: add TASK_K3D_FIX_DNS variable to control DNS fix option during cluster creation

## 8.0.0 (2025-05-05)

### Feat

- **tests**: add Ansible requirements file for infrastructure testing dependencies
- **copier.js**: enhance DevSecOps test task verification by adding steps to check task execution and success status
- **tests**: add end-to-end tests for the copier functionality to ensure project generation and validation of expected files and directories
- **entrypoint.js**: add copier step definitions to enhance test coverage and functionality
- **copier**: add project scaffolding feature tests to verify correct project structure and configuration after template generation
- **Taskfile**: add sync-templates task to streamline project template updates using a specific answers file
- **Taskfile**: add update task for project updates using Copier with specific answers file and preconditions for execution
- **commitizen**: add check-message task to validate commit message format using Commitizen for improved consistency and adherence to standards
- **ci**: add TASK_CODECEPTJS_CI variable to enable CodeceptJS in CI environment
- **Taskfile**: enhance task commands with informative echo statements for better user feedback and add troubleshooting tasks for pod status and logs
- **kaniko**: add logging messages for build and cache warmup processes to improve visibility and user feedback during execution
- **k3d**: enhance Taskfile with additional variables and tasks for improved cluster management and image loading capabilities
- **docker-ce**: enhance Taskfile.yml with improved variable handling and status messages for better clarity during execution phases
- **Taskfile.release.yml**: enhance release process with dynamic branch detection and improved logging for better user feedback during release tasks
- **Taskfile.plan.yml**: add logging for plan phase start and completion to enhance visibility during execution
- **Taskfile.operate.yml**: add logging for the start and completion of the operate phase to enhance visibility during execution
- **Taskfile.monitor.yml**: add monitor phase start and completion messages for better visibility during execution
- **Taskfile.feedback.yml**: add feedback phase start and completion messages to enhance user experience during task execution
- **Taskfile**: add start and completion messages for the code phase to improve user feedback during execution
- **Taskfile.build.yml**: add build phase start and completion messages for better feedback during the build process
- **Taskfile.yml**: add TASK_CODECEPTJS_CI variable to control CI behavior and improve task output messages for better clarity and user experience

### Fix

- **Taskfile.yml**: update TASK_CODECEPTJS_COMMAND to prevent failure on empty run by adding DONT_FAIL_ON_EMPTY_RUN environment variable
- **Taskfile.test.yml**: update path for TASK_ANSIBLE_COLLECTIONS_REQUIREMENTS_FILE to reflect new directory structure for Ansible requirements
- **ansible**: update path for TASK_ANSIBLE_COLLECTIONS_REQUIREMENTS_FILE to reflect the correct directory structure
- **Taskfile.yaml**: increase timeout from 5 minutes to 10 minutes for sealed-secrets deployment to ensure successful completion
- **lefthook**: add check for Git repository before running Lefthook installation to prevent errors when outside a repo
- **Taskfile.yml**: update default value for TASK_DOCKER_CE_DOCKERFILE to an empty string for better flexibility in Docker configurations
- **Taskfile.release.yml**: add check for Git repository before setting safe.directory and getting current branch to prevent errors in non-Git contexts
- **commitizen**: add check for Git repository in Taskfile to prevent errors when outside a repo and provide a default branch name
- **Taskfile.yml**: append CLI_ARGS to CODECEPTJS_RUN_COMMAND for enhanced command flexibility during test execution
- **docs**: update copier answers file path in README to reflect correct location for project setup instructions

### Refactor

- **copier.js**: reorganize utility functions and improve readability by consolidating file and directory assertions into dedicated functions, enhancing maintainability and clarity of test steps
- **project_scaffolding.feature**: update scenario description for clarity and add steps for executing DevSecOps test task
- **commitizen**: rename COMMITIZEN_CHECK_COMMAND to TASK_COMMITIZEN_COMMAND for consistency and clarity in task definitions
- **devsecops**: restructure Taskfile to improve readability and maintainability by simplifying task definitions and adding descriptive phases for testing operations


- add retry option to test job in GitLab CI for improved reliability

## 7.0.0 (2025-04-25)

### Feat

- **Taskfile.yml**: add entrypoint content verification task to ensure expected comments in entrypoint.js file
- **entrypoint.js.jinja**: add step definitions loader for specific files to enhance test modularity
- **create.taskfile.yaml**: enhance cluster creation with dynamic cluster name and additional variables for ports mapping and agents count
- **tests**: add verification tasks for features, screenshots, and step definitions structure to enhance test integrity and organization
- **Taskfile**: add new tasks for deployment, CodeceptJS, and port-forwarding for Superset service to enhance project workflow and testing capabilities
- **playbook.yml**: add local_bin_path variable and ensure ~/.local/bin directory exists for user-specific binary installations
- **Taskfile**: refactor variable definitions to use TASK_ prefix for consistency and add port-forward task for easier service access
- **Taskfile.release.yml**: enhance release process with additional variables and a new push-release task for better deployment control
- **Taskfile**: enhance development setup with initialization tasks and environment variables for better configuration management
- **Taskfile**: include additional optional taskfiles for codeceptjs and lefthook to enhance development capabilities
- **ansible**: refactor task variables to use TASK_ANSIBLE_ prefix for consistency and add syntax-check task for verifying playbook syntax
- **entrypoint.js**: add entry point for step definitions to load authentication steps for e2e tests
- **authentication**: add end-to-end tests for Superset login functionality to ensure proper authentication and dashboard display
- **tests**: add dashboard_after_login screenshot for end-to-end testing validation
- **authentication**: add admin authentication feature with successful login scenario and dashboard verification
- **lefthook**: add Taskfile.yml for Lefthook installation and configuration to streamline Git hooks management
- **steps_file.js**: add custom step methods file for CodeceptJS to enhance test automation capabilities
- **codeceptjs**: add initial configuration and step definitions for CodeceptJS testing framework to enable automated testing capabilities
- **jsconfig**: add jsconfig.json to enable JavaScript support in CodeceptJS for improved development experience
- **codeceptjs**: add initial configuration for CodeceptJS testing framework to enable end-to-end testing with Playwright and screenshot comparison features
- **codeceptjs**: add Taskfile.yml for CodeceptJS setup and test execution automation

### Fix

- **verify.taskfile.yaml**: update variable reference from OVERRIDE_TASK_ANSIBLE_VIRTUALENV to TASK_ANSIBLE_VIRTUALENV for consistency and clarity
- **side_effect.taskfile.yaml**: update variable reference from OVERRIDE_TASK_ANSIBLE_VIRTUALENV to TASK_ANSIBLE_VIRTUALENV for consistency in task configuration
- **destroy.taskfile.yaml**: update default value for cluster name to use current directory name for better context in task execution
- **converge.taskfile.yaml**: update task reference from :project:deploy to :deploy for clarity and consistency
- **cleanup.taskfile.yaml**: update variable reference to use correct context for TASK_TEST_INFRASTRUCTURE_CLEANUP_KUBECONFIG_DIR to ensure proper configuration loading
- **docs**: update variable references in DevSecOps guidelines to remove OVERRIDE prefix for consistency and clarity
- **Taskfile.yaml**: update variable references to remove OVERRIDE prefix for consistency and clarity in sealed secrets configuration
- **megalinter**: update variable references to use TASK_ prefix for consistency and clarity in Taskfile.yml
- **Taskfile.yml**: update variable references to use TASK_KIND_ prefix for consistency and clarity
- **Taskfile.plan.yml**: update variable reference from OVERRIDE_TASK_DEVSECOPS_PLAN_ENABLED to TASK_DEVSECOPS_PLAN_ENABLED for consistency and clarity
- **Taskfile.operate.yml**: correct variable reference from OVERRIDE_TASK_DEVSECOPS_OPERATE_ENABLED to TASK_DEVSECOPS_OPERATE_ENABLED for proper configuration handling
- **Taskfile.monitor.yml**: update variable reference for TASK_DEVSECOPS_MONITOR_ENABLED to ensure correct value retrieval
- **Taskfile.feedback.yml**: correct variable reference for TASK_DEVSECOPS_FEEDBACK_ENABLED to ensure proper configuration usage
- **Taskfile.deploy.yml**: update variable reference for TASK_DEVSECOPS_DEPLOY_ENABLED to ensure correct value retrieval
- **Taskfile.code.yml**: update variable reference for TASK_DEVSECOPS_CODE_ENABLED to ensure correct value retrieval
- **Taskfile.build.yml**: update variable reference for TASK_DEVSECOPS_BUILD_ENABLED to ensure correct value retrieval
- **dependency-check**: correct variable reference for TASK_DEPENDENCY_CHECK_USER to ensure proper functionality in Taskfile.yml
- **Taskfile.yml**: update variable references from OVERRIDE to TASK for consistency and clarity in configuration management
- **Taskfile.yml**: update variable references from OVERRIDE to direct TASK variables for consistency and clarity

### Refactor

- **tests**: simplify syntax checking tasks by replacing inline scripts with reusable tasks for Helm and Ansible to enhance maintainability and clarity
- **kaniko**: replace OVERRIDE_ prefix with TASK_ for consistency in variable naming across Taskfile.yml

## 6.0.0 (2025-04-03)

### Feat

- **init.sh**: add setup-go.sh script to initialization process for Go environment setup
- **setup-go.sh**: add script to configure Go environment variables and make Go available system-wide for development environments
- **Taskfile**: add devcontainer test task to streamline development workflow and enhance testing capabilities
- **devcontainer**: add Taskfile.yml to manage devcontainer testing tasks and streamline container command verification
- **playbook.yml**: add local_bin_path variable and ensure ~/.local/bin directory exists for user-specific installations of k3d
- **converge.taskfile.yaml**: add ENV variable for testing to support environment-specific configurations during deployment
- **Taskfile.yml**: add deploy environment check task to ensure proper ENV variable validation before deployment
- **Taskfile**: add TDD test task and conditional status check for deploy task to enhance testing and deployment processes
- **Taskfile**: add support for dynamic environment variable in deploy task to enhance flexibility in deployment configurations
- **iac**: add superset-values.yaml for configuring Superset environment and bootstrap script for dependencies installation
- **tests**: add additional files to check for existence in generated project to enhance verification process
- **Taskfile**: update test tasks to use TDD and add deployment commands for Apache Superset to streamline deployment process
- **tests**: add Ansible playbook to verify Apache Superset login page content for improved testing coverage
- **tests**: add Ansible playbook to verify Apache Superset deployment and pod status for improved testing and validation of the deployment process
- **Taskfile**: add k3d taskfile inclusion to support k3d operations in the task management system
- **k3d**: add requirements.txt to specify ansible-core dependency for k3d configuration
- **playbook**: add Ansible playbook for installing k3d using Go to streamline Kubernetes development environment setup
- **k3d**: add Taskfile.yml for managing k3d installation and dependencies with Ansible automation

### Fix

- **Taskfile**: reorder deployment tasks to ensure project deployment occurs before devsecops deployment for correct execution flow
- **Taskfile.deploy.yml**: update status check to use ENV variable instead of KUBECONFIG for better clarity and accuracy in test execution
- **Taskfile**: update deploy task status condition to improve logic for ENV variable check
- **Taskfile**: increase timeout from 5 minutes to 15 minutes for better stability during deployment
- **superset_login_page_check.yml**: rename url_to_test variable to url_to_check for clarity and consistency in naming
- **superset_login_page_check.yml**: update URL variable for login page check to improve maintainability and clarity
- **destroy.taskfile.yaml**: update task descriptions and commands to reflect the use of k3d instead of kind for cluster management
- **Taskfile.yml**: change default value of TASK_K3D_ENABLED from false to true to enable K3D tasks by default

### Refactor

- **playbook.yml**: update k3d symlink and copy tasks to use ~/.local/bin instead of /usr/local/bin for better user access and permissions management
- **kube**: migrate from Kind to k3d for cluster management to enhance compatibility and streamline infrastructure setup

## 5.1.1 (2025-03-18)

### Fix

- **Taskfile**: reorder release tasks to ensure project release runs before devsecops release for correct execution flow

## 5.1.0 (2025-03-18)

### Feat

- **Taskfile.yml**: add new verification task to check for non-existent files in the generated project to enhance project validation process
- **Taskfile**: add Docker build and push tasks with versioning support to streamline container management and deployment processes
- **helm**: add initial Chart.yaml.jinja for Helm chart configuration with dependencies for sealed-secrets
- **Taskfile**: add helm chart name verification task to ensure correct project naming in Chart.yaml file
- **Taskfile.yml**: add commitizen configuration verification task to ensure correct cz.yaml setup and version compliance
- **tests/copier**: add Taskfile.yml for testing copier functionality with detailed tasks and verification steps
- **Taskfile**: add initial Taskfile.yml.jinja with project-specific tasks
- **tests**: add verification task for DevSecOps capabilities in generated project to ensure proper configuration and functionality
- **tests**: add Taskfile.copier.yml for testing copier functionality and cleanup process
- **Taskfile.yml**: add includes section for tests copier and integrate test-copy-local task to streamline testing process
- **iac**: add Kind cluster configuration for testing in GitLab CI environment to enable Kubernetes API access from outside the dind service
- **create.taskfile.yaml**: add KIND config file variable and update cluster creation command to use it
- **create.taskfile.yaml**: add conditional adjustment for kubeconfig server addresses in GitLab CI environment
- **tests**: add verification taskfile for Ansible playbook execution to streamline infrastructure verification process
- **tests**: add syntax checking taskfile for Helm charts and Ansible playbooks to ensure code quality in the test environment
- **tests**: add side effect simulation taskfile for testing system resilience with Ansible playbooks
- **tests**: add prepare taskfile for setting up test infrastructure components
- **tests**: add idempotence taskfile for testing infrastructure deployment consistency and ensuring no changes occur on re-deployment
- **tests**: add destroy taskfile for managing Kind cluster lifecycle in testing environment
- **tests**: add dependency taskfile for verifying and installing required tools for testing infrastructure
- **tests**: add taskfile for creating and verifying Kubernetes test infrastructure to streamline testing setup and ensure environment consistency
- **tests**: add converge taskfile for managing test infrastructure setup and deployment
- **tests**: add cleanup taskfile for Kubernetes infrastructure to automate cleanup operations for kubeconfig, sealed secrets, and Helm chart archives
- **tests**: add Ansible playbook to verify Sealed Secrets controller deployment and service readiness in Kubernetes environment
- **tests**: add Ansible playbook to disrupt Sealed Secrets controller for resilience testing

### Fix

- **Taskfile.yml**: add additional directories to DIRS_TO_CHECK to ensure they do not exist in the generated project
- **tests**: update TEST_TMP_DIR to use USER_WORKING_DIR for better compatibility with different environments and adjust CLI_ARGS accordingly
- **Taskfile.yml**: update taskfile paths for tests to ensure correct inclusion and execution of test tasks
- **copier.yml**: update excluded directory from project/tests to tests/copier for accurate project setup
- **create.taskfile.yaml**: fix formatting of echo command in GitLab CI environment check for better readability
- **create.taskfile.yaml**: correct formatting of echo command in GitLab CI environment check for better readability and maintainability
- **docs**: update GitLab repository URLs in README to reflect the correct domain
- **Taskfile.deploy.yml**: update task names for Kubernetes infrastructure tests to reflect new naming conventions
- **ansible**: update path for TASK_ANSIBLE_COLLECTIONS_REQUIREMENTS_FILE to reflect new directory structure

### Refactor

- **Taskfile.yml**: rename verification task and generalize directory checks to improve clarity and maintainability
- **tests**: simplify DevSecOps task testing by removing output checks and using a direct task execution command for efficiency
- **tests**: restructure copier test tasks
- **Taskfile**: rename test-copy-local task to project:tests:copier for better clarity and organization
- **Taskfile**: reorganize test tasks under a new 'infra:kube' namespace for better structure and clarity
- **Taskfile.test.yml**: update infrastructure test tasks to use kube prefix for better clarity and organization

## 5.0.0 (2025-03-09)

### Feat

- **Taskfile.deploy.yml**: add helm build task to prepare infrastructure for deployment
- **Taskfile.deploy.yml**: add check-testing-environment task to validate KUBECONFIG variables and run TDD tests for better deployment safety
- **Taskfile.yaml**: add namespace and create-namespace options to helm upgrade for sealed-secrets installation to ensure proper namespace handling
- **kubeseal**: enhance installation playbook to create a global symlink for kubeseal and verify accessibility
- **playbook.yml**: enhance Kind installation process by creating a symlink in /usr/local/bin for global access and adding verification steps for accessibility
- **playbook.yml**: add result registration for bashrc sourcing to improve task verification
- **dependency.taskfile.yaml**: add Go installation verification task to ensure Go is properly set up in the environment
- **Taskfile**: add optional Go taskfile inclusion for better modularity
- **Taskfile.yaml**: add TASK_KUBESEAL_ENABLED variable for better task control and configuration flexibility
- **Taskfile.yml**: update tasks to install Helm instead of Node.js and add TASK_HELM_ENABLED variable for configuration
- **go**: add requirements.yml to define Ansible roles for Go setup
- **requirements**: add ansible-core dependency to requirements.txt for automation support
- **playbook.yml**: add Ansible playbook for installing Go with configurable version and checksum
- **Taskfile**: add Taskfile for managing Go installation and dependencies using Ansible automation to streamline setup process
- **Taskfile.yml**: add TASK_LIZARD_ENABLED variable to control lizard task execution and enhance configurability
- **docker**: add community.general collection to requirements for enhanced functionality
- **Taskfile.yml**: add TASK_DOCKER_CE_ENABLED variable for better configuration management and enhance role installation with collection support
- **Taskfile.test.yml**: add new tasks for running tests and TDD for infrastructure with conditional execution based on environment variable
- **Taskfile.plan.yml**: add variable for enabling/disabling devsecops plan and update default task status check
- **Taskfile.operate.yml**: add variable for enabling/disabling devsecops operate tasks to enhance configurability
- **Taskfile.monitor.yml**: add variable for enabling/disabling DevSecOps monitor tasks to enhance configurability
- **tests**: add verification taskfile for Ansible playbook execution to streamline infrastructure verification process
- **tests**: add syntax checking taskfile for Helm charts and Ansible playbooks to ensure code quality in the test environment
- **tests**: add side effect simulation taskfile for testing system resilience with Ansible playbooks
- **tests**: add requirements.yml for Ansible collections needed for infrastructure testing
- **prepare.taskfile.yaml**: add a new task file to prepare test infrastructure with required components
- **tests**: add idempotence testing task to verify infrastructure deployment consistency
- **tests**: add destroy taskfile for managing Kind cluster destruction in testing environment
- **tests**: add dependency taskfile for managing testing dependencies and tools installation
- **tests**: add create.taskfile.yaml for managing test infrastructure setup and verification in Kind clusters
- **tests**: add converge taskfile for managing test infrastructure setup and deployment process
- **tests**: add cleanup taskfile for infrastructure to manage resource removal
- **tests**: add Ansible playbook to verify Sealed Secrets controller deployment and service readiness for testing environment
- **tests**: add Ansible playbook to disrupt Sealed Secrets controller for resilience testing
- **Taskfile**: add Taskfile.yml to define project-specific tasks for planning, coding, building, testing, releasing, deploying, operating, monitoring, and feedback
- **helm**: add values.yaml for sealed-secrets configuration to manage installation settings and namespace details
- **helm**: add Chart.yaml for Helm chart deployment with dependencies for sealed-secrets
- **helm**: add Chart.lock file to manage dependencies for sealed-secrets Helm chart
- **secrets.yaml**: add secrets configuration for testing environment to manage sensitive data securely
- **sealed-secrets**: add Taskfile.yaml for managing sealed-secrets installation and verification in Kubernetes
- **config**: add lychee configuration file to exclude specific URLs from checks
- **kubeseal**: add requirements.txt to specify ansible-core dependency for better environment management
- **kubeseal**: add Ansible playbook for installing Kubeseal using Go to streamline the setup process and ensure proper environment configuration
- **kubeseal**: add Taskfile.yaml for managing Kubeseal installation and operations with Ansible automation
- **kubectl**: add Ansible playbook for installing kubectl with verification and PATH setup to streamline development environment setup
- **kubectl**: add Taskfile.yml for managing kubectl installation and dependencies using Ansible automation
- **requirements**: add ansible-core version 2.18.2 to requirements for improved automation capabilities
- **playbook**: add Ansible playbook for installing Kind using Go to streamline setup process
- **taskfile**: add Taskfile.yml for managing Kind installation and dependencies with Ansible automation
- **helm**: add requirements.yml to define Helm chart dependencies for better management
- **helm**: add playbook.yml for installing Helm with specified roles and version management
- **helm**: add Taskfile.yml for managing Ansible and Helm tasks to streamline setup and installation processes
- **Taskfile.feedback.yml**: add variable for enabling/disabling feedback tasks to enhance configurability
- **Taskfile.deploy.yml**: add deploy task with bootstrap preparation steps and environment variable for enabling/disabling deployment
- **Taskfile.yml**: add TASK_DEV_ENABLED variable to allow overriding task execution in development environment
- **Taskfile.yml**: add TASK_COPIER_ENABLED variable to allow overriding task copier enablement for better configuration flexibility
- **ansible**: add requirements.txt to specify ansible-core and kubernetes versions for dependency management
- **ansible**: add Taskfile.yml to manage Ansible setup and execution tasks in a virtual environment

### Fix

- **ci**: add dependency on release job for deploy stage to ensure proper execution order
- **Taskfile.deploy.yml**: update KUBECONFIG check to ensure it is not empty before running tests
- **playbook.yml**: improve error handling for Go installation checks and symlink creation to ensure proper execution flow and clarity in failure conditions
- **playbook.yml**: improve error handling for Go and Kind installation checks to ensure accurate failure reporting and better debugging
- **playbook.yml**: update Go command paths to use absolute paths for consistency and reliability
- **playbook.yml**: update Go command paths to absolute to ensure correct execution in Ansible tasks
- **megalinter**: remove unnecessary sudo commands and streamline report cleanup process
- **dependency-check**: update volume mount path from /src to /project for consistency in scanning directory

### Refactor

- **kubeseal**: remove GOPATH modification steps and add fallback copy method for permissions issues
- **devsecops**: restructure Taskfile.release.yml to improve task organization and readability by defining tasks for commitizen, kaniko, and docker separately
- **Taskfile**: restructure task definitions for better organization and clarity by consolidating installation commands into individual tasks

## 4.0.0 (2025-01-15)

### Feat

- **Taskfile**: add build and push tasks for Docker images with authentication support and customizable labels to enhance Docker management capabilities
- **Taskfile.release.yml**: add Docker CE build and push task with conditional execution based on TASK_DOCKER_CE_ENABLED variable to enhance deployment flexibility
- **kaniko**: add Dockerfile for Kaniko to facilitate container image builds
- **Dockerfile**: set entrypoint to ensure .bashrc is always sourced for a consistent shell environment
- **Taskfile**: add check for bunx command in task preconditions to ensure all dependencies are available
- **dependency-check**: add TASK_DEPENDENCY_CHECK_USER variable for user configuration in Docker command
- **Taskfile.release.yml**: add environment variables for Commitizen bump process to enhance release automation and control
- **kaniko**: add authentication settings for registry access and update build process to support authentication
- **release**: add variables for default and current branch in Taskfile for better release management
- **Taskfile.release.yml**: add Kaniko image push task with conditional execution based on TASK_KANIKO_ENABLED variable to enhance CI/CD process
- **requirements**: add requirements.txt for Ansible dependencies to manage project setup and ensure compatibility
- **Taskfile**: enhance Node.js installation process with Ansible automation and virtual environment setup
- **playbook**: add Ansible playbook for installing Node.js with configurable version to streamline setup process
- **kaniko**: update cache repository path to use $HOME for better portability and add cache directory preparation logic
- **kaniko**: add runtime command and volume flag variables for flexibility in container execution
- **Taskfile**: enhance DevSecOps task management with individual enable flags for better control over task execution
- **kaniko**: add Taskfile.yml for building and caching container images with Kaniko to streamline image creation and improve build efficiency
- **Taskfile**: add TASK_DEVSECOPS_BUILD_ENABLED variable to control DevSecOps build execution
- **Taskfile**: add support for Kaniko task configuration to enhance build capabilities and flexibility
- **debian.sh**: add function to update Node.js to the latest minor version using n package manager for better version management

### Fix

- **Taskfile.yml**: update bun and bunx command paths to use absolute paths for better reliability in task execution
- **ci**: enable DOCKER_TLS_VERIFY by setting it to 1 for improved security in CI pipeline
- **Dockerfile**: remove unnecessary blank line to maintain a cleaner Dockerfile structure
- **release**: enhance Kaniko task to read version from VERSION file and set image tag accordingly
- **kaniko**: update TASK_KANIKO_RUNTIME_CMD to use docker instead of podman for better compatibility with existing workflows

### Refactor

- **kaniko**: restructure build command to include authentication setup and improve error handling for missing credentials
- **kaniko**: replace hardcoded docker commands with variable references to support different container runtimes
- **Taskfile**: modify devsecops build task to conditionally execute based on TASK_DEVSECOPS_BUILD_ENABLED variable

## 3.0.0 (2024-12-15)

### Feat

- **Taskfile**: add support for dynamic task flags in installation commands to enhance flexibility in task execution
- **Taskfile.yml**: add status check for Docker installation before running playbook to ensure prerequisites are met
- **install-packages.sh**: read Python version from configuration file and install corresponding packages to ensure compatibility with the project requirements
- **Taskfile**: add conditional task for podman installation based on TASK_PODMAN_ENABLED variable to enhance flexibility in development environment setup
- **Taskfile**: add TASK_PODMAN_ENABLED variable to manage Podman integration settings
- **tests**: add Taskfile.yml for comprehensive Docker installation testing on Debian containers to ensure reliability and correctness of the installation process
- **Taskfile.yml**: add build task for all Dockerfiles to verify integrity and functionality
- **Taskfile.yml**: include test taskfile for better organization of testing tasks
- **Taskfile**: enhance setup-environment task with conditional installation
- **Taskfile**: add TASK_COPIER_ENABLED variable and rename TASK_DOCKER_ENABLED to TASK_DOCKER_CE_ENABLED for clarity and consistency in task management
- **docker**: add Taskfile.yml for managing Docker-CE installation with Ansible automation and virtual environment setup
- **docker**: add requirements.yml for Ansible roles to manage Docker CE installation and dependencies
- **docker**: add requirements.txt for Ansible dependencies to manage Ansible versions in Docker configuration
- **docker**: add Ansible playbook for installing Docker-CE to streamline setup process
- **Taskfile**: add optional docker-ce taskfile inclusion for better modularity
- **Taskfile.yml**: update setup-environment task to include copier installation and remove duplicate bun installation

### Fix

- **megalinter**: update paths in Taskfile.yml to reflect new directory structure for lint reports and temporary files
- **megalinter**: update paths in Taskfile.yml to reflect new directory structure for lint reports and working directory
- **Taskfile.release.yml**: update commitizen bump command to include dynamic task flags for better flexibility in release process
- **Taskfile.code.yml**: update task commands to include dynamic TASK_FLAGS for better flexibility in task execution
- **Taskfile.build.yml**: update Docker build command to use dynamic TASK_FLAGS for improved flexibility in task execution
- **playbook.yml**: update environment variable lookup from USERNAME to USER for consistency with standard practice
- **setup-docker.sh**: rename USERNAME variable to USER for consistency and clarity in the script
- **init.sh**: update user variable from USERNAME to USER for consistency in script execution
- **Dockerfile**: rename ARG USERNAME to USER for consistency and clarity in environment variable usage
- **devcontainer**: rename USERNAME argument to USER for consistency with Docker conventions
- **Taskfile.yml**: update task names to use a consistent naming convention for better clarity
- **playbook.yml**: update environment variable lookup from USER to USERNAME for compatibility with Windows systems
- **Dockerfile**: change working directory before running init.sh to ensure script execution in the correct context
- **Taskfile.yml**: update error message to reflect correct Docker installation task name from 'docker:install' to 'docker-ce:install' for clarity
- **Taskfile.test.yml**: update environment variable from TASK_DOCKER_ENABLED to TASK_DOCKER_CE_ENABLED for accurate Docker test execution
- **Taskfile.build.yml**: update environment variable from TASK_DOCKER_ENABLED to TASK_DOCKER_CE_ENABLED for better clarity and accuracy in Docker build tasks
- **docs**: update Docker task environment variable names for clarity and consistency
- **Taskfile.yml**: add --roles-path option to ansible-galaxy install command to specify roles installation directory

### Refactor

- **setup-user.sh**: rename USERNAME variable to USER for consistency and clarity in user setup script
- **ci**: remove unnecessary dependencies on deploy job for operate and monitor stages to streamline pipeline execution
- **Taskfile.yml**: rename task identifiers for consistency and clarity, update Python version command to dynamically read from a file, and adjust dependencies to reflect new task names

## 2.0.0 (2024-12-09)

### Feat

- **Taskfile**: add default task to orchestrate TDD workflows for better development process automation
- **cspell**: add "robertdebock" to the cspell configuration for improved spell checking accuracy
- **Taskfile.yml**: add INVENTORY_TARGET variable for better inventory management in Ansible tasks
- **Taskfile.yml**: add podman installation task to development environment setup for improved container management
- **devcontainer**: enhance Docker Compose configuration for Podman support by adding necessary privileges and cgroup settings
- **podman**: add Taskfile and playbook for automated Podman installation and role management
chore(podman): create requirements files for Ansible dependencies and roles
chore(podman): add .gitignore for roles directory to prevent unnecessary tracking

### Fix

- **megalinter**: correct typo in TASK_MEGALINTER variable name to TASK_MEGALINTER_CONTAINER_VERSION for consistency and functionality
- **Taskfile.yml**: update variable references in tasks to match new naming convention and ensure correct functionality
- **Taskfile.release.yml**: correct environment variable names for commitizen bump to ensure proper execution during release process
- **Taskfile.yml**: rename BUN_VERSION variable to TASK_BUN_VERSION for clarity and consistency in task definitions
- **Taskfile.release.yml**: update environment variable names for commitizen bump to use OVERRIDE prefix for clarity and consistency
- **Taskfile.yml**: update NODEJS_MAJOR_VERSION variable to use OVERRIDE_NODEJS_MAJOR_VERSION for better flexibility in version management
- **Taskfile.yml**: update variable names to use OVERRIDE prefix for clarity and consistency in overriding defaults
- **Taskfile.yml**: update BUN_VERSION variable to use OVERRIDE_BUN_VERSION for better flexibility in version management

### Refactor

- **Taskfile.yml**: rename variables to include TASK_PODMAN_ prefix for better clarity and organization
- **Taskfile.yml**: rename NODEJS_MAJOR_VERSION to TASK_NODEJS_MAJOR_VERSION for clarity and consistency in variable naming
- **Taskfile.yml**: rename LIZARD_* variables to TASK_LIZARD_* for better clarity and consistency in task definitions
- **dependency-check**: rename variables for consistency and clarity in Taskfile.yml
- **Taskfile.yml**: rename copier variables to task-specific variables for clarity and consistency in configuration management
- **Taskfile.yml**: replace hardcoded localhost with INVENTORY_TARGET for improved flexibility

## 1.0.2 (2024-11-18)

### Fix

- **copier.yml**: exclude copier.yml from being copied to improve project cleanliness

## 1.0.1 (2024-11-17)

### Fix

- **copier.yml**: exclude .git directory from copier to prevent copying version control files

## 1.0.0 (2024-11-17)

### Feat

- **copier**: add Taskfile.yml for managing Copier installation and execution in a virtual environment
- **copier.yml**: add template configuration for project setup to streamline DevSecOps project creation process

## 0.3.0 (2024-11-17)

### Feat

- **Taskfile**: add Taskfile.yml to define project-specific tasks for better automation and organization
- **devsecops**: add Taskfile.test.yml to define generic test tasks for better automation and organization of testing processes
- **release**: add Taskfile.release.yml for managing release tasks with Commitizen support
- **devsecops**: add Taskfile.plan.yml to define default tasks for the project
- **devsecops**: add Taskfile.operate.yml to define and manage operate tasks for the project
- **Taskfile.monitor.yml**: add a new Taskfile for monitoring tasks to streamline development processes
- **Taskfile.feedback.yml**: add a new Taskfile for generic feedback tasks to streamline development processes
- **devsecops**: add Taskfile.deploy.yml for managing deployment tasks in DevSecOps
- **devsecops**: add Taskfile for managing code quality tasks with conditional execution based on environment variables
- **devsecops**: add Taskfile.build.yml for managing build tasks and Docker image builds
- **Taskfile**: add devsecops tasks for planning, coding, building, testing, releasing, deploying, operating, monitoring, and feedback

### Fix

- **commitizen**: enhance error handling in Taskfile for commit verification process to provide clearer feedback on failures and warnings

## 0.2.0 (2024-11-17)

### Feat

- **Taskfile**: add environment variable support for task control and enhance task commands with conditional execution

## 0.1.0 (2024-11-10)

### Feat

- **devcontainer**: enable UID update for remote user to match local user settings in the dev container
- **lizard**: add Taskfile for Lizard code complexity analysis and requirements file for dependencies
- **docker**: add Taskfile for Docker installation and management tasks
- **docker**: create installation script for Debian-based systems
feat(docker): implement testing framework for Docker installation process
- **devcontainer**: add Dockerfile and related scripts for Debian-based environment setup
- **Taskfile**: add Taskfile.yml to configure the development environment with Docker, Node.js, and Bun installations
- **dependency-check**: add Taskfile.yml for managing Dependency-Check tasks to streamline security analysis process
- **commitlint**: add commitlint configuration and Taskfile for commit message validation
- **commitizen**: add Commitizen configuration and setup for standardized commit messages
- **taskfile**: add Taskfile for managing Bun JavaScript runtime installation, configuration, and uninstallation
- **linter**: add MegaLinter configuration and task file for code analysis
- **nodejs**: add Taskfile for Node.js installation and testing automation
- **nodejs**: create debian.sh script for managing Node.js installation
test(nodejs): add tests for checking NODEJS_MAJOR_VERSION and root execution
test(nodejs): add full installation test for Node.js with defined version
- **trivy**: add Trivy configuration and ignore files for better security scanning management
- **yamllint**: add configuration files and task management for yamllint to ensure consistent YAML formatting and linting in the project
- **devcontainer**: add Debian dev container configuration for development environment setup
- **ci**: add GitLab CI configuration for automated build and deployment pipeline
- **Taskfile**: add a central Taskfile for orchestrating development operations and workflows

### Fix

- **ci**: update deployment key handling to decode base64 instead of removing carriage returns for better compatibility
- **tests**: update hello-world image reference to use the official image for simplicity and reliability
- **ci**: replace hardcoded GitLab SSH host with environment variable for flexibility and portability
