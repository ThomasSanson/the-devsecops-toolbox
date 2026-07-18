# Tests Documentation

End-to-end tests for the DevSecOps Toolbox.

## Active suite — `e2e/`

`project/tests/e2e/` is the **single entry point** for the test suite. Every new scenario lives here.

Convention: each scenario proves a real user journey, with a **pixel baseline at every stage whose content is deterministic** (tolerance: 0), terminal-side AND GitLab-side. Where content is genuinely non-deterministic (toolchain versions, temp dirs, download progress, MR diff sizes, secret token values), the proof falls back to log/REST assertions — never to a raised tolerance.

```text
project/tests/e2e/
├── codecept.conf.js              # Single CodeceptJS config (Playwright + VisualHelper + REST)
├── features/
│   ├── 01-install/                # installer, agent-mode, fresh machine, first-run help, merge-request safety
│   ├── 02-daily-work/             # protected commits, self-healing init, release window
│   └── 03-evolution/              # Copier rendering matrix, renovate, toolbox update
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

1. **Live-terminal capture** (journey scenarios): the user's real ttyd/xterm session is captured via `support/terminal/capture.js` (`assertTerminalVisualMatch`), optionally anchored from a marker row (`fromMarker`) or bounded (`maxRows`) to isolate deterministic blocks.
2. **Filtered `<pre>` render** (init-effects/guidance/release scenarios): the captured command output is noise-filtered, rendered as a `<pre>` block in the browser and screenshotted.
3. **Storyboard** (the 11 journeys): ONE SVG assembled from real per-moment PNG frames — each frame its own pixel baseline — for journeys a single capture physically cannot hold; see below.

### Storyboards — the default for whole-journey proofs

Use a storyboard when one artifact must tell a journey that a single capture cannot: moments that never coexist on screen (interactive gum menus erase themselves the instant you answer) or panels living on different pages (GitLab web + the live terminal).
Reference scenario: `features/01-install/agent-mode.feature`, its committed storyboard `storyboards/01-install/agent-mode-only.svg` and its per-frame baselines under `screenshots/base/01-install/agent-mode-only/`.
Open the SVG locally in a browser: the chrome around the frames is real selectable text (one click selects a whole command in Chromium/Safari); GitLab's blob preview shows it as a static image only.

Prefer FEW, BIG stories over many small ones: merge overlapping scenarios into one end-to-end journey (20+ cards is fine) and show the failure AND its fix in the same story.
Split a long story into chapters with a `# Chapter: Title` comment on its own line inside the Scenario body, between two sentences — the engine draws a full-width "Chapter N — Title" band before the next card.
The whole film (3 acts, 11 stories in reading order) is indexed in [storyboards/README.md](e2e/storyboards/README.md).

Layout is flat: baselines land in `screenshots/base/<act>/<story-tag>/` and the committed SVG in `storyboards/<act>/<story-tag>.svg` (e.g. `storyboards/01-install/install-complete.svg`) — one level, no per-feature subfolder.

The storyboard contract: **ONE sentence = ONE card = ONE pixel baseline.** Every sentence of the scenario — the Given included — goes through `storyboardStep` and closes on a real capture; the Then sentences pair their card with a programmatic assert of the same fact. A sentence without a visual proof does not belong in a storyboard scenario.

Why SVG: everything drawn AROUND the frames — feature/scenario titles, the command that re-runs exactly this scenario, the feature-file path, per-panel captions, notes and reproduce commands — is real selectable text a reader can copy, which a PNG can never offer. The frames stay untouched bitmaps.

Mechanism — the whole step-side API ships with the template in `.config/codeceptjs/storyboard.js` (a generated project uses it as-is).
`capturePageFrame(I, name)` (any page) and `captureTerminalFrame` (`support/terminal/capture.js`, xterm-specific) write each real moment to `_output/storyboard-frames/` AS IT HAPPENS, and `addStoryboardFrame(I, png)` asserts each frame against its OWN baseline at `tolerance: 0` (`assertOrUpdateBaseline`) INSIDE the step — a visual regression fails on the exact sentence whose image drifted.
The same module, registered as a CodeceptJS plugin, fills the header automatically from the Gherkin metadata (feature title, scenario title, feature file, the scenario's LAST tag as the re-run command, the baseline directory `<act>/<last-tag>`) and renders the SVG when the test ends.
The board reads cards in reading order, two per row (fully uniform: one shared image slot as tall as the row's tallest frame, one shared text zone), with a full-width band before each `# Chapter:`.
Each card carries its number badge, its Gherkin sentence (verbatim keyword coloured: Given green, When blue, Then purple), and — read straight from the feature's `# Note:` / `# Copy:` comments — an optional note and the one-click-copyable reproduce command/URL.
A failing run still gets its partial board in `_output/` (it shows how far the journey got); the committed copy under `storyboards/` is rebuilt only on a PASSED baseline-update run, from the reviewed baselines.

The `.feature` is the single human-authored source: it carries the sentences AND the structured comments attached to the sentence right below them — `# Chapter: Title` opens a chapter band, `# Note: text` is the card's explanation, `# Copy: command` is the one-click-copyable command shown under the card.
The step file only drives the app and captures the proof: register EVERY sentence through `storyboardStep(Given|When|Then, sentence, fn)`, whose pattern string is BOTH the scenario line and the card's title, so one sentence reads as one titled card and feature and storyboard cannot drift apart.
Close each step on `addStoryboardFrame(I, png)`; cards open automatically for every sentence (the plugin listens to `bddStep.before`), so the step never does panel bookkeeping.
JS opts (or `storyboard.annotate({ note, copy })` mid-step) stay ONLY for a note/copy computed at runtime — e.g. a URL known only once the step runs; a runtime value overrides the feature comment.

Write the note for a tired adult: one or two short sentences saying why the step matters and what to look at in the image. Keep exact commands in the `# Copy:` comment, not in the note.

Rules — the panels ARE the proof:

- Every pixel inside a panel is a REAL capture taken at its instant; only the storyboard chrome (cards, titles, badges, captions) is drawn around them. Never compose, fake or retouch panel content.
- Tell the whole story, in the order a human doing the journey by hand would screenshot it: the state BEFORE (e.g. the fresh GitLab project), the acting (the terminal session, its live menus included), the state AFTER (the remote proof — e.g. the pushed files visible on GitLab main).
- Keep every panel deterministic: mask GitLab pages (`GitLabRepositoryPage.maskVolatile`), pre-install the toolchain off-camera (`preinstallToolchain`) so its volatile output stays out of frame, and let `TERMINAL_NOISE_PATTERNS` drop what remains. Never a secret on screen (quiet pushes, token-free remote URL backed by a credential store).
- Pair the storyboard with programmatic asserts of the same facts (working tree, REST on the remote branch) so a regression fails loud even without eyes.
- Regeneration follows the standard `TASK_E2E_UPDATE_BASELINES=1` flow; every regenerated frame must be inspected by a human like any other baseline, and the committed SVG is rebuilt from those reviewed baselines (never from unreviewed actuals).

### Your first storyboard — 4 steps

1. Write the scenario with a unique tag; EVERY sentence will be one card. For a long journey, split it with `# Chapter: Title` lines inside the Scenario body (each opens a chapter band).
2. Put the human text in the `.feature` as `# Note:` / `# Copy:` comments above each sentence, register each sentence through `storyboardStep(Given|When|Then, sentence, fn)`, and close each step with `await addStoryboardFrame(I, await capturePageFrame(I, 'frame-name'))` — full engine guide and a copy-ready example in [.config/codeceptjs/README.md](../../../.config/codeceptjs/README.md).
3. Run `TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-tag"` — it creates the per-frame baselines AND the committed SVG under `storyboards/`.
4. Inspect every generated baseline and the storyboard like any reviewed artifact, then commit them.

On failure, the partial board in `_output/` shows — in place of the drifted step, after the cards that passed — a full-width expected/diff/actual band (the changed pixels highlighted, the full file path under each image) and lists the sentences the run never reached: one downloadable artifact, zero ambiguity.

### Running

```bash
task project:test:e2e                                   # full suite, parallel (workers=3)
task project:test:e2e -- --grep "@self-healing"         # filter by tag (CLI args)
task project:test:e2e TASK_CODECEPTJS_GREP=@self-healing   # filter by tag (env var)
TASK_E2E_WORKERS=5 task project:test:e2e                # bump parallelism
```

The suite executes inside the `codeceptjs` container (identical font stack local / CI). Scenarios that need a fresh Ubuntu spawn one through the docker socket via `support/helpers/freshUbuntu.js` (init-effects) or `support/helpers/journeyContainer.js` (developer journey: clone of a blank test-GitLab project + working-branch installer). Scenarios that target GitLab clone a fresh project via `support/helpers/workspaceRepo.js`.

### Regenerating terminal baselines

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-tag"
```

This writes the element-cropped actuals over `screenshots/base/` instead of asserting (live-terminal captures only; refused when `CI` is set). **Every baseline produced this way must be inspected by a human** — regenerate only when a deliberate source change makes the previous baseline outdated, never to silence drift.

### Adding a scenario

1. Pick the right act under `features/<NN>-<act>/` (or create one).
2. Reuse existing steps from `support/steps/` when possible — see `journey.js` for the developer-journey pattern, `init-guidance.js` for the fresh-Ubuntu pattern, `release-toggle.js` for the GitLab-linked pattern.
3. Add a pixel baseline for every stage whose rendering is deterministic. Fall back to log/REST assertions only for genuinely volatile content.
4. Run `task project:test:e2e -- --grep "@your-tag"` to validate.
5. Run `task code` before submitting.

### Conventions

- Tag every scenario with `@e2e` plus a unique story tag used as the replay filter. Storyboard stories use a plain kebab tag (`@release-window`, `@self-healing`); the two classic non-story tests keep the `@e2e-template-*` prefix (`@e2e-template-cspell`, `@e2e-template-version-pins`).
- Filter dynamic noise from terminal captures with the noise-pattern lists (per-step file, plus `TERMINAL_NOISE_PATTERNS` in `support/terminal/capture.js`). Page objects mask dates, avatars, the top bar and per-run project names so GitLab pages render deterministically.
- Visual regression uses `tolerance: 0` (pixel-perfect). Raising the tolerance, lowering the threshold or skipping a visual assertion is forbidden.

## Former legacy suites — `bootstrap/`, `gitlab/`, `template/`

The legacy suites were DELETED after their load-bearing coverage was ported into `e2e/` (template rendering matrix, copier update, gitleaks detection, installer prerequisite paths, init-guidance and auth scenarios). They remain recoverable from git history if a reference is ever needed.

## Operational helpers

| File                    | Purpose                                                                   |
|-------------------------|---------------------------------------------------------------------------|
| `docker-compose.yml`    | Defines the `codeceptjs` runner service used by `project:test:e2e`.       |
| `diagnostic-complet.sh` | Captures full docker compose state on failure (run via `defer` in tasks). |
