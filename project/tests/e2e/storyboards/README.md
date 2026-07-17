# Storyboards

One SVG per e2e journey scenario: the whole journey as numbered cards — one
Gherkin sentence = one card = one pixel baseline.

- [gitlab/01-developer-journey/agent-mode.svg](gitlab/01-developer-journey/agent-mode.svg)
  — Declining the full framework installs only the AI agent guardrails

## How to read one

- **Open it locally in a browser** (double-click the file in your working
  copy). GitLab's preview shows it as a static image only.
- Everything around the frames is real text: **one click selects a whole
  command** (the replay command in the header, the reproduce command under
  each card) — Chromium/Safari.
- Keyword colours: green `Given` = the stage, blue `When` = the actions,
  purple `Then` = the proofs (each Then card is also asserted via API).
- Hover a frame to see the name of its pixel baseline
  (`screenshots/base/<same path>/<name>.png`).

## When a run fails

The failing run writes its partial board to `_output/<same path>.svg`
(downloadable from the CI artifacts). Right where the journey broke — in place
of the drifted step, after the cards that passed — a full-width band shows the
frame three ways side by side: **Expected (baseline) · Diff (the changed
pixels highlighted) · Actual (this run)**, each over its full, copyable file
path. You see at a glance what should have rendered, exactly which pixels
moved, what the run produced, and which files to open; the sentences the
journey never reached are listed below it. One download, zero ambiguity.

## Regenerating

Storyboards are rebuilt from the reviewed baselines on a green
baseline-update run — never edit them by hand:

```bash
TASK_E2E_UPDATE_BASELINES=1 task test -- --grep "@your-scenario-tag"
```

Full recipe: [project/tests/README.md](../../README.md) (§ Storyboards).
