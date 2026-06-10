# Tests Documentation

End-to-end tests for the DevSecOps Toolbox.

## Active suite — `e2e/`

`project/tests/e2e/` is the **single entry point** for the test suite. Every
new scenario lives here.

Convention: each scenario proves a real user journey, with a **pixel baseline
at every stage whose content is deterministic** (tolerance: 0), terminal-side
AND GitLab-side. Where content is genuinely non-deterministic (toolchain
versions, temp dirs, download progress, MR diff sizes, secret token values),
the proof falls back to log/REST assertions — never to a raised tolerance.

```text
project/tests/e2e/
├── codecept.conf.js              # Single CodeceptJS config (Playwright + VisualHelper + REST)
├── features/gitlab/
│   ├── 01-developer-journey/     # blank repo → installer → Copier → init MR → GitLab configured
│   ├── 02-init-guidance/         # init failure / opt-out guidance
│   ├── 03-init-effects/          # task devsecops:init + task release effects on GitLab
│   └── 04-auth/                  # task glab:auth:ensure guidance
├── pages/                        # GitLab Page Objects (with masking for visual determinism)
├── support/
│   ├── helpers/                  # docker.js, freshUbuntu.js, journeyContainer.js, gitlabApi.js, http.js, workspaceRepo.js
│   ├── steps/                    # journey.js, init-baseline.js, init-guidance.js, release-toggle.js, glab-auth-ensure.js
│   └── terminal/                 # capture.js — live xterm/ttyd compact capture + visual assert
├── screenshots/base/             # Visual baselines (tolerance: 0)
└── _output/                      # Generated screenshots + reports (gitignored)
```

### Two visual-proof styles

1. **Live-terminal capture** (journey scenarios): the user's real ttyd/xterm
    session is captured via `support/terminal/capture.js`
    (`assertTerminalVisualMatch`), optionally anchored from a marker row
    (`fromMarker`) or bounded (`maxRows`) to isolate deterministic blocks.
2. **Filtered `<pre>` render** (init-effects/guidance/release scenarios): the
    captured command output is noise-filtered, rendered as a `<pre>` block in
    the browser and screenshotted.

### Running

```bash
task project:test:e2e                                   # full suite, parallel (workers=3)
task project:test:e2e -- --grep "@e2e-init-baseline"    # filter by tag (CLI args)
task project:test:e2e TASK_CODECEPTJS_GREP=@e2e-init-baseline   # filter by tag (env var)
TASK_E2E_WORKERS=5 task project:test:e2e                # bump parallelism
```

The suite executes inside the `codeceptjs` container (identical font stack
local / CI). Scenarios that need a fresh Ubuntu spawn one through the docker
socket via `support/helpers/freshUbuntu.js` (init-effects) or
`support/helpers/journeyContainer.js` (developer journey: clone of a blank
test-GitLab project + working-branch installer). Scenarios that target GitLab
clone a fresh project via `support/helpers/workspaceRepo.js`.

### Regenerating terminal baselines

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-tag"
```

This writes the element-cropped actuals over `screenshots/base/` instead of
asserting (live-terminal captures only; refused when `CI` is set). **Every
baseline produced this way must be inspected by a human** — regenerate only
when a deliberate source change makes the previous baseline outdated, never
to silence drift.

### Adding a scenario

1. Pick the right group under `features/gitlab/<NN>-<group>/` (or create one).
2. Reuse existing steps from `support/steps/` when possible — see
    `journey.js` for the developer-journey pattern, `init-guidance.js` for
    the fresh-Ubuntu pattern, `release-toggle.js` for the GitLab-linked
    pattern.
3. Add a pixel baseline for every stage whose rendering is deterministic.
    Fall back to log/REST assertions only for genuinely volatile content.
4. Run `task project:test:e2e -- --grep "@your-tag"` to validate.
5. Run `task code` before submitting.

### Conventions

- Tag every scenario with `@e2e` plus a domain tag (e.g. `@e2e-release-toggle`).
- Filter dynamic noise from terminal captures with the noise-pattern lists
  (per-step file, plus `TERMINAL_NOISE_PATTERNS` in `support/terminal/capture.js`).
  Page objects mask dates, avatars, the top bar and per-run project names so
  GitLab pages render deterministically.
- Visual regression uses `tolerance: 0` (pixel-perfect). Raising the
  tolerance, lowering the threshold or skipping a visual assertion is
  forbidden.

## Former legacy suites — `bootstrap/`, `gitlab/`, `template/`

The legacy suites were DELETED after their load-bearing coverage was ported
into `e2e/` (template rendering matrix, copier update, gitleaks detection,
installer prerequisite paths, init-guidance and auth scenarios). They remain
recoverable from git history if a reference is ever needed.

## Operational helpers

| File                    | Purpose                                                                   |
|-------------------------|---------------------------------------------------------------------------|
| `docker-compose.yml`    | Defines the `codeceptjs` runner service used by `project:test:e2e`.       |
| `diagnostic-complet.sh` | Captures full docker compose state on failure (run via `defer` in tasks). |
