# Deployment-only Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution with executing-plans was selected: these tasks share the same CI rules, fixtures and generator. The user authorized implementation after reviewing this plan.

**Goal:** Create only the agreed checks for deployment-only merge requests, with deployment paths configured through dotenv and synchronized by plan on the default branch.

**Architecture:** Keep one deployment-policy script with a pure pattern generator and a bounded API synchronization operation. GitLab selects jobs from the stored pattern before runners start. On the default branch, release waits for plan to finish, including failure; temporary use of an old stored pattern remains an accepted limitation.

**Tech Stack:** Go Task, existing Python/uv toolchain and Python standard library, GitLab CI/API 19.2+, CodeceptJS/Gherkin/Playwright, existing MegaLinter image.

**Spec:** [Deployment-only pipelines design](2026-10-23-deployment-only-pipelines-design.md). Read it with this plan; the issue comment alone predates the agreed release ordering.

## Global Constraints

- Require GitLab 19.2 or newer; do not build compatibility with earlier versions.
- Keep `TASK_DEVSECOPS_TEST_DEPLOY_PATHS` in `.env.dist`, with `.env.dev` taking priority. Preserve the root Taskfile's existing dotenv/environment precedence; never create `.env`.
- Literal relative files and folders; spaces or newlines separate entries. Exact files do not include neighbours. A directory includes descendants.
- Reject `project`/`project/`, root/traversal/wildcards, and an exact `.config` path component at any depth. A changed nested `.config` file always keeps the normal pipeline, even under an allowed parent.
- Missing/empty/unsupported/overlong configuration selects the full-pipeline pattern `\A`; the expanded generated pattern must not exceed 255 characters. A forbidden entry rejects the entire list.
- Synchronize on eligible `CI_DEFAULT_BRANCH` pipelines only. Local, MR and tag execution must not write project variables. Use `TASK_COMMITIZEN_TOKEN` without logging it.
- Three attempts for temporary failures: immediately, after 15 seconds, then after an additional 120 seconds. Respect bounded `Retry-After`; authentication/authorization faults fail without waiting.
- Default-branch release waits for plan success or failure; do not add `allow_failure` to plan. Preserve other release rules and its branch-protection lifecycle.
- Do not delete the stored variable on an unsuccessful synchronization; an old value can remain. Visible plan failure, Retry on a still-current commit or a new default-branch pipeline are the agreed recovery paths. A lost response can also mean the write succeeded: establish its outcome by reading.
- No new dependencies, new watcher, scheduled repair pipeline, root Taskfile changes or extra CI stage/job. This template repository owns `.config/`; update existing `.jinja` counterparts together.
- Use TDD and the official task runner. Never weaken tests, visual tolerances, scanners or phase guards to obtain a passing result.
- Work belongs to one dedicated MR. The user has authorized implementation, commits, pushes and publication; a human alone merges.

## Review Focus

1. An explicitly empty `.env.dev` override and a multiline value must survive Task loading unchanged; test the actual entry point, not a second dotenv parser (Tasks 1–2).
2. An allowed directory can contain `.config`, a test, or a renamed application file; protected paths and the original side of a rename must keep the full pipeline (Task 4).
3. A successful write whose response is lost, or another environment-scoped variable with the same key, must not cause duplicate creation or a false success (Task 2).
4. Scheduled/default-branch rule precedence and a failed plan must not let release start early, skip it incorrectly, or break an MR without plan (Task 3).
5. A safe fallback must actually run created jobs, and changed-file MegaLinter must still reject a real defect; job presence and job execution need separate evidence (Tasks 4–5).

---

## Starting point and file map

The checkout already has uncommitted issue-related changes in 34 files. They implement the superseded `.gitlab-ci.yml` list, generated `SOURCE` comparison and local `code:deploy-only:sync/check` commands. Preserve the checkout; do not reset it or claim its baselines prove this design. At execution, identify unrelated changes and carry only this issue's changes into the dedicated branch/worktree.

| Area | Files | Responsibility |
| --- | --- | --- |
| Policy and synchronization | `.config/devsecops/scripts/deploy-only.py` | Reuse the current generator; replace YAML-writing CLI behavior with dotenv-based generation and project-variable synchronization. |
| Entry points | `.config/devsecops/Taskfile.plan.yml`, `.config/devsecops/Taskfile.plan.yml.jinja` | Call synchronization through plan and provide a read-only pattern command. |
| Retire draft entry points | `.config/devsecops/Taskfile.code.yml`, `.config/devsecops/Taskfile.code.yml.jinja` | Remove the unshipped YAML sync/check tasks and their code-phase invocation. |
| Shared CI rules | `.config/gitlab/ci/variables.yml`, `.config/gitlab/ci/variables.yml.jinja` | Stored-pattern selection, unconditional protection of sensitive paths, reduced MegaLinter mode. |
| CI consumers | `.config/gitlab/ci/devsecops/{plan,build,deploy,operate,monitor,feedback,release}.yml`, `.config/gitlab/ci/devsecops/{code,test}.yml`, `.config/gitlab/ci/devsecops/{code,test}.yml.jinja` | Selection, code aggregation, runtime execution and plan/release ordering. These brace groups name existing files. |
| Legacy runtime helper | `.config/devsecops/scripts/check-deploy-only.sh` | Preserve supported legacy/local behavior; it must not override the new CI decision. |
| Configuration and guide | `.env.dist`, `.env.dist.jinja`, `.gitlab-ci.yml`, `.config/devsecops/deployment-only.md`, `README.md` | Remove the draft YAML settings; document dotenv setup, GitLab minimum and recovery. There is no root `.gitlab-ci.yml.jinja`. |
| Tests | `project/tests/e2e/features/02-daily-work/deploy-only.feature`, `project/tests/e2e/support/steps/deploy-only-pipeline.js` | Keep the existing journey and extend it for the agreed behavior. Preserve the legacy `@deploy-only` scenario. |
| Focused new test support | `project/tests/e2e/support/steps/deploy-only-sync.js`, `project/tests/e2e/support/steps/deploy-only-release.js`, `project/tests/e2e/support/helpers/deployOnlyFixture.js`, `project/tests/e2e/support/fixtures/deploy_only_contract.py` | API/retry and ordering fixtures; standard-library contracts with controlled clocks and transport. |
| Test registration and evidence | `project/tests/e2e/codecept.conf.js`, `project/Taskfile.yml`, `project/tests/e2e/storyboards/README.md`, `project/tests/e2e/screenshots/base/02-daily-work/<tag>/`, `project/tests/e2e/storyboards/02-daily-work/<tag>.svg` | Register steps and one contract-test task; capture actual terminal/GitLab evidence. `deploy-only.feature` is already assigned to shard 14. |

Do not pre-emptively change scanner dictionaries, shard counts or unrelated infrastructure. If adding scenarios makes shard 14 exceed its existing budget, rebalance feature-file assignments and run the shard coverage guard; do not increase the CI timeout merely to conceal the problem.

## TDD and evidence protocol used by each task

For each scenario, write its test first and run the following commands separately, replacing `@tag` with the exact tag named in the task:

```bash
task -x devsecops:agent:run -- test -- --grep "@tag"
task -x devsecops:agent:run -- devsecops:test:check:red-is-real -- @tag
```

The first command must fail on the new behavior assertion; the second must exit 0 and identify that scenario. Preserve
the report before another test overwrites it. An unavailable task, missing module, failed setup or missing baseline is
not the required RED. Use the existing working entry point for initial integration RED: for synchronization, `task plan`
already runs and currently creates no variable.

After the minimal implementation, rerun the same targeted command to GREEN; refactor only implementation and rerun it
again. Follow the repository's baseline-generation procedure where a new or deliberately changed frame needs capture.
Inspect every image, then run strict visual checks twice. Execute both phase-verification commands before committing;
record exact task exit codes and run-log paths. Suggested commit titles below are handoff guidance, not permission to
commit.

## Task 1: Generate a safe pattern from the effective deployment list

**Files:** policy script; plan Taskfiles; dotenv comments; feature and pipeline steps; new `deploy_only_contract.py`; `project/Taskfile.yml`.

**Interfaces:** retain `pattern_for(paths: str) -> str`. Add CLI `pattern`, reading the environment and printing only
the pattern to stdout, diagnostics to stderr. Expose it as `task devsecops:plan:deploy-only:pattern`. Add test-only
`project:test:deployment-only:contract` with `TASK_DEPLOY_ONLY_CONTRACT_CASE` selecting `paths` or `sync`; it invokes
the standard-library test file through the existing Python toolchain. No second dotenv parser and no new public
configuration knobs.

- [x] **Write `@deploy-only-paths` first**, with real terminal setup/result cards and contract assertions. Register the
  test-only task as part of this test setup. Begin RED using the existing generator, whose acceptance of `project/` and
  nested `.config` is the defect, so the failure does not depend on the new production task existing. Load the existing
  hyphenated Python filename with `importlib.util`; do not duplicate its generator in the test.

```python
assert pattern_for("project/") == r"\A"
assert pattern_for("deploy/ a/b/.config/settings.yml") == r"\A"
assert pattern_for("") == r"\A"
assert pattern_for("deploy/ charts/values-prod.yaml") == pattern_for(
    "deploy/\ncharts/values-prod.yaml\n"
)
```

Also assert rejection of `project`, `.`, `../deploy`, absolute paths and wildcards, duplicate-entry stability, a literal
dotted filename, accepted `.configuration/`, and length limits at 255/256 characters. Existing directories without `/`
retain their meaning; explicit trailing `/` works before the directory exists. Newline-containing repository filenames
are tested by actual GitLab selection in Task 4, not Python's regex engine.

- [x] **Run and certify RED** with `@deploy-only-paths` using the protocol above.
- [x] **Implement the generator and read-only entry point.** Keep literal escaping, anchors `\A`/`\z`, deduplication and
  whole-list fallback. Keep protected-path selection separate in Task 4 so its fixed rule does not consume the generated
  list's 255-character budget. Emit the fallback and a useful warning for a rejected list; empty configuration is
  intentional and needs no warning. Add the contract-task orchestration and no production test switch.
- [x] **Verify actual Task dotenv loading:** `.env.dev` overrides `.env.dist`, including an empty override; quote multiline values using Task-supported syntax. Verify the pattern command leaves `.gitlab-ci.yml` byte-for-byte unchanged.
- [x] **Run GREEN, refactor and verify.** Suggested commit: `feat: validate deployment-only path patterns`.

## Task 2: Synchronize the project variable through plan

**Files:** policy script; plan Taskfiles; `.config/gitlab/ci/devsecops/plan.yml`; new sync steps, fixture helper and contract file; feature; Codecept registration.

**Interfaces:** CLI `sync` calls `sync(env: Mapping[str, str], *, request=request_json, sleep=time.sleep,
clock=time.monotonic) -> int`. `request_json(method: str, url: str, token: str, body: dict | None = None, *, timeout:
float = 30) -> tuple[int, dict, object]` returns status, response headers and decoded JSON. Use standard-library
HTTP/JSON support; inject request/time only through Python function parameters in tests, not through CI variables. A
timeout/transport exception remains distinguishable from an HTTP response.

`task devsecops:plan:deploy-only:sync` forwards Task's resolved path value through an `env:` entry, preserving newlines
without shell interpolation. Consume `CI`, `CI_COMMIT_BRANCH`, `CI_DEFAULT_BRANCH`, `CI_COMMIT_SHA`, `CI_API_V4_URL`,
`CI_PROJECT_ID` and `TASK_COMMITIZEN_TOKEN`. Skip without network outside an eligible branch context. Retain the
existing plan-enabled guard; document that intentionally disabling plan also disables this synchronization.

- [x] **Write `@deploy-only-sync` first.** Publish a disposable GitLab project, configure its dotenv files and a project
  token, run the existing `task plan` with an explicit CI identity matching that disposable project's default-branch
  commit, and assert that the expected project variable exists. Initial RED is the missing remote result after a
  successful plan command. Add API/retry contract assertions before implementing them:

```python
assert recorded_delays == [15, 120]          # two transient failures, then success
assert create_requests == 1                # stored write followed by a lost response
assert writes_after_branch_advanced == 0
assert writes_outside_default_branch == 0
assert token_value not in captured_output
```

Cover create/update/no-op, read-back mismatch, wrong attributes, 401/403 with no sleep, repeated 503 with three attempts, timeout reconciliation, a bounded 429 delay, and retry on an unchanged current commit. Simulate time with the injected clock; exercise real API create/update/read-back separately. A fake transport proves failure handling, not live API compatibility.

- [x] **Run and certify RED** with `@deploy-only-sync`.
- [x] **Implement the bounded synchronization.** Check current default-branch SHA before mutation, again after waits,
  and at completion. Read/write only `TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP` at scope `*`; use `filter[environment_scope]=*`
  for GET/PUT. Expected attributes are `variable_type=env_var`, `raw=true`, `protected=false`, `masked=false`. Do not
  touch another environment-scoped variable with the same name. Create after confirmed absence, PUT after a difference,
  and read back even after apparent success. On an uncertain write, reconcile before another write; a duplicate-create
  response is resolved by reading, not by assuming the create failed.
- [x] **Set implementation defaults:** 30-second request timeout and 300-second total synchronization budget, using
  remaining budget to bound requests and sleeps. Attempt delays are 15 then 120 seconds; for 429 use at least the
  advertised wait when it fits, otherwise fail with instructions to retry later. No hidden retries inside the HTTP
  client. Permanent errors fail immediately. A verified `\A` fallback exits 0 with a warning when appropriate; an
  unverified update exits nonzero.
- [x] **Wire synchronization before `project:plan`** inside the enabled plan phase, so an unrelated project-plan error cannot prevent the attempt. Add a dedicated `resource_group: deployment-only-sync` to the plan job; keep release's separate lock. Explain in the guide that this serializes whole plan jobs, not only one API call.
- [x] **Run GREEN, refactor and verify.** Prove re-synchronization on a later default-branch pipeline even without a dotenv change, an obsolete pipeline after a retry delay, and separate serialized plan jobs. Suggested commit: `feat: synchronize deployment policy from the plan phase`.

## Task 3: Order release after plan on the default branch

**Files:** `.config/gitlab/ci/devsecops/release.yml`; new release steps; shared fixture helper; feature; Codecept registration.

**Interfaces:** default-branch release depends on `{job: plan, optional: true, artifacts: false}` and retains `when: always`; other contexts retain `needs: []`. Use `rules:needs`, not a shared plan/release resource group. The fixture exposes real job statuses, `started_at`, `finished_at` and exact commit IDs through existing `gitlabApi.js` helpers.

- [x] **Write `@deploy-only-release-order` first.** In a real GitLab fixture, hold plan at a controlled barrier and observe release has not started; release the barrier once with success and once with failure. Use fixture scripts to control work duration, but preserve the shipped release/plan scheduling rules and clearly label the scheduling proof.

```javascript
assert.equal(releaseJob.started_at, null) // while plan is running
assert.ok(Date.parse(releaseJob.started_at) >= Date.parse(planJob.finished_at))
assert.equal(failedPlanJob.status, 'failed')
assert.ok(releaseAfterFailedPlan.started_at)
```

Cover default-branch push/web/scheduled pipelines, a default branch named `trunk`, the staging tag exclusion and an MR without plan. Add a version-commit scenario showing it cannot advance the branch while that pipeline's plan is running. Preserve the existing release branch-lock tests for the real release implementation.

- [x] **Run and certify RED** with `@deploy-only-release-order`; existing `needs: []` is the expected cause.
- [x] **Implement rule-specific needs** without changing which rules select release. Existing schedule rules occur before the catch-all: split or augment their default-branch cases as well, so a schedule cannot bypass the wait. Leave non-default-branch rules and the release cleanup unchanged. Do not make plan's failure non-blocking with `allow_failure`.
- [x] **Run GREEN, refactor and verify**, including a different merge advancing the branch during plan; synchronization must still refuse an obsolete commit. Suggested commit: `fix: wait for plan before releasing the default branch`.

## Task 4: Select jobs from the stored policy and reconcile the old draft

**Files:** shared variables YAML and twin; all CI consumers listed in the file map; code Taskfiles and twin; `.gitlab-ci.yml`; legacy runtime helper; feature and pipeline steps; fixture helper; deployment guide and dotenv comments.

**Interfaces:** `.deployment-only.rules` decides omission using only MR context, fixed protected-path checks and `TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP`. A missing value follows existing rules; `\A` preserves all normally applicable jobs. A valid stored value is usable without a local `SOURCE` comparison. `code:all` treats an omitted Lizard job as optional.

- [x] **Write `@deploy-only-variable-selection` first.** Supply a real project variable and dotenv list, with no YAML list/source variables. Verify the complete job set, not merely absence of build. Preserve the original `@deploy-only-pipeline` journey by updating its obsolete setup/expectations to this authorized design; do not remove unrelated assertions.

```javascript
assert.deepEqual(actualJobs.sort(), [
  'code:all', 'code:betterleaks', 'code:commitizen-bump-dry',
  'code:commitizen-check', 'code:commitlint', 'code:megalinter',
  'code:project', 'code:renovate-validate', 'release'
].sort()) // generated-project fixture; toolbox-specific gates are separate
assert.ok(fullJobs.includes('no-cheat'))
assert.ok(fullJobs.includes('build'))
assert.ok(fullJobs.includes('test'))
```

Test mixed application/test changes, a sibling of an allowed file, missing/empty/fallback variables, config changes, an
allowed parent containing `.config`, nested tests and test-named files, and a literal newline in a tracked filename.
Test a rename from application/tests into an allowed directory using real GitLab diff evaluation. If the rename does not
preserve the full pipeline, report the unmet requirement and resolve it before shipping; do not relabel it covered.

- [x] **Run and certify RED** with `@deploy-only-variable-selection`; the current YAML list/source requirement prevents reduction.
- [x] **Implement protected-path precedence.** Before omission, an MR change under any `.config` component, repository
  configuration (`.env*`, `copier.yml`, root GitLab CI), Taskfile and agent-control files at every depth or standard
  test paths selects the normal applicable jobs. Use the existing no-cheat test-path conventions as the starting
  vocabulary. Keep this fixed protection in a separate anchored `changes:regexp` rule, each pattern within 255
  characters; do not concatenate a large guard into the user's generated pattern. The user remains responsible for
  listing deployment-only application content.
- [x] **Replace the draft source/list comparison**, keeping full-MR semantics and references in
  plan/build/test/deploy/operate/monitor/feedback/Lizard/no-cheat. Remove unshipped YAML-writing sync/check tasks, their
  calls from code phase and `code:project`, and draft root YAML list/source variables. Keep the root YAML fallback
  pattern only if needed for predictable missing-variable behavior. Do not alter the project's own `task project:code`
  checks.
- [x] **Stop runtime reclassification in the new CI path.** Remove the build/test/deploy early-exit calls from the
  updated job scripts so every created job performs its task. Preserve the standalone legacy helper and its legacy
  scenario; remove the draft-only condition that refuses to skip solely because the path setting is exported in the
  environment. Replace its old “these new CI jobs still call me” card with evidence of legacy/local use plus the new
  execution behavior, without dropping the legacy path-classification checks.
- [x] **Prove the accepted stale-value behavior:** while synchronization fails, a removed path can still use the previous reduced selection; after repair, a newly created MR pipeline restores jobs. An existing pipeline's job graph does not change. Exercise a full fallback with a nonempty local list and assert the created build/test/deploy fixture tasks actually run.
- [x] **Run GREEN, refactor and verify.** Update the guide with multiline dotenv syntax, settings UI location, expected messages, Retry versus new-pipeline recovery, accepted stale state, plan-disabled behavior and GitLab minimum. Suggested commit: `feat: select deployment-only jobs from the synchronized policy`.

## Task 5: Prove scoped linting and certify the whole change

**Files:** shared variables YAML and twin; code CI YAML and twin; existing pipeline steps; feature; `project/Taskfile.yml`; guide, README and storyboard artifacts.

**Interfaces:** `.deployment-only-megalinter.rules` uses the same classification as Task 4. Reduced mode sets `VALIDATE_ALL_CODEBASE=false` and the MR target as `DEFAULT_BRANCH`. Scanner CLI modes must be supported by the pinned image; whole-project-only scanners are excluded only in reduced mode. Mixed and ordinary pipelines keep the existing scanner configuration.

- [x] **Write `@deploy-only-lint-scope` first.** Use the existing project-scoped runner fixture and actual `task
  megalinter:ci`. Put `images: [` in the changed `deploy/overlays/prod/kustomization.yaml` and a Python syntax error in
  unchanged `project/src/broken.py`; record the real report's scanned files and failure source. After fixing only the
  deployment defect, the reduced scan must pass; making the Python file part of a mixed MR must restore its check. Add a
  changed Kubernetes Pod manifest with container `securityContext.privileged: true`; assert the pinned IaC scanner
  reports that violation for `deploy/pod.yaml`, then that correcting it removes that finding. Use an otherwise clean
  manifest rather than disabling other policies.

```javascript
assert.equal(reducedWithBadYaml.status, 'failed')
assert.ok(scannedPaths.includes('deploy/overlays/prod/kustomization.yaml'))
assert.ok(!scannedPaths.includes('project/src/broken.py'))
assert.equal(reducedWithFixedYaml.status, 'success')
assert.equal(mixedWithBadPython.status, 'failed')
assert.ok(securityFindings.some(f => f.path === 'deploy/pod.yaml' && /privileged/i.test(f.name)))
```

- [x] **Run and certify RED** with `@deploy-only-lint-scope` before changing scanner behavior. Already-passing cases remain regression evidence; do not intentionally break working code. If every assertion already passes after Task 4, this task is verification/documentation only and requires no fabricated RED or scanner change.
- [x] **Implement only the scoped mode adjustments needed by those tests.** Audit the draft's scanner override list against the pinned image instead of assuming all modes work. Add `deploy-only` to the existing MegaLinter fixture-image preparation selector when needed; keep the test entry point under task. Do not alter base scanner policy for all pipelines.
- [x] **Run GREEN and refactor**, capture/inspect the changed baselines, and obtain two strict passes. Document the exact scanners checked and any remaining evidence boundary.
- [x] **Self-review the full diff against the design**, including templates, environment precedence, plan/release scheduling, runtime fallbacks, immutable previous pipeline graphs, credential redaction and preservation of unrelated changes. Check the full MR diff, not only the last commit.
- [x] **Run the required final checks separately:**

```bash
task -x devsecops:agent:run -- devsecops:test:check:storyboard-coverage
task -x devsecops:agent:run -- devsecops:code:verify
task -x devsecops:agent:run -- devsecops:test:verify
```

Each must finish with exit code 0; `running` and `timed-out` are not passes. The last command runs the required test guards and full suite. Rebalance shard assignments only if measured duration justifies it. Do not disable a guard that objects to changed tests or scoped scanning: resolve the implementation or obtain the repository's explicit reviewed exception process.

These checks now pass. The follow-up evidence below records the corrected DevSkim
runtime, dependency audit, full code phase and full strict test suite.

- [ ] **Prepare the dedicated MR when execution/publication is authorized**, with the exact tested SHA, scoped diff, task-run evidence, real storyboards and the minimum-version notice. Check every required remote job on that SHA to terminal success. The user performs the merge. Suggested final commit: `test: verify deployment-only synchronization and pipeline behavior`.

## Sources checked while preparing this plan

- [GitLab project variables API](https://docs.gitlab.com/api/project_level_variables/) defines scoped reads/updates and variable attributes used in Task 2.
- [GitLab rules:needs](https://docs.gitlab.com/ci/yaml/#rulesneeds) supports the conditional dependencies in Task 3; [when](https://docs.gitlab.com/ci/yaml/#when) documents execution after failures. Actual scheduling remains an integration-test requirement.
- [GitLab rules:changes:regexp](https://docs.gitlab.com/ci/yaml/#ruleschangesregexp) defines Ruby regex behavior, version minimum and the expanded 255-character limit.
- [MegaLinter configuration](https://megalinter.io/latest/configuration/) distinguishes changed-file validation from CLI lint modes; the pinned image remains the runtime authority for Task 5.

## Plan review and execution boundary

This plan was checked against every design section and all three Red Team decisions. The five Review Focus items each have an owning test task. No product changes or tests were executed while preparing it. Checkboxes now track implementation; the execution ledger records actual runs and phase results.

The user authorized implementation, including these test and CI changes, with "ok go".
The initial delivery completed the implementation and targeted verification, but
retained two whole-change verification failures. On October 24, the user explicitly
requested their correction, fully green code checks, and commit/push/publication
through a merge request. The user also requested that agents may commit and push
through an MR or PR, while a human alone performs the merge.

## Implementation evidence

The independent implementation review found two important defects, now corrected:
repository scanners needed explicit file selectors, and nested Taskfile/agent-control
files needed unconditional protection. The installed scanner contract verifies file
collection and native commands for eleven scanners. Grype and Syft retain their
normal project mode because the pinned image reuses the first target in file mode;
they remain enabled in full pipelines.

Evidence below was collected before publication, using the local GitLab fixture.
The merge request records the pushed commit and remote CI result. Run identifiers name directories under
`tmp/agent-runs/` containing `status` and `output.log`.

| Check | Result | Run |
| --- | --- | --- |
| Legacy behavior, safe paths and complete pipeline/scanner journey | PASS | `20261023T234526Z-1182238` |
| Live synchronization and thirteen controlled recovery contracts | PASS | `20261023T215449Z-3845591` |
| Release ordering, failed plan, schedules, serialization and absent plan | PASS | `20261023T221724Z-36452` |
| Eleven installed scanner collectors and command builders | PASS | `20261023T231701Z-864108` |
| Path and synchronization contracts after fixture isolation and import cleanup | PASS | `20261024T011142Z-2332493`, `20261024T011145Z-2333080` |
| Full no-cheat guard | PASS | `20261024T022834Z-46` |
| Storyboard coverage guard | PASS | `20261024T022837Z-45` |
| Latest scoped Python, JavaScript, Markdown, spelling, YAML and JSON checks | PASS | `20261024T011102Z-2325258` |
| Full code phase verification | FAIL | `20261024T010723Z-2280393` |
| Two strict visual passes | PASS for all five deployment journeys and the seven adapted existing journeys | Final matrix/pipeline passes: `20261024T021439Z-3412978`, `20261024T022635Z-3598153` |
| First full test phase verification | FAIL: 50/69 scenarios passed | `20261024T003033Z-1688760`; all five deployment journeys passed |
| Clean secret scan and nested baseline-mode checks after integration fixes | PASS | `20261024T010712Z-2277507` |
| Existing journey recaptures after explained product changes | 6 PASS; matrix parity failed, then corrected | `20261024T011201Z-2335468` |
| Second full strict test phase | FAIL: 66/69 scenarios passed | `20261024T011907Z-2453809`; two explained reference differences and the unchanged OSV audit |
| Final matrix and pipeline reference capture | PASS: 2/2; both changed images inspected | `20261024T020454Z-3299987` |
| Strict replay of eight affected journeys | PASS: 8/8 | `20261024T021439Z-3412978` |
| Second strict replay of matrix and pipeline | PASS: 2/2 | `20261024T022635Z-3598153` |

At that point, the code phase failed on the existing DevSkim runtime error (missing
`System.Diagnostics.DiagnosticSource` version 9) and fourteen OSV warnings in the
unchanged CodeceptJS/Commitlint lockfiles. The new import-order and plan line-length
warnings were corrected and rechecked. Three existing long lines in the handwritten
storyboard index remained non-blocking warnings. No suppression or unrelated dependency
update had been added. The review's minor deferred
coverage item is live coexistence with a second variable of the same name under a
different environment scope; scoped API URLs and live read-back are covered.

The first full suite exposed internal plans, agent work and Python caches being
copied into generated projects, plus a path test leaving an empty directory behind.
The render contract reproduced those defects before correction. Copier now excludes
those internal artifacts, and the path test cleans up its temporary directory.
The release-window fixture preserves the new plan prerequisite, and nested test
runs isolate the outer suite's timeout. Original assertions and visual tolerance
remain unchanged. All eleven changed existing reference images were inspected.
The second full run passes twin parity, then finds one more obsolete matrix frame:
it still shows the deliberately removed runtime early-exit in the test job.
Its artifact assertions pass. The mixed-Python frame also needed an update because
the corrected imports now pass isort while the deliberately invalid Python still
fails its syntax checks. The final capture changed exactly those two images out of
twenty-seven matrix/pipeline references; both actual captures were inspected.
The subsequent strict replay passes all eight affected journeys, completing the
two required strict passes for the six adapted existing journeys. Matrix and
pipeline also pass their second complete strict replay on the final references.
Every other full-suite scenario passed except the existing dependency audit.
The full phase itself remains recorded as failed: these focused repetitions
resolve its two visual failures, and do not turn its audit failure into a pass.

Those initial results did not certify the whole change and were delivered without
commit, push or publication. The following work addresses that remaining boundary.

## Follow-up: complete quality checks and publication

The Git rule now permits feature-branch commits and pushes through merge or pull
requests. It prohibits direct default-branch pushes, agent merges and enabling
automatic merge. AGENTS.md and the framework-specific rule carry the same boundary.

The apparent DevSkim missing-assembly error was reproduced with 1,500 ordinary
source files: the scanner opens them all before analysis and exhausts the soft
file-descriptor limit of 1,024. Increasing that limit to 4,096 fixes the same
fixture; disabling parallel analysis does not. The official executable override
now launches DevSkim through a small script that raises only its soft limit to the
already-permitted hard limit. The test checks both local execution and the actual
CI task, retains detection of an insecure URL, and still excludes the project's
scratch directory. The real full-repository scan also completes without a crash.

Compatible npm updates fix the five vulnerable package names and two required
transitive packages: body-parser 2.4.0, content-type 2.1.0, fast-uri 3.1.9,
multer 2.5.0, qs 6.16.1, undici 8.12.3 and zod 4.6.7. Fast-uri occurs in both
CodeceptJS and Commitlint. Package manifests and overrides are unchanged.
The test image was rebuilt from the updated lockfile.

Raw agent reports and backups are preserved under
`tmp/agent-evidence/issue-354-20261024/`, with their contents verified byte-for-byte.
This avoids treating failed-test credentials and screenshot checksums as source
code. No scanner exclusion, suppression or weakened assertion was added.

| Follow-up check | Result | Run |
| --- | --- | --- |
| Reproduce framework dependency failures | RED; certified | `20261024T083601Z-2532741`, `20261024T084449Z-48` |
| Reproduce DevSkim failure on 1,500 files | RED; certified | `20261024T084620Z-2656384`, `20261024T085005Z-47` |
| Rebuild test image | PASS | `20261024T084511Z-2643019` |
| DevSkim and dependency journeys | PASS: 2/2; captures inspected | `20261024T085026Z-2712546` |
| DevSkim and OSV on the complete repository | PASS; zero errors or warnings | `20261024T085249Z-2765916` |
| Complete code phase, including all 37 MegaLinter linters | PASS; zero errors or warnings | `20261024T085940Z-2877941`, `20261024T100522Z-4077577` |
| Strict DevSkim and dependency journeys | PASS: 2/2; baseline updates disabled | `20261024T085445Z-2805105` |
| Full strict suite after quality corrections | 68/69 PASS; only the explained DevSkim command-line image differs | `20261024T090427Z-2941247` |
| Hybrid CI reference capture | PASS: 2/2; exactly two changed images, both inspected | `20261024T095409Z-3879310` |
| Final full strict test phase | PASS: 69/69 scenarios and 8/8 unit tests; no failures or skips | `20261024T100936Z-4127445` |
| Second strict hybrid CI replay | PASS: 1/1; baseline updates disabled | `20261024T110011Z-827985` |
| Final storyboard coverage and no-cheat guards | PASS | `20261024T110201Z-857153`, `20261024T110214Z-862354` |
| Actual staged-file secret scan | PASS; no secrets | `20261024T101057Z-4141339` |
| Independent review of the follow-up | No findings | Git rule, scanner wrapper, locks and test integrity reviewed |

The full run confirms second strict passes for DevSkim and framework dependencies.
The only remaining reference difference is the intentional DevSkim launcher command
in the hybrid CI job log; the real security and spelling findings are unchanged.
The updated references show the actual launcher in both the failed and successful
jobs; all other frames are unchanged. The complete strict phase and second focused
hybrid replay both pass. Remote CI must be checked on the pushed commit before the merge
request is reported ready. This document records the local checks before publication;
the merge request carries the final publication and remote CI status.
