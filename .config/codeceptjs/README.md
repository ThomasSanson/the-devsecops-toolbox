<!-- cspell:ignore storyboardStep addStoryboardFrame capturePageFrame captureElementFrame codeceptjs gherkin ttyd xterm metacharacters -->
# Storyboard engine (`.config/codeceptjs/storyboard.js`)

A CodeceptJS plugin that turns one Gherkin scenario into one human-readable Markdown storyboard, straight from the real screenshots the test captures.
The engine ships as the npm package [`@digital-commons-official/codeceptjs-storyboard`](https://gitlab.com/digital-commons/software/libraries/npm/codeceptjs-storyboard): `storyboard.js` is a one-line bridge to it, so step files outside this folder can require it by path.

## What it does

ONE Gherkin sentence = ONE card = ONE pixel baseline, asserted inside its step at `tolerance: 0` — a visual regression fails on the exact sentence whose image drifted.
The plugin opens a card automatically for every sentence (it listens to `bddStep.before`), so the step only drives the app and captures the proof.
When the scenario ends it writes the whole story as one Markdown page: GitLab shows every caption, note and command as text you can read, search and copy, next to the frames, which are the reviewed lossless WebP baselines.
With `format: 'svg'` the engine draws one SVG board instead: cards sit two per row, 708 px each.
A frame still 1000 px wide or more once fitted to the 1100 px height limit (a GitLab page, a terminal window 1024 px wide) takes a full 1440 px row so it is shown at its real size. A narrower strip stays in its half of a row, shrunk to fit, and so does a frame so tall that it is shrunk below 1000 px anyway. A card alone on its row is centred in it.
A `# Chapter:` comment starts a new section of the page, listed at its top, so a 20-card story still reads with a beginning, a middle and an end.
Nothing configures paths: everything is derived from the feature file location — baselines land in `screenshots/base/<feature-dir>/<scenario>/`, the committed page in `storyboards/<feature-dir>/<scenario>.md`.
A scenario that never calls `addStoryboardFrame` renders no storyboard, so plain Gherkin tests are left untouched.

## Wiring it in a project

Register the plugin and point Gherkin at your step files in the project's `codecept.conf.js` (the require path is relative to that conf; `.config/codeceptjs/` ships with the template):

```js
gherkin: {
  features: './features/**/*.feature',
  steps: [
    '../../../.config/codeceptjs/step_definitions/steps.js',
    './support/steps/my-story.js'
  ]
},
plugins: {
  storyboard: {
    require: '../../../.config/codeceptjs/storyboard.js',
    enabled: true,
    replayCommand: 'task test -- --grep "{tag}"'
  }
}
```

The package writes one Markdown page per scenario; `format: 'svg'` draws one SVG board instead.
The visual helper stores lossless WebP baselines. A project whose baselines are still PNG converts them once, with the same pixels, before its next run; until then the engine refuses to compare its frames:

```bash
npx -y -p @digital-commons-official/codeceptjs-storyboard codeceptjs-storyboard-webp project/tests/e2e/screenshots/base
```

`replayCommand` is the command each storyboard prints to replay its scenario.
When a run ends, `_output/index.html` lists the storyboards it rendered.

No companion plugin to enable: baseline-update mode probes the visual assert with `tryTo`, which since CodeceptJS 4 is an effect the engine imports itself (`codeceptjs/effects`) rather than a plugin exposing a global.
A copy-ready `codecept.conf.sample.js` with this block already in place sits next to this file.

## The `.feature` is the single human-authored source

Attach structured comments to the sentence just below them — the feature file carries the story, the step file only drives and captures:

- `# Chapter: Title` opens a full-width chapter band before that card.
- `# Note: text` is the card's explanation — what to look at, why it matters (one or two short sentences). Repeat the line to stack paragraphs: each `# Note:` becomes its own block, separated by a blank line, so a longer explanation reads as two or three short blocks instead of one dense wall.
- `# Copy: command` is the exact command shown one-click-copyable under the card (use placeholders like `http://gitlab/<user>/<project>` for volatile parts).

Precedence for a card's note/copy: a per-frame value wins over a runtime `storyboard.annotate({ note, copy })` call (for a URL known only mid-step), which wins over the `# Note:` / `# Copy:` comment — so the feature comment is the default, JS only overrides when a value is computed at runtime.

Minimal example — `features/onboarding/first-run.feature`:

```gherkin
@my-story
Feature: A developer opens their new project
  Scenario: The project home shows the framework
    # Chapter: The empty project
    # Note: The project as GitLab shows it, before anything is installed. Volatile details are masked so the picture is always the same.
    # Copy: http://gitlab/<user>/<project>
    Given a fresh project with only a README on its main branch
```

Its step file — `support/steps/first-run.js` (10 lines):

```js
/* global inject Given */
const { I } = inject()
const storyboard = require('../../../.config/codeceptjs/storyboard')

storyboard.storyboardStep(Given, 'a fresh project with only a README on its main branch', async () => {
  await I.amOnPage('/my/project')
  // capturePageFrame = full page; captureElementFrame(I, name, selector) crops to one element (a short verdict yields a short card).
  await storyboard.addStoryboardFrame(I, await storyboard.capturePageFrame(I, 'project-home'))
})
```

`storyboardStep(register, sentence, fn)` registers the step and escapes cucumber-expression metacharacters so `CI/CD` or `(y/N)` in a sentence never breaks the match; its `opts` argument is optional and kept only for runtime overrides.

## Regenerating the baselines and the storyboards

Run the suite in baseline-update mode from the repository root — it asserts first and only rewrites a baseline when its assert fails, so a green run produces no churn, then rebuilds every committed storyboard from the reviewed baselines:

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e
```

Only the exact value `1` enables regeneration; `0` and an unset variable keep strict comparisons.

Every baseline it writes must be inspected by a human, which is why the mode throws if `CI` is set: in CI it would silently swallow real visual regressions.
CI runs the plain `task project:test:e2e`, which only asserts.
