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
- [**task-install-without-sudo**](01-install/task-install-without-sudo.svg): On a bare machine where the developer has no sudo rights, the task installer cannot use /usr/local/bin. It installs task into ~/.local/bin instead, says that folder must be on the PATH, and the shell finds task there.
  Replay: `task project:test:e2e -- --grep "@task-install-without-sudo"`
- [**missing-docker**](01-install/missing-docker.svg): On a machine without Docker, the installer says so before it sets up the project and names what to install, then goes on to the setup questions.
  Replay: `task project:test:e2e -- --grep "@missing-docker"`
- [**5. first-run-help**](01-install/first-run-help.svg): Every check stops and names the fix, and init finishes cleanly once GitLab is turned off.
  Chapters: The check names what is missing, and the command that installs it · The check reads the right GitLab host · init names the exact fix, then bows out cleanly.
  Replay: `task project:test:e2e -- --grep "@first-run-help"`
- [**6. merge-request-safety**](01-install/merge-request-safety.svg): init always reaches the main branch through a review you can see, from any branch, unless you opt out on purpose. Run again, it keeps the review it opened, and once that review is merged it proposes nothing: no branch pushed, no empty merge request.
  Chapters: The main branch already exists, and the developer is on an experiment branch · Running init again keeps the review, and proposes nothing once it is merged · The review switched off on purpose.
  Replay: `task project:test:e2e -- --grep "@merge-request-safety"`
- [**go-install-zsh**](01-install/go-install-zsh.svg): Without sudo, the Go installer writes GOROOT and GOPATH to the startup file of the developer's login shell, here ~/.zshrc, and a second run does not add them twice.
  Replay: `task project:test:e2e -- --grep "@go-install-zsh"`
- [**go-install-goroot**](01-install/go-install-goroot.svg): On a machine without which, as a base Arch Linux install is, the Go installer run with sudo links /usr/local/go to the Go it installed, where Go's standard library is.
  Replay: `task project:test:e2e -- --grep "@go-install-goroot"`
- [**copier-gherkin-language**](01-install/copier-gherkin-language.svg): Copier refuses a Gherkin language it does not know, francais, before it writes a single file, and takes its code, fr.
  Replay: `task project:test:e2e -- --grep "@copier-gherkin-language"`
- [**copier-docker-answers**](01-install/copier-docker-answers.svg): Copier refuses a malformed Docker answer for a project on its own runners, and an address with a stray space still gives a CI file that yamllint accepts.
  Replay: `task project:test:e2e -- --grep "@copier-docker-answers"`
- [**shipped-guides**](01-install/shipped-guides.svg): The toolbox keeps Task Mapping.md, its map of its own source tree. A project generated from it gets every other guide in docs/guidelines, without that one.
  Replay: `task project:test:e2e -- --grep "@shipped-guides"`

## Act 2 — Daily work (`02-daily-work`)

- [**7. daily-contribution**](02-daily-work/daily-contribution.svg): An everyday change goes from an issue to a merge request, passes its pipeline, and the main branch releases it with no manual step.
  Chapters: An issue starts the work · The change rides a merge request · The main branch releases it.
  Replay: `task project:test:e2e -- --grep "@daily-contribution"`
- [**retired-linters**](02-daily-work/retired-linters.svg): On a GitLab project, a framework update stops at a MegaLinter settings file that links outside the project, has a typo or is read-only: it names the file and changes nothing. Back on what GitLab holds, it arrives as a merge request that removes only the retired linters and keeps every comment and control. Asking again changes nothing.
  Chapters: A settings file linked outside the project stops the update · A settings file with a typo stops the update · A read-only settings file stops the update · Back on what GitLab holds, the update arrives as a clean merge request.
  Replay: `task project:test:e2e -- --grep "@retired-linters"`
- [**lychee-settings**](02-daily-work/lychee-settings.svg): A framework update adds an accept list to the lychee settings, where the project already wrote its own. The update leaves one list holding both, so lychee still reads its settings and checks the links, and the project's own address stays in a file of its own that no update touches.
  Replay: `task project:test:e2e -- --grep "@lychee-settings"`
- [**framework-dependencies**](02-daily-work/framework-dependencies.svg): The toolbox's own OSV scan reads its shipped dependency lockfiles and reports no known vulnerabilities.
  Replay: `task project:test:e2e -- --grep "@framework-dependencies"`
- [**report-permissions**](02-daily-work/report-permissions.svg): MegaLinter's reports belong to the developer who ran it, through Docker or through npx, and nobody else can read or change them. The developer can still delete them.
  Replay: `task project:test:e2e -- --grep "@report-permissions"`
- [**lizard-cli-args**](02-daily-work/lizard-cli-args.svg): In a generated project, `task lizard` passes a function with four paths under Lizard's default limit of 15. The same task with `-- --CCN 3` hands the lower limit to Lizard, which flags the function and fails the run.
  Replay: `task project:test:e2e -- --grep "@lizard-cli-args"`
- [**trivy-skip-dirs**](02-daily-work/trivy-skip-dirs.svg): Trivy, run with the settings file MegaLinter hands it, reports the vulnerable lockfile at the root of a generated project and skips the same lockfile under vendor/. The folder list now sits in that settings file, next to the line that names the file of accepted findings.
  Replay: `task project:test:e2e -- --grep "@trivy-skip-dirs"`
- [**task-progress**](02-daily-work/task-progress.svg): Workers report actual task output while preserving failed exit codes.
  Replay: `task project:test:e2e -- --grep "@task-progress"`
- [**dictionary-timeout**](02-daily-work/dictionary-timeout.svg): MegaLinter installs its spelling dictionaries with npm before its checks. Against a registry that never answers, that install stops after 120 seconds and MegaLinter says why, instead of holding the run for more than an hour.
  Replay: `task project:test:e2e -- --grep "@dictionary-timeout"`
- [**markdown-tables**](02-daily-work/markdown-tables.svg): MegaLinter leaves a table with emoji as it is, run after run, and markdownlint accepts it when its pipes line up on screen. A copy padded by character count is still flagged with MD060.
  Replay: `task project:test:e2e -- --grep "@markdown-tables"`
- [**devskim-workspace**](02-daily-work/devskim-workspace.svg): DevSkim flags an insecure address on a developer's machine, where MegaLinter mounts the project under /tmp/lint, as it does in CI, and still skips the project's own tmp folder.
  Replay: `task project:test:e2e -- --grep "@devskim-workspace"`
- [**osv-scope**](02-daily-work/osv-scope.svg): OSV scans inherited tools in the toolbox and project dependencies in the project, including custom tools under `.config/`.
  Chapters: The toolbox answers for its own tools · The project answers for its own dependencies · Without vulnerable dependencies of its own, the project passes.
  Replay: `task project:test:e2e -- --grep "@osv-scope"`
- [**megalinter-config**](02-daily-work/megalinter-config.svg): A project names its own MegaLinter settings file in `TASK_MEGALINTER_CONFIG`, and `task megalinter` and `task megalinter:pnpm:dlx` both load that file and run only the check it keeps.
  Replay: `task project:test:e2e -- --grep "@megalinter-config"`
- [**grype-excludes**](02-daily-work/grype-excludes.svg): Grype, run with the settings file MegaLinter hands it, reports the vulnerable lockfile of an API under project/api and skips the same lockfile in the API's .cache, vendor and venv folders. Every folder of its exclude list now matches at any depth.
  Replay: `task project:test:e2e -- --grep "@grype-excludes"`
- [**megalinter-base-render**](02-daily-work/megalinter-base-render.svg): A generated project receives the MegaLinter base settings with the same single blank line as the toolbox's own file, never two in a row for MegaLinter's formatter to remove.
  Replay: `task project:test:e2e -- --grep "@megalinter-base-render"`
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
- [**9. self-healing**](02-daily-work/self-healing.svg): init repairs its own GitLab connection: a revoked, duplicate, wrong or weakened token, a tampered variable and a variable that lost its masking or protection are all fixed, and a token that was right is kept. A forced refresh that GitLab refuses halfway keeps the release token that works, and init finishes one that stopped halfway. One `task devsecops:reload` then puts a drifted project back (main branch protection, pipeline file, both tokens) and leaves the project's own settings and its release version where they are.
  Chapters: A revoked release token is rebuilt · A duplicate token and a tampered variable are repaired · A variable that signs in as another token is fixed · A release token that cannot push is rebuilt · A variable that lost its guards gets them back, with the same token · A refresh that fails keeps the release token that works · A refresh cut short is finished by the next init · A project that drifted is put back in one command.
  Replay: `task project:test:e2e -- --grep "@self-healing"`
- [**10. release-window**](02-daily-work/release-window.svg): A release that fails leaves nothing broken behind: the main branch re-locks itself, no tag is pushed for an image that was never published, and a rejected push leaves no tag on its own, so the relaunch publishes the version commit with its tag and leaves no push token behind.
  Chapters: The push window always closes · A release that cannot publish its image pushes nothing · A rejected push publishes nothing · The relaunched release pushes its version commit and its tag together · The push token is not left behind.
  Replay: `task project:test:e2e -- --grep "@release-window"`
- [**11. source-publication**](02-daily-work/source-publication.svg): A private project publishes its source to a public one from its own pipeline, minus the files that never leave, and only after an owner approved the exact list.
  Chapters: What would leave the private project · Nothing leaves until somebody has said yes · The right person has to be the one who says yes · Later changes do not slip through.
  Replay: `task project:test:e2e -- --grep "@source-publication"`
- [**Publication refusal and recovery contracts**](02-daily-work/publication-contracts.svg): Publication keeps its safety promises, typed in a live terminal on throwaway repositories against fixture-forge, a stand-in for GitLab's API, then a release chapter published to a real public project on GitLab.
  Chapters: Exactly the committed files, or nothing · Publication runs only when asked, and only after a real scan · Approval names the exact list · Tokens and setup failures stay safe · Releases on a real public project on GitLab.
  Replay: `task project:test:e2e -- --grep "@publication-contracts"`
- [**12. tdd-cycle**](02-daily-work/tdd-cycle.svg): The toolbox tells a real failure apart from a run that died on its way to the test, refuses yesterday's failure as today's proof, and the phase refuses to certify work where a check was switched off or deleted, while a renamed test, or one deleted with its reason in the commit, goes through.
  Chapters: A failure that proves nothing · A failure that proves something · Yesterday's proof does not count · The phase refuses to certify itself · A check that disappears · A test that moves, and a test that goes for a reason.
  Replay: `task project:test:e2e -- --grep "@tdd-cycle"`
- [**deploy-only**](02-daily-work/deploy-only.svg): A merge request that only changes deployment files skips the test suite, once the project names those folders. Anything else, and any doubt, runs it.
  Chapters: A release that only moves image tags · Anything else still runs the test suite · When in doubt, the test suite runs.
  Replay: `task project:test:e2e -- --grep "@deploy-only"`
- [**baseline-mode**](02-daily-work/baseline-mode.svg): Only the value 1, on a developer's machine, rewrites a reference. CI refuses it, and a merge request shows each rewritten reference for a reviewer to accept.
  Chapters: A visible difference must fail · A developer rewrites the references, a reviewer accepts them.
  Replay: `task project:test:e2e -- --grep "@baseline-mode"`
- [**worker-completion**](02-daily-work/worker-completion.svg): A lost worker fails the run even when the engine exits 0, and so do a copied scenario name, a skipped scenario and a worker that hangs past the time limit. A complete selection still passes, with a grep filter or its inverse.
  Chapters: A worker can disappear before its result exists · A run can look complete without being complete · A complete selection still passes.
  Replay: `task project:test:e2e -- --grep "@worker-completion"`
- [**junit-control-characters**](02-daily-work/junit-control-characters.svg): GitLab reads a real failure report even when an assertion carries terminal colours, and shows the time each scenario took on two workers. The RED gate accepts the same coloured failure as a genuine one.
  Chapters: GitLab reads the report of a merge request · The RED gate reads the same report.
  Replay: `task project:test:e2e -- --grep "@junit-control-characters"`
- [**agent-run**](02-daily-work/agent-run.svg): An assistant runs its tasks through one entry point. A passing check, an expected RED, a refused check and a test that never ends each come back with their own exit code, kept in a status file that no pipe can rewrite.
  Chapters: One entry point, the task's own exit code · Nothing typed after the run can change its verdict.
  Replay: `task project:test:e2e -- --grep "@agent-run"`
- [**own-gitlab**](02-daily-work/own-gitlab.svg): The test suite only uses the GitLab of its own Compose project. When that GitLab is not running, it stops instead of taking a neighbour's.
  Chapters: Two GitLabs on one machine · No GitLab of its own, no GitLab at all.
  Replay: `task project:test:e2e -- --grep "@own-gitlab"`
- [**build-coverage-under-tmp**](02-daily-work/build-coverage-under-tmp.svg): A repository that sits under /tmp still has its Docker Compose files checked: the build check refuses a web service with no build task, and leaves out the scratch copy in a tmp folder that .gitignore ignores.
  Replay: `task project:test:e2e -- --grep "@build-coverage-under-tmp"`
- [**storyboard-wide-card**](02-daily-work/storyboard-wide-card.svg): A whole GitLab page gets a row of its own and shows at its real size. Smaller captures share rows two by two, and a card alone on its row sits in the middle.
  Replay: `task project:test:e2e -- --grep "@storyboard-wide-card"`
- [**generated-project-red**](02-daily-work/generated-project-red.svg): A project generated by the toolbox copies the CodeceptJS sample it ships, sees its first test fail, and its own RED gate accepts that failure.
  Chapters: The same proof, in a generated project.
  Replay: `task project:test:e2e -- --grep "@generated-project-red"`
- [**env-layering**](02-daily-work/env-layering.svg): The guide of a generated project says which settings file wins. A development value in `.env.dev` beats the default in `.env.dist`, and a `.env` file that git ignores beats both.
  Replay: `task project:test:e2e -- --grep "@env-layering"`
- [**red-evidence**](02-daily-work/red-evidence.svg): The RED gate refuses a failure caused by a refused connection and accepts the one on the test's own check, from the same run. A tag that names two tests and a report cut short are refused too.
  Chapters: A refused connection is not a failing test · One scenario, in one whole report.
  Replay: `task project:test:e2e -- --grep "@red-evidence"`
- [**team-compose-task**](02-daily-work/team-compose-task.svg): A new project's Taskfile names its Docker Compose command at the top, in PROJECT_DOCKER_COMPOSE, and a task the team adds runs Compose on the project's own compose file through it.
  Replay: `task project:test:e2e -- --grep "@team-compose-task"`
- [**build-coverage-example**](02-daily-work/build-coverage-example.svg): A generated project adds a frontend service with no build task. The build check refuses it and prints the task it is missing, and that task, pasted as printed into project/Taskfile.yml, satisfies the check.
  Chapters: A new service without its build task.
  Replay: `task project:test:e2e -- --grep "@build-coverage-example"`

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
  Chapters: What the default project looks like on GitLab · The default project passes its own YAML linter · Each answer changes exactly what it promises, one branch per answer · The default project keeps every fix of the toolbox's own files.
  Replay: `task project:test:e2e -- --grep "@render-matrix"`
- [**16. renovate-flow**](03-evolution/renovate-flow.svg): On a generated project, the real Renovate bot opens only the toolbox update and the toml update, and leaves the project's own image alone in its deployment manifest. Once the project has more dependencies, their minor and patch updates share one merge request and a major update keeps its own. On the toolbox itself, it opens one merge request per dependency.
  Chapters: A generated project only receives the toolbox update · A generated project's own minor and patch updates share one merge request · The toolbox updates its own tools, one merge request each.
  Replay: `task project:test:e2e -- --grep "@renovate-flow"`
- [**Renovate runtime**](03-evolution/renovate-runtime.svg): The pinned download rejects invalid configuration and accepts the correction, without a global Renovate installation. A failed download says the configuration was not checked, and a damaged copy in npm's cache never runs.
  Replay: `task project:test:e2e -- --grep "@renovate-runtime"`
- [**17. test-discipline**](03-evolution/test-discipline.svg): A real merge request is stopped when the framework moves with no proof card, and stopped again when the test behind that card is switched off.
  Chapters: A framework change that brings no proof card · The card is there, and the test behind it was switched off.
  Replay: `task project:test:e2e -- --grep "@test-discipline"`
- [**18. publication-update**](03-evolution/publication-update.svg): Renovate brings a toolbox release to a project that installed only source publication: its component and its spine move, the team's own rules do not, and nothing it never installed arrives.
  One continuous scene (no chapters).
  Replay: `task project:test:e2e -- --grep "@publication-update"`
- [**publication-ci-version**](03-evolution/publication-ci-version.svg): A toolbox version bump moves the full pipeline and the publication update job to the new toolbox image, in the same commit as VERSION.
  Replay: `task project:test:e2e -- --grep "@publication-ci-version"`
- [**19. hybrid-ci**](03-evolution/hybrid-ci.svg): A self-hosted project runs its file checks on an unprivileged runner and its Docker jobs on a tagged runner, and keeps its own settings through a Copier update. It also guards #162: the project's own spelling words survive that update. And #248: GitLab lists the project's test results from the JUnit report of its test job.
  Chapters: Choose the Docker runners · Add the application · Run the checks on real runners · Keep the project settings through an update · Containers keep their own runner · GitLab reads the test results.
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
