# Tests Documentation

End-to-end tests for the DevSecOps Toolbox.

## Active suite — `e2e/`

`project/tests/e2e/` is the **single entry point** for the test suite. Every
new scenario lives here.

Convention: each scenario proves a real user journey, with **terminal proof**
(string presence on captured stdout, or visual regression when wording is the
contract) and **GitLab-side proof** when the action targets GitLab.

```text
project/tests/e2e/
├── codecept.conf.js              # Single CodeceptJS config (Playwright + VisualHelper + REST)
├── features/
│   ├── 02-init-guidance/         # init failure / opt-out guidance
│   ├── 03-init-effects/          # task devsecops:init + task release effects on GitLab
│   └── 04-auth/                  # task glab:auth:ensure guidance
├── pages/                        # GitLab Page Objects
├── support/
│   ├── helpers/                  # docker.js, freshUbuntu.js, gitlabApi.js, http.js, workspaceRepo.js
│   └── steps/                    # init-baseline.js, init-guidance.js, release-toggle.js, glab-auth-ensure.js
├── screenshots/base/             # Visual baselines (tolerance: 0)
└── _output/                      # Generated screenshots + reports (gitignored)
```

### Running

```bash
task project:test:e2e                                  # full suite, parallel (workers=3)
task project:test:e2e TASK_CODECEPTJS_GREP=@e2e-init-baseline   # filter by tag
TASK_E2E_WORKERS=5 task project:test:e2e               # bump parallelism
```

The suite executes inside the `codeceptjs` container (identical font stack
local / CI). Scenarios that need a fresh Ubuntu spawn one through the docker
socket via `support/helpers/freshUbuntu.js`. Scenarios that target GitLab
clone a fresh project via `support/helpers/workspaceRepo.js`.

### Adding a scenario

1. Pick the right group under `features/<NN>-<group>/` (or create one).
2. Reuse existing steps from `support/steps/` when possible — see
   `init-guidance.js` for the fresh-Ubuntu pattern, `release-toggle.js`
   for the GitLab-linked pattern.
3. Default to string-presence assertions. Add a visual baseline ONLY when
   the wording or layout itself is the contract.
4. Run `task project:test:e2e -- --grep "@your-tag"` to validate.
5. Run `task code` before submitting.

### Conventions

- Tag every scenario with `@e2e` plus a domain tag (e.g. `@e2e-release-toggle`).
- Filter dynamic noise from terminal captures with `OUTPUT_NOISE_PATTERNS`
  (per-step file). Date masking in `pages/GitLabAccessTokenPage.js`
  neutralises GitLab UI dates for visual regression.
- Visual regression uses `tolerance: 0` (pixel-perfect). Regenerate the
  baseline only when a deliberate source change makes the previous one
  outdated — never to silence drift.

## Migration in progress

The legacy folders `bootstrap/`, `gitlab/`, `template/` are kept for
historical reference. Their corresponding Task targets (`project:test:bootstrap`,
`project:test:gitlab`, `project:test:template`) are **no-op stubs** that exist
solely so the CI test-coverage check keeps passing until
`.config/gitlab/ci/devsecops/test.yml.jinja` is updated to reference
`test:e2e`. `project:test:tdd` calls these stubs (no-op) plus the real
`project:test:e2e`.

Do NOT add new scenarios to the legacy folders.

## Operational helpers

| File                    | Purpose                                                                   |
|-------------------------|---------------------------------------------------------------------------|
| `docker-compose.yml`    | Defines the `codeceptjs` runner service used by `project:test:e2e`.       |
| `diagnostic-complet.sh` | Captures full docker compose state on failure (run via `defer` in tasks). |
