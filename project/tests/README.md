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
├── features/
│   ├── 01-install/                # bare machine → installer → framework or agent-mode-only
│   ├── 02-first-init/             # auth check → init guidance → init-framework merge request
│   ├── 03-daily-work/             # commit hooks, gitleaks, release window, token healing
│   └── 04-evolution/              # Copier rendering matrix, renovate, toolbox update
├── pages/                        # GitLab Page Objects (with masking for visual determinism)
├── support/
│   ├── helpers/                  # docker.js, freshUbuntu.js, journeyContainer.js, gitlabApi.js, http.js, workspaceRepo.js
│   ├── steps/                    # journey.js, init-baseline.js, init-guidance.js, release-toggle.js, glab-auth-ensure.js
│   └── terminal/                 # capture.js — live xterm/ttyd compact capture + visual assert
├── screenshots/base/             # Visual baselines (tolerance: 0)
├── storyboards/                  # Committed storyboard SVGs (one per journey scenario)
└── _output/                      # Generated screenshots + reports (gitignored)
```

### Three visual-proof styles

1. **Live-terminal capture** (journey scenarios): the user's real ttyd/xterm
    session is captured via `support/terminal/capture.js`
    (`assertTerminalVisualMatch`), optionally anchored from a marker row
    (`fromMarker`) or bounded (`maxRows`) to isolate deterministic blocks.
2. **Filtered `<pre>` render** (init-effects/guidance/release scenarios): the
    captured command output is noise-filtered, rendered as a `<pre>` block in
    the browser and screenshotted.
3. **Storyboard** (agent-mode): ONE SVG assembled from real per-moment PNG
    frames — each frame its own pixel baseline — for journeys a single
    capture physically cannot hold; see below.

### Storyboards — the default for whole-journey proofs

Use a storyboard when one artifact must tell a journey that a single capture
cannot: moments that never coexist on screen (interactive gum menus erase
themselves the instant you answer) or panels living on different pages
(GitLab web + the live terminal). Reference scenario:
`features/01-install/agent-mode.feature`, its committed
storyboard `storyboards/01-install/agent-mode/e2e-journey-agent-mode-only.svg` and
its per-frame baselines under
`screenshots/base/01-install/agent-mode/e2e-journey-agent-mode-only/`.
Open the SVG locally in a browser: the chrome around the frames is real
selectable text (one click selects a whole command in Chromium/Safari);
GitLab's blob preview shows it as a static image only.

The storyboard contract: **ONE sentence = ONE card = ONE pixel baseline.**
Every sentence of the scenario — the Given included — goes through
`storyboardStep` and closes on a real capture; the Then sentences pair their
card with a programmatic assert of the same fact. A sentence without a
visual proof does not belong in a storyboard scenario.

Why SVG: everything drawn AROUND the frames — feature/scenario titles, the
command that re-runs exactly this scenario, the feature-file path, per-panel
captions, notes and reproduce commands — is real selectable text a reader
can copy, which a PNG can never offer. The frames stay untouched bitmaps.

Mechanism — the whole step-side API ships with the template in
`.config/codeceptjs/storyboard.js` (a generated project uses it as-is):
`capturePageFrame(I, name)` (any page) and `captureTerminalFrame`
(`support/terminal/capture.js`, xterm-specific) write each real moment to
`_output/storyboard-frames/` AS IT HAPPENS, and `addStoryboardFrame(I, png)`
asserts each frame against its OWN baseline at `tolerance: 0`
(`assertOrUpdateBaseline`) INSIDE the step — a visual regression fails on
the exact sentence whose image drifted. The same module, registered as a
CodeceptJS plugin, fills the header automatically from the Gherkin metadata
(feature title, scenario title, feature file, the scenario's LAST tag as
the re-run command, the baseline directory mirrored from the feature path)
and renders the SVG when the test ends — a two-column grid of uniform
cards, each with its number badge, its Gherkin sentence (verbatim keyword
coloured: Given green, When blue, Then purple), an optional note and the
one-click-copyable reproduce command/URL. A failing run still gets its
partial board in `_output/` (it shows how far the journey got); the
committed copy under `storyboards/` is rebuilt only on a PASSED
baseline-update run, from the reviewed baselines.

Gherkin alignment: register EVERY sentence through
`storyboardStep(Given|When|Then, pattern, opts, fn)` — the pattern string
is BOTH the scenario line and the card's title, so one sentence reads as
one titled card and the feature and the storyboard cannot drift apart, by
construction. `opts` carries the human `note` and the copyable `copy`
command/URL that reproduces the step; the frame captured during the step
lands in its card via `addStoryboardFrame(I, png)`.

Rules — the panels ARE the proof:

- Every pixel inside a panel is a REAL capture taken at its instant; only
  the storyboard chrome (cards, titles, badges, captions) is drawn around
  them. Never compose, fake or retouch panel content.
- Tell the whole story, in the order a human doing the journey by hand would
  screenshot it: the state BEFORE (e.g. the fresh GitLab project), the acting
  (the terminal session, its live menus included), the state AFTER (the
  remote proof — e.g. the pushed files visible on GitLab main).
- Keep every panel deterministic: mask GitLab pages
  (`GitLabRepositoryPage.maskVolatile`), pre-install the toolchain off-camera
  (`preinstallToolchain`) so its volatile output stays out of frame, and let
  `TERMINAL_NOISE_PATTERNS` drop what remains. Never a secret on screen
  (quiet pushes, token-free remote URL backed by a credential store).
- Pair the storyboard with programmatic asserts of the same facts (working
  tree, REST on the remote branch) so a regression fails loud even without
  eyes.
- Regeneration follows the standard `TASK_E2E_UPDATE_BASELINES=1` flow; every
  regenerated frame must be inspected by a human like any other baseline, and
  the committed SVG is rebuilt from those reviewed baselines (never from
  unreviewed actuals).

### Your first storyboard — 4 steps

1. Write the scenario with a unique tag; EVERY sentence will be one card.
2. Register each sentence through `storyboardStep(Given|When|Then, sentence, { note, copy }, fn)` and close each step with `await addStoryboardFrame(I, await capturePageFrame(I, 'frame-name'))` (all from `.config/codeceptjs/storyboard.js`; a commented skeleton ships in `.config/codeceptjs/step_definitions/steps.js`).
3. Run `TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-tag"` — it creates the per-frame baselines AND the committed SVG under `storyboards/`.
4. Inspect every generated baseline and the storyboard like any reviewed artifact, then commit them.

On failure, the partial board in `_output/` shows — in place of the drifted
step, after the cards that passed — a full-width expected/diff/actual band
(the changed pixels highlighted, the full file path under each image) and
lists the sentences the run never reached: one downloadable artifact, zero
ambiguity.

### Running

```bash
task project:test:e2e                                   # full suite, parallel (workers=3)
task project:test:e2e -- --grep "@e2e-token-healing"    # filter by tag (CLI args)
task project:test:e2e TASK_CODECEPTJS_GREP=@e2e-token-healing   # filter by tag (env var)
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

1. Pick the right act under `features/<NN>-<act>/` (or create one).
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
