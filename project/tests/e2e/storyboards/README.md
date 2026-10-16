# Storyboards — the film

One SVG per e2e journey: the whole story as numbered cards — one Gherkin sentence = one card = one pixel baseline. Long stories are split into chapters (a full-width band before the card that opens each chapter).

Read the acts in order and you follow one developer from an empty project all the way to a project that updates itself safely. Each entry gives the one-line pitch, the chapters, and the exact command that replays the story (the command selects with one click inside the SVG header).

## Act 1 — Install (`01-install`)

- [**1. install-complete**](01-install/install-complete.svg) — One interactive install turns an empty project into a working framework and a locked-down GitLab.
  Chapters: Answer the questions, build the framework · The framework arrives as a merge request · GitLab is locked and wired.
  Replay: `task project:test:e2e -- --grep "@install-complete"`
- [**2. agent-mode-only**](01-install/agent-mode-only.svg): Saying no to the full framework installs only the AI agent files, nothing else. Running the installer again later changes nothing, and on the old .agent folder of an earlier release it moves the team's own rule to .agents.
  Chapters: Installing again later · Moving from the old .agent folder.
  Replay: `task project:test:e2e -- --grep "@agent-mode-only"`
- [**3. publication-only**](01-install/publication-only.svg): Ticking source publication on the same checklist installs it alone, wires GitLab for it, and it runs with nothing but a shell and git.
  One continuous scene (no chapters).
  Replay: `task project:test:e2e -- --grep "@publication-only"`
- [**publication-existing-framework**](01-install/publication-existing-framework.svg): On a project that already carries the complete framework, ticking source publication alone is refused. The installer names the update path instead and leaves every file as it was.
  Replay: `task project:test:e2e -- --grep "@publication-existing-framework"`
- [**4. fresh-machine**](01-install/fresh-machine.svg): Without curl the installer refuses cleanly. On a bare machine, the README one-liner piped into bash asks before each tool, adds unzip by itself and says what to do next. With no terminal at all, as in CI, it asks nothing and finishes.
  Chapters: Without curl, the installer refuses cleanly · The one-line install sets up the bare machine · Following that advice opens the merge request · With no terminal at all, nothing is asked.
  Replay: `task project:test:e2e -- --grep "@fresh-machine"`
- [**5. first-run-help**](01-install/first-run-help.svg): Every check stops and names the fix, and init finishes cleanly once GitLab is turned off.
  Chapters: The check names each missing tool · The check reads the right GitLab host · init names the exact fix, then bows out cleanly.
  Replay: `task project:test:e2e -- --grep "@first-run-help"`
- [**6. merge-request-safety**](01-install/merge-request-safety.svg): init always reaches the main branch through a review you can see, from any branch, unless you opt out on purpose.
  Chapters: The main branch already exists, and the developer is on an experiment branch · The review switched off on purpose.
  Replay: `task project:test:e2e -- --grep "@merge-request-safety"`

## Act 2 — Daily work (`02-daily-work`)

- [**7. daily-contribution**](02-daily-work/daily-contribution.svg): An everyday change goes from an issue to a merge request, passes its pipeline, and the main branch releases it with no manual step.
  Chapters: An issue starts the work · The change rides a merge request · The main branch releases it.
  Replay: `task project:test:e2e -- --grep "@daily-contribution"`
- [**retired-linters**](02-daily-work/retired-linters.svg): On a real GitLab project, a framework update stops at a MegaLinter settings file linked outside the project. Without the link, the same update arrives as a merge request that removes only the retired linters and keeps every comment and control. Asking again changes nothing.
  Chapters: A settings file linked outside the project stops the update · Without the link, the update arrives as a clean merge request.
  Replay: `task project:test:e2e -- --grep "@retired-linters"`
- [**framework-dependencies**](02-daily-work/framework-dependencies.svg): The toolbox's own OSV scan reads its shipped dependency lockfiles and reports no known vulnerabilities.
  Replay: `task project:test:e2e -- --grep "@framework-dependencies"`
- [**task-progress**](02-daily-work/task-progress.svg): Workers report actual task output while preserving failed exit codes.
  Replay: `task project:test:e2e -- --grep "@task-progress"`
- [**osv-scope**](02-daily-work/osv-scope.svg): OSV scans inherited tools in the toolbox and project dependencies in the project, including custom tools under `.config/`.
  Chapters: The toolbox answers for its own tools · The project answers for its own dependencies · Without vulnerable dependencies of its own, the project passes.
  Replay: `task project:test:e2e -- --grep "@osv-scope"`
- [**8. protected-commits**](02-daily-work/protected-commits.svg): The commit checks accept clean work and secrets never reach the main branch, from a teammate's laptop to GitLab.
  Chapters: The hooks come with the setup, not with the clone · Every commit message is checked · A key is stopped on the laptop · Getting out of a secret block · GitLab is the gate nobody can skip.
  Replay: `task project:test:e2e -- --grep "@protected-commits"`
- [**concurrent-scans**](02-daily-work/concurrent-scans.svg): Two secret scans of the same project, started at the same time on one Docker daemon, each block a made-up password from a container of their own and remove only that one.
  Replay: `task project:test:e2e -- --grep "@concurrent-scans"`
- [**scanner-log-redaction**](02-daily-work/scanner-log-redaction.svg): Full, staged and branch scans pass ordinary work and block a made-up password, with the Docker scanner and with the pinned binary, without copying its value into the scan log.
  Chapters: Ordinary work passes in both modes · A detected value stays out of the log.
  Replay: `task project:test:e2e -- --grep "@scanner-log-redaction"`
- [**vendor-allowlist**](02-daily-work/vendor-allowlist.svg): The full scan skips a library under vendor/ and still blocks the same made-up password in the project's own src/. The scan's config tells a project that needs its own allowlist to copy it, never to extend it.
  Replay: `task project:test:e2e -- --grep "@vendor-allowlist"`
- [**betterleaks-redact-config**](02-daily-work/betterleaks-redact-config.svg): A made-up password reaches a merge request. The generated Betterleaks job fails and prints REDACTED in the shared CI log, and only the developer's own terminal shows more, on request.
  Chapters: Every scan hides the whole value unless told otherwise · The shared CI log never prints the value · The developer sees more in their own terminal only.
  Replay: `task project:test:e2e -- --grep "@betterleaks-redact-config"`
- [**9. self-healing**](02-daily-work/self-healing.svg): init repairs its own GitLab connection: a revoked, duplicate, wrong or weakened token, a tampered variable and a variable that lost its masking or protection are all fixed, and a token that was right is kept. A forced refresh that GitLab refuses halfway keeps the release token that works, and init finishes one that stopped halfway. One `task devsecops:reload` then puts a drifted project back (main branch protection, pipeline file, both tokens) and leaves the project's own settings where they are.
  Chapters: A revoked release token is rebuilt · A duplicate token and a tampered variable are repaired · A variable that signs in as another token is fixed · A release token that cannot push is rebuilt · A variable that lost its guards gets them back, with the same token · A refresh that fails keeps the release token that works · A refresh cut short is finished by the next init · A project that drifted is put back in one command.
  Replay: `task project:test:e2e -- --grep "@self-healing"`
- [**10. release-window**](02-daily-work/release-window.svg): A release that fails leaves nothing broken behind: the main branch re-locks itself, and no tag is pushed for an image that was never published.
  Chapters: The push window always closes · A release that cannot publish its image pushes nothing.
  Replay: `task project:test:e2e -- --grep "@release-window"`
- [**11. source-publication**](02-daily-work/source-publication.svg): A private project publishes its source to a public one from its own pipeline, minus the files that never leave, and only after an owner approved the exact list.
  Chapters: What would leave the private project · Nothing leaves until somebody has said yes · The right person has to be the one who says yes · Later changes do not slip through.
  Replay: `task project:test:e2e -- --grep "@source-publication"`
- [**Publication refusal and recovery contracts**](02-daily-work/publication-contracts.svg): Publication keeps its safety promises, typed in a live terminal on throwaway repositories against fixture-forge, a stand-in for GitLab's API, then a release chapter published to a real public project on GitLab.
  Chapters: Exactly the committed files, or nothing · Publication runs only when asked, and only after a real scan · Approval names the exact list · Tokens and setup failures stay safe · Releases on a real public project on GitLab.
  Replay: `task project:test:e2e -- --grep "@publication-contracts"`
- [**12. tdd-cycle**](02-daily-work/tdd-cycle.svg): The toolbox tells a real failure apart from a run that died on its way to the test, refuses yesterday's failure as today's proof, and the phase refuses to certify work where a check was switched off.
  Chapters: A failure that proves nothing · A failure that proves something · Yesterday's proof does not count · The phase refuses to certify itself.
  Replay: `task project:test:e2e -- --grep "@tdd-cycle"`
- [**baseline-mode**](02-daily-work/baseline-mode.svg): Only the value 1, on a developer's machine, rewrites a reference. CI refuses it, and a merge request shows each rewritten reference for a reviewer to accept.
  Chapters: A visible difference must fail · A developer rewrites the references, a reviewer accepts them.
  Replay: `task project:test:e2e -- --grep "@baseline-mode"`
- [**worker-completion**](02-daily-work/worker-completion.svg): A lost worker fails the run even when the engine exits 0. A complete selection still passes, with a grep filter or its inverse.
  Chapters: A worker can disappear before its result exists · A complete selection still passes.
  Replay: `task project:test:e2e -- --grep "@worker-completion"`
- [**junit-control-characters**](02-daily-work/junit-control-characters.svg): GitLab reads a real failure report even when an assertion carries terminal colours, and the RED gate accepts the same coloured failure as a genuine one.
  Chapters: GitLab reads the report of a merge request · The RED gate reads the same report.
  Replay: `task project:test:e2e -- --grep "@junit-control-characters"`
- [**storyboard-wide-card**](02-daily-work/storyboard-wide-card.svg): A whole GitLab page gets a row of its own and shows at its real size. Smaller captures share rows two by two, and a card alone on its row sits in the middle.
  Replay: `task project:test:e2e -- --grep "@storyboard-wide-card"`
- [**generated-project-red**](02-daily-work/generated-project-red.svg): A project generated by the toolbox copies the CodeceptJS sample it ships, sees its first test fail, and its own RED gate accepts that failure.
  Chapters: The same proof, in a generated project.
  Replay: `task project:test:e2e -- --grep "@generated-project-red"`

## Act 3 — Evolution (`03-evolution`)

- [**13. toolbox-update**](03-evolution/toolbox-update.svg): A toolbox release asked for with `task devsecops:update` arrives as a merge request: the dictionary splits, the developer's word moves to its own file, a changed answer adds Ansible, and the developer's task file is never touched.
  Chapters: Before the release, my project on GitLab carries my own changes · I ask for the release, and it arrives as a merge request · A changed answer adds tools, and my own task stays mine.
  Replay: `task project:test:e2e -- --grep "@toolbox-update"`
- [**14. toolbox-update-conflict**](03-evolution/toolbox-update-conflict.svg): A toolbox release changes a line the developer edited. `task devsecops:update` warns about it, the update merge request shows both lines as a conflict, and the developer settles it on the update branch.
  Chapters: My edit and the release touch the same line · The merge request shows the clash, and the developer settles it.
  Replay: `task project:test:e2e -- --grep "@toolbox-update-conflict"`
- [**agents-move**](03-evolution/agents-move.svg): The release that moves the AI agent files from .agent to .agents keeps the team's own work: its rule moves with the toolbox's, the toolbox rules it never touched update cleanly, and only its edit to a toolbox rule is left between conflict markers.
  Chapters: The team's work sits in the old .agent folder · The release moves the folder, and only the team's edit is left to settle.
  Replay: `task project:test:e2e -- --grep "@agents-move"`
- [**15. render-matrix**](03-evolution/render-matrix.svg): The default render is canonical, and each Copier answer changes exactly what it promises, nothing more.
  Chapters: What the default project looks like on GitLab · Each answer changes exactly what it promises, one branch per answer.
  Replay: `task project:test:e2e -- --grep "@render-matrix"`
- [**16. renovate-flow**](03-evolution/renovate-flow.svg): On a generated project, the real Renovate bot opens only the toolbox update and the toml update, and leaves the project's own image alone in its deployment manifest. On the toolbox itself, it opens one merge request per dependency.
  Chapters: A generated project only receives the toolbox update · The toolbox updates its own tools, one merge request each.
  Replay: `task project:test:e2e -- --grep "@renovate-flow"`
- [**Renovate runtime**](03-evolution/renovate-runtime.svg): The pinned download rejects invalid configuration and accepts the correction, without a global Renovate installation.
  Replay: `task project:test:e2e -- --grep "@renovate-runtime"`
- [**17. test-discipline**](03-evolution/test-discipline.svg): A real merge request is stopped when the framework moves with no proof card, and stopped again when the test behind that card is switched off.
  Chapters: A framework change that brings no proof card · The card is there, and the test behind it was switched off.
  Replay: `task project:test:e2e -- --grep "@test-discipline"`
- [**18. publication-update**](03-evolution/publication-update.svg): Renovate brings a toolbox release to a project that installed only source publication: its component and its spine move, the team's own rules do not, and nothing it never installed arrives.
  One continuous scene (no chapters).
  Replay: `task project:test:e2e -- --grep "@publication-update"`
- [**publication-ci-version**](03-evolution/publication-ci-version.svg): A toolbox version bump moves the full pipeline and the publication update job to the new toolbox image, in the same commit as VERSION.
  Replay: `task project:test:e2e -- --grep "@publication-ci-version"`
- [**19. hybrid-ci**](03-evolution/hybrid-ci.svg): A self-hosted project runs its file checks on an unprivileged runner and its Docker jobs on a tagged runner, and keeps its own settings through a Copier update. It also guards #162: the project's own spelling words survive that update.
  Chapters: Choose the Docker runners · Add the application · Run the checks on real runners · Keep the project settings through an update · Containers keep their own runner.
  Replay: `task project:test:e2e -- --grep "@hybrid-ci"`
- [**Runner cleanup**](03-evolution/runner-cleanup.svg): This story checks the test suite's own runner setup, not a toolbox feature: registering another project runner keeps the stopped checkout helper of a running job, and GitLab still accepts that job's artifact.
  Replay: `task project:test:e2e -- --grep "@runner-cleanup"`

## How to read one

- **Open it locally in a browser** (double-click the file in your working copy). GitLab's preview shows it as a static image only.
- Everything around the frames is real text: **one click selects a whole command** (the replay command in the header, the reproduce command under each card) — Chromium/Safari.
- Keyword colours: green `Given` = the stage, blue `When` = the actions, purple `Then` = the proofs (each Then card is also asserted via API).
- Chapters read top to bottom: a full-width band ("Chapter N" and its title) opens each new part of a long story.
- Hover a frame to see the name of its pixel baseline (`screenshots/base/<act>/<story>/<name>.png`).

## When a run fails

The failing run writes its partial board to `_output/<act>/<story>.svg` (downloadable from the CI artifacts).
Right where the journey broke — in place of the drifted step, after the cards that passed — a full-width band shows the frame three ways side by side: **Expected (baseline) · Diff (the changed pixels highlighted) · Actual (this run)**, each over its full, copyable file path.
You see at a glance what should have rendered, exactly which pixels moved, what the run produced, and which files to open; the sentences the journey never reached are listed below it. One download, zero ambiguity.

## Regenerating

Storyboards are rebuilt from the reviewed baselines on a green baseline-update run — never edit them by hand:

```bash
TASK_E2E_UPDATE_BASELINES=1 task project:test:e2e -- --grep "@your-story-tag"
```

Full recipe: [project/tests/README.md](../../README.md) (§ Storyboards).

## Creating a new story

Start from the engine guide: [.config/codeceptjs/README.md](../../../../.config/codeceptjs/README.md) — how the storyboard plugin works, how to wire it, and the `.feature` conventions (`# Chapter:` / `# Note:` / `# Copy:` on the sentence below them) with a copy-ready minimal example.
