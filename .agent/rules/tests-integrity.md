---
trigger: always_on
description: Test integrity — never cheat; a visual-regression baseline must be REAL captured output (via task), prove its setup, and cover both halves
---

# Tests Integrity

## ⛔ NO CHEATING

- ❌ NEVER modify a test to hide a failure
- ❌ NEVER modify code AND test simultaneously to bypass validation
- ❌ NEVER delete or weaken existing tests
- ❌ NEVER skip tests

## ✅ CORRECT BEHAVIOR

- ✅ If test fails → fix the **code**, not the test
- ✅ If test is obsolete → discuss with team before removing
- ✅ Include visual regression test for each UI feature

## 🎬 Prove it in a storyboard — a mechanical gate, not a plea

The key principle of this repo: **every PRODUCT change is proven by a VISIBLE storyboard card.** Product = `.config/**`, `copier.yml`, `Taskfile.yml{,.jinja}` — the framework surface shipped to every generated project. A written rule alone is ignorable: a rushed human, or any AI, can ship a `.config/**` fix with no visual proof and the pipeline stays green. So the principle has teeth.

- **The gate:** `.config/devsecops/scripts/check-storyboard-coverage.sh`, wired as the `storyboard-coverage` CI job (`.config/gitlab/ci/devsecops/test.yml`). On a merge request it **FAILS** when product files changed with **no** storyboard file (`project/tests/e2e/{features,screenshots/base,support/steps,storyboards}/**`) changed or added. Run it locally with `task devsecops:test:check:storyboard-coverage` (diffs against `origin/main`).
- **What "proven" means:** add or extend a card in `project/tests/e2e/features/**` — a `storyboardStep` whose frame shows the fix's real result, twinned with a programmatic assert (see the storyboard rules below). Graft it into the closest existing feature; a brand-new feature only when the fix is genuinely off-topic for every existing one.
- **The only waiver is visible:** a change that is genuinely invisible (pure internal refactor, comment) may carry a `Storyboard-exempt: <why>` commit trailer. It is never silent — review sees the reason.
- **The gate proves itself (dogfood):** it touches `.config/**`, so by its own rule it owes a card — `project/tests/e2e/features/03-evolution/test-discipline.feature` (`@test-discipline`) shows it stop an unproven change, pass a proven one, and waive only a visibly-exempted one.

## Visual Regression

Every test that proves something observable MUST include visual regression (`assertVisualMatch` / `assertTextVisualMatch`) at tolerance **0**.

### A baseline must be REAL output — never composed

- ✅ Render the genuine artifact: run the REAL entrypoint (`task <thing>`, never the underlying tool by hand) and capture its output **verbatim**; for files/diffs show the real `cat` / `git diff`.
- ❌ NEVER hand-compose a baseline — no prose, no reformatted summary, no cherry-picking the "important" lines. If a user running the command would not see exactly that text, it is wrong.
- ✅ Mask ONLY truly volatile fields (durations, timestamps, per-run paths, the toolbox version). Prove determinism by running the assertion strict **twice** — a fresh volatile value each run, so the mask must absorb it.
- ✅ Keep the real terminal colours (force them through the pipe; do not strip ANSI to grey).

### Prove the SETUP, not just the result

An image is worth a thousand words: show the precondition you established (the file you created, the `git diff` of what you changed) AND THEN the result. A test that only captures the final state cannot prove its own setup.

**Count the baselines: a result-only scenario is a half-job.** Every scenario that screenshots a command's verdict MUST be preceded by a setup baseline (`$ cat <input-file>`, `$ git diff`) so a human reading the images understands the journey without guessing. Rule of thumb: a scenario with exactly one `assertTextVisualMatch` almost always forgot its setup.

### A discriminating proof needs BOTH halves

To prove "X is handled but Y is not", show BOTH — a positive case and a negative case (a symmetric pair). A lone "nothing happened" baseline is ambiguous (broken vs intentionally ignored). Keep the meaningful check programmatic (throw on violation); the visual is the proof, not the test.

### Whole-journey scenarios — the storyboard is the reference pattern

The normative reference is the agent-mode scenario: `project/tests/e2e/features/01-install/agent-mode.feature`, its committed storyboard `project/tests/e2e/storyboards/01-install/agent-mode-only.svg` and its per-frame baselines under `screenshots/base/01-install/agent-mode-only/`.
Any NEW journey scenario, and any REFACTOR of an existing one, MUST follow it meticulously — full recipe in `project/tests/README.md` (§ Storyboards) and the engine guide in `.config/codeceptjs/README.md`.
Layout is flat: `storyboards/<act>/<story-tag>.svg`, baselines under `screenshots/base/<act>/<story-tag>/`.
Prefer few BIG stories over many small ones, and split a long one into chapters with `# Chapter: Title` lines inside the Scenario body — the whole film is indexed in `project/tests/e2e/storyboards/README.md`.

- ✅ ONE storyboard SVG tells the whole journey: BEFORE (the state on GitLab) → the acting (the live terminal, ephemeral menus caught live) → AFTER (the remote proof) — cards in reading order, two per row (fully uniform: a shared image slot sized to the row's tallest frame, and a shared text zone), a band before each chapter, every title/note/command around the frames selectable and copyable.
- ✅ ONE sentence = ONE card = ONE pixel baseline: EVERY sentence — the Given included — is registered through `storyboardStep(Given|When|Then, sentence, fn)`, whose pattern string is BOTH the scenario line and the card's title, and closes on a real capture asserted in-step (tolerance: 0) — a regression fails on the drifted sentence, and feature and storyboard cannot drift apart.
- ✅ The `.feature` is the single human-authored source: it carries the sentences AND the comments attached to the sentence right below them — `# Chapter: Title`, `# Note: text` (the card's explanation) and `# Copy: command`. The step file only drives and captures; cards open automatically for every sentence, and JS opts or `annotate()` stay ONLY for a note/copy computed at runtime.
- ✅ A sentence without a visual proof does not belong in a storyboard scenario; the SVG itself is the human artifact, never the regression target (the plugin renders it when the test ends).
- ✅ REUSE the engine: `captureTerminalFrame` / `capturePageFrame` / `assertOrUpdateBaseline` (`project/tests/e2e/support/terminal/capture.js`), the `storyboard` module (`.config/codeceptjs/storyboard.js`) and `GitLabRepositoryPage.maskVolatile` — never reinvent a capture mechanism.
- ✅ Twin every visual fact with a programmatic assert of the same fact (working tree, REST on the remote branch) so a regression fails loud even without eyes.
- ❌ NEVER scatter journey baselines outside their storyboard (a frame without its panel tells no story), and NEVER compose or retouch panel content — every pixel inside a panel is a real capture taken at its instant.

#### Write the narration for a human (a 12-year-old must follow it, without being talked down to)

The cards prove the fact; the WORDS make a stranger understand it. A storyboard that regenerates green but reads as a puzzle is a half-job. The bar every `Feature:`/`Scenario:`/`# Note:` must clear:

- ✅ Name everything in full, every time: "the main branch" (never a bare "main"), "the release job", "GitLab", "push access" — the reader never guesses what an "it" or a metaphor points to. A metaphor (the door) is allowed ONLY if its literal meaning (push access to the main branch) sits in the same clause the first time, then drop it for plain words.
- ✅ Show REAL GitLab, not a look-alike: when the fact lives in the CI, the card is the actual GitLab page (pipeline graph / job log / protected-branch settings), never a `<pre>` that merely resembles a terminal — the reader must see it IS the product, not a CLI reconstruction.
- ✅ Tell ONE arc across the cards: the normal rule → the one exception and its danger → the incident → the automatic rescue → the proof; close the last card back to the opening rule so the story resolves.
- ✅ Anchor each `# Note:` on what THAT card's screenshot actually shows, and quote its verbatim strings (the task name, the exact log line, the exact settings label — e.g. `task glab:release:lock-default-branch`, `Allowed to push: No one`); invent no UI.
- ✅ Explain any unavoidable term in one plain clause (after_script = a cleanup step GitLab runs on every outcome, pass or fail; merge request = a reviewed change). Keep each note 2-4 short concrete sentences; no comma splices, no padding.
- ✅ Reference exemplar: `features/02-daily-work/release-window.feature` — a real CI release is crashed mid-push and the story proves the main branch re-locks itself, told entirely on real GitLab pages.

### Mechanics

1. Wait for stability (loader inactive; key element visible with `TIMEOUTS.STABLE`).
2. Capture via a Page Object: `I.saveScreenshot()` + `I.assertVisualMatch()`.

- ❌ Inline screenshot without a Page Object
- ❌ `I.saveScreenshot()` without `I.assertVisualMatch()`
- ❌ Hardcoded `I.wait(2)` (use `TIMEOUTS`)

### When a visual test fails — the only honest fixes

- Content differs → fix the **code** so the output is correct.
- Rendering differs (font / DPI / sub-pixel) → fix the deterministic launch args; do NOT raise tolerance, lower threshold, or skip the assertion.
- Legitimate evolution (e.g. a version bump) → regenerate the baseline in the SAME environment, and only after you understand exactly why it changed.

### Reference — the framework's own e2e suite (mirror this pattern in your tests)

- **Page Objects:** `project/tests/e2e/pages/`
- **Shared helpers (text/page render, masking):** `project/tests/e2e/support/helpers/`
- **Base screenshots:** `project/tests/e2e/screenshots/base/`
- **Conventions & how-to:** `project/tests/README.md`
