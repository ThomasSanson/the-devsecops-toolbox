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
│   ├── helpers/                  # gitlabCard.js (GitLab cards), gitlabProject.js, gitlabApi.js, journeyContainer.js, docker.js, …
│   ├── steps/                    # journey.js, first-run-help.js, init-baseline.js, release-toggle.js, …
│   └── terminal/                 # capture.js — live xterm/ttyd compact capture + visual assert
├── screenshots/base/             # Visual baselines (tolerance: 0)
├── storyboards/                  # Committed storyboard SVGs (one per journey scenario)
└── _output/                      # Generated screenshots + reports (gitignored)
```

### Three visual-proof styles

1. **Live-terminal capture** (journey scenarios): the user's real ttyd/xterm session is captured via `support/terminal/capture.js` (`terminalCard`, `captureTerminalFrame`), anchored from a marker row (`fromMarker`, which must still be on screen) or bounded (`maxRows`) to isolate deterministic blocks.
2. **Replayed output** (`support/helpers/terminalRender.js`): a command that runs in the test runner itself, where no live terminal exists (git hooks, secret scans), has the bytes it printed replayed as a wide dark terminal card.
3. **Storyboard** (every story): ONE SVG assembled from real per-moment PNG frames — each frame its own pixel baseline — for journeys a single capture physically cannot hold; see below.

### Storyboards — the default for whole-journey proofs

Use a storyboard when one artifact must tell a journey that a single capture cannot: moments that never coexist on screen (interactive gum menus erase themselves the instant you answer) or panels living on different pages (GitLab web + the live terminal).
Reference scenario: `features/01-install/agent-mode.feature`, its committed storyboard `storyboards/01-install/agent-mode-only.svg` and its per-frame baselines under `screenshots/base/01-install/agent-mode-only/`.
Open the SVG locally in a browser: the chrome around the frames is real selectable text (one click selects a whole command in Chromium/Safari); GitLab's blob preview shows it as a static image only.

Prefer FEW, BIG stories over many small ones: merge overlapping scenarios into one end-to-end journey (20+ cards is fine) and show the failure AND its fix in the same story.
Split a long story into chapters with a `# Chapter: Title` comment on its own line inside the Scenario body, between two sentences — the engine draws a full-width band, "Chapter N" and its title, before the next card.
The whole film (3 acts, 34 stories in reading order) is indexed in [storyboards/README.md](e2e/storyboards/README.md).

Layout is flat: baselines land in `screenshots/base/<act>/<story-tag>/` and the committed SVG in `storyboards/<act>/<story-tag>.svg` (e.g. `storyboards/01-install/install-complete.svg`) — one level, no per-feature subfolder.

The storyboard contract: **ONE sentence = ONE card = ONE pixel baseline.** Every sentence of the scenario — the Given included — goes through `storyboardStep` and closes on a real capture; the Then sentences pair their card with a programmatic assert of the same fact. A sentence without a visual proof does not belong in a storyboard scenario.

Why SVG: everything drawn AROUND the frames — feature/scenario titles, the command that re-runs exactly this scenario, the feature-file path, per-panel captions, notes and reproduce commands — is real selectable text a reader can copy, which a PNG can never offer. The frames stay untouched bitmaps.

Mechanism — the whole step-side API ships with the template in `.config/codeceptjs/storyboard.js` (a generated project uses it as-is).
`capturePageFrame(I, name)` (any page) and `captureTerminalFrame` (`support/terminal/capture.js`, xterm-specific) write each real moment to `_output/storyboard-frames/` AS IT HAPPENS, and `addStoryboardFrame(I, png)` asserts each frame against its OWN baseline at `tolerance: 0` (`assertOrUpdateBaseline`) INSIDE the step — a visual regression fails on the exact sentence whose image drifted.
The same module, registered as a CodeceptJS plugin, fills the header automatically from the Gherkin metadata (feature title, scenario title, feature file, the scenario's LAST tag as the re-run command, the baseline directory `<act>/<last-tag>`) and renders the SVG when the test ends.
The board reads cards in reading order, two per row (fully uniform: one shared image slot as tall as the row's tallest frame, one shared text zone), with a full-width band before each `# Chapter:`.
A frame still 1000 px wide or more once fitted to the 1100 px height limit (a GitLab page captured 1440 px wide, a terminal window 1024 px wide) takes a full 1440 px row of its own, so it is read at its real size instead of at half of it.
A narrower strip stays in its 708 px half of a row, shrunk to fit, and so does a frame so tall that it is shrunk below 1000 px anyway. A card alone on its row is centred in it.
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
- Keep every panel deterministic: mask GitLab pages (`maskGitLabPage`, applied by every `gitlabFrame`), pre-install the toolchain off-camera (`preinstallToolchain`) so its volatile output stays out of frame, and let `TERMINAL_NOISE_PATTERNS` drop what remains. Never a secret on screen (quiet pushes, token-free remote URL backed by a credential store).
- Pair the storyboard with programmatic asserts of the same facts (working tree, REST on the remote branch) so a regression fails loud even without eyes.
- Regeneration follows the standard `TASK_E2E_UPDATE_BASELINES=1` flow; every regenerated frame must be inspected by a human like any other baseline, and the committed SVG is rebuilt from those reviewed baselines (never from unreviewed actuals).

### Big cards — real GitLab pages and whole terminal runs

The reference story (`@agent-mode-only`) uses the standard cards: a GitLab card before and after, interactive menus caught live, a typed line as a terminal card, and the after card in a
second tab.

- **GitLab card**: `gitlabFrame(I, frame, gitlabUrl.tree(project), { waitText, height })` from `support/helpers/gitlabCard.js` captures the WHOLE page at 1440 px wide (900 px tall by default, 1100
  at most: scroll to the evidence instead), masked by `maskGitLabPage`, and restores the window. The project named in the URL shows as "project"; pass `projectNames` when its display name differs
  from its path. Such a page takes a full row of the storyboard.
- **Terminal card**: `openTerminal(I, container, { height, width })` sizes the window BEFORE ttyd loads, in 15 px type, and keeps it: 1024 px wide by default (113 columns, a 78-column card fills its
  half row), 1440 px when a typed line would wrap in the middle of a word (157 columns). `terminalCard(I, frame, 'cmd-a && cmd-b   # label')` clears the screen, runs ONE line and captures everything
  since the clear, and returns the screen text for the twin. An interactive menu is caught live, before its answer, with `captureTerminalFrame` anchored on the typed command. A marker that is not on
  screen throws: this is a code change (open the terminal taller, or anchor lower), never a regeneration.
- **Both in one story**: take the GitLab card inside `inNewTab(I, () => gitlabFrame(...))`, so the bash session and its window size survive.
- **Proven by other stories**: job logs go through `jobLogFrame` (folded and unfolded sections, a focused line, masks across spans), on real failed, passed and running jobs in
  @test-discipline, @hybrid-ci and the other runner stories. CI/CD variables go through `ciVariablesFrame` (`publication-only-variables.png` in @publication-only). `unfoldFileTree` also
  works on a file page (`publication-only-gitlab-after.png`). `publishToGitLab(dir)` (`support/helpers/gitlabProject.js`) gives a local tree a GitLab ending in seconds, no runner, as in
  @render-matrix, @renovate-flow and @hybrid-ci (with `pushOptions: ['ci.skip']`).
- **A job log that mixes stdout and stderr**: the runner reads the two streams apart, and task logs its commands on stderr, so their lines can swap in GitLab's log. A demo pipeline whose
  log is carded starts its `before_script` with `exec 2>&1`, as @protected-commits does.
- **A terminal in the suite's own container**: `openLocalTerminal(I, { cwd, env, port })` (`support/helpers/localTerminal.js`) opens the same live terminal inside the codeceptjs
  container, for a story whose subject only runs there, such as the nested test engine of @tdd-cycle. `terminalCard` then works as usual.
- **Not in any story yet**: the pipeline editor through `ciEditorFrame`. The first story that calls it is its committed check: inspect its card with extra care.
- **After the last `# Note:` edit, run the story once more in update mode**: a strict run writes its board under `_output/` only, so the committed board keeps the old notes otherwise.

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
TASK_E2E_TIMEOUT=7200 task project:test:e2e             # allow a longer run (default 2400 seconds)
```

The guard around the engine (`support/helpers/workerCompletion.js`) stops a run that takes longer than `TASK_E2E_TIMEOUT` seconds, 2400 by default, and fails it. A hung worker then fails the CI job while it can still save the reports: the ones already written stay in `_output/junit` for diagnosis. Raise the limit for a run expected to last longer, such as the whole suite on one machine.

The suite executes inside the `codeceptjs` container (identical font stack local / CI).
Scenarios that need a fresh Ubuntu spawn one through the docker socket via `support/helpers/freshUbuntu.js` (first-run-help: a copy of the toolbox with a live terminal) or `support/helpers/journeyContainer.js` (developer journey: clone of a blank test-GitLab project + working-branch installer).
Scenarios that target GitLab clone a fresh project via `support/helpers/workspaceRepo.js`.

### Regenerating terminal baselines

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-tag"
```

This writes the element-cropped actuals over `screenshots/base/` instead of asserting (live-terminal captures only; refused when `CI` is set). **Every baseline produced this way must be inspected by a human** — regenerate only when a deliberate source change makes the previous baseline outdated, never to silence drift.

### Adding a scenario

1. Pick the right act under `features/<NN>-<act>/` (or create one).
2. Reuse existing steps from `support/steps/` when possible — see `journey.js` for the developer-journey pattern, `first-run-help.js` for the fresh-Ubuntu pattern, `release-toggle.js` for the GitLab-linked pattern.
3. Add a pixel baseline for every stage whose rendering is deterministic. Fall back to log/REST assertions only for genuinely volatile content.
4. Run `task project:test:e2e -- --grep "@your-tag"` to validate.
5. Run `task code` before submitting.

### Conventions

- Tag every scenario with `@e2e` plus a unique story tag used as the replay filter, a plain kebab tag (`@release-window`, `@self-healing`). Every scenario is a storyboard story.
- Filter dynamic noise from terminal captures with the noise-pattern lists (per-step file, plus `TERMINAL_NOISE_PATTERNS` in `support/terminal/capture.js`). Page objects mask dates, avatars, the top bar and per-run project names so GitLab pages render deterministically.
- Visual regression uses `tolerance: 0` (pixel-perfect). Raising the tolerance, lowering the threshold or skipping a visual assertion is forbidden.

## Former legacy suites — `bootstrap/`, `gitlab/`, `template/`

The legacy suites were DELETED after their load-bearing coverage was ported into `e2e/` (template rendering matrix, copier update, betterleaks detection, installer prerequisite paths, init-guidance and auth scenarios). They remain recoverable from git history if a reference is ever needed.

## Operational helpers

| File                    | Purpose                                                                   |
|-------------------------|---------------------------------------------------------------------------|
| `docker-compose.yml`    | Defines the `codeceptjs` runner service used by `project:test:e2e`.       |
| `diagnostic-complet.sh` | Captures full docker compose state on failure (run via `defer` in tasks). |
