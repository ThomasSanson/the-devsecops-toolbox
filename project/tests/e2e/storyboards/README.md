# Storyboards — the film

One SVG per e2e journey: the whole story as numbered cards — one Gherkin sentence = one card = one pixel baseline. Long stories are split into chapters (a full-width band before the card that opens each chapter).

Read the acts in order and you follow one developer from an empty project all the way to a project that updates itself safely. Each entry gives the one-line pitch, the chapters, and the exact command that replays the story (the command selects with one click inside the SVG header).

## Act 1 — Install (`01-install`)

- [**1. install-complete**](01-install/install-complete.svg) — One interactive install turns an empty project into a working framework and a locked-down GitLab.
  Chapters: Answer the questions, build the framework · The framework arrives as a merge request · GitLab is locked and wired.
  Replay: `task project:test:e2e -- --grep "@install-complete"`
- [**2. agent-mode-only**](01-install/agent-mode-only.svg) — Saying no to the full framework installs only the AI agent files, nothing else.
  One continuous scene (no chapters).
  Replay: `task project:test:e2e -- --grep "@agent-mode-only"`
- [**3. fresh-machine**](01-install/fresh-machine.svg) — The installer adds its own missing tools and stays interactive even when piped from curl.
  Chapters: A bare machine sets itself up · The one-line install stays interactive.
  Replay: `task project:test:e2e -- --grep "@fresh-machine"`
- [**4. first-run-help**](01-install/first-run-help.svg) — On the first run, every check stops and names the exact fix, then finishes cleanly once nothing is missing.
  Chapters: The check names each missing tool · The check reads the right GitLab host · init names the exact fix, then bows out cleanly.
  Replay: `task project:test:e2e -- --grep "@first-run-help"`
- [**5. merge-request-safety**](01-install/merge-request-safety.svg) — init always reaches main through a review you can see, from any branch — unless you opt out on purpose.
  Chapters: main already exists · you started on an experiment branch · the opt-out you ask for on purpose.
  Replay: `task project:test:e2e -- --grep "@merge-request-safety"`

## Act 2 — Daily work (`02-daily-work`)

- [**6. protected-commits**](02-daily-work/protected-commits.svg) — The commit checks accept clean work and secrets never reach the repository.
  Chapters: The commit message is checked · Secrets never reach the repository.
  Replay: `task project:test:e2e -- --grep "@protected-commits"`
- [**7. self-healing**](02-daily-work/self-healing.svg) — init repairs its own GitLab connection: a revoked token, a tampered variable and a duplicate token are all fixed.
  Chapters: A revoked token is rebuilt · A tampered variable and a duplicate token are repaired.
  Replay: `task project:test:e2e -- --grep "@self-healing"`
- [**8. release-window**](02-daily-work/release-window.svg) — task release opens the push window on main just long enough to push, then always closes it — even if the push fails.
  One continuous scene (no chapters).
  Replay: `task project:test:e2e -- --grep "@release-window"`

## Act 3 — Evolution (`03-evolution`)

- [**9. toolbox-update**](03-evolution/toolbox-update.svg) — A toolbox update splits the dictionary and delivers new tools, while keeping the developer's own word and edits.
  Chapters: The update splits the dictionary and keeps my word · A flipped answer delivers new tools and spares my edits.
  Replay: `task project:test:e2e -- --grep "@toolbox-update"`
- [**10. render-matrix**](03-evolution/render-matrix.svg) — The default render is canonical, and each Copier answer changes exactly what it promises, nothing more.
  Chapters: What the default project looks like · Each answer changes exactly what it promises.
  Replay: `task project:test:e2e -- --grep "@render-matrix"`
- [**11. renovate-flow**](03-evolution/renovate-flow.svg) — Dependency updates flow through the framework, and every pinned tool is watched at both of its endpoints.
  Chapters: Updates flow through the framework · Every pinned tool is watched in both places.
  Replay: `task project:test:e2e -- --grep "@renovate-flow"`

## The two tests with no story to tell

`features/03-evolution/cspell.feature` and `version-pins.feature` stay classic tests, not storyboards: cspell compares two lint outputs (before and after an update), version-pins compares two version numbers — neither walks a journey, so there is nothing visual to narrate.

## How to read one

- **Open it locally in a browser** (double-click the file in your working copy). GitLab's preview shows it as a static image only.
- Everything around the frames is real text: **one click selects a whole command** (the replay command in the header, the reproduce command under each card) — Chromium/Safari.
- Keyword colours: green `Given` = the stage, blue `When` = the actions, purple `Then` = the proofs (each Then card is also asserted via API).
- Chapters read top to bottom: a full-width band ("Chapter N — Title") opens each new part of a long story.
- Hover a frame to see the name of its pixel baseline (`screenshots/base/<act>/<story>/<name>.png`).

## When a run fails

The failing run writes its partial board to `_output/<act>/<story>.svg` (downloadable from the CI artifacts). Right where the journey broke — in place of the drifted step, after the cards that passed — a full-width band shows the frame three ways side by side: **Expected (baseline) · Diff (the changed pixels highlighted) · Actual (this run)**, each over its full, copyable file path. You see at a glance what should have rendered, exactly which pixels moved, what the run produced, and which files to open; the sentences the journey never reached are listed below it. One download, zero ambiguity.

## Regenerating

Storyboards are rebuilt from the reviewed baselines on a green baseline-update run — never edit them by hand:

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-story-tag"
```

Full recipe: [project/tests/README.md](../../README.md) (§ Storyboards).
