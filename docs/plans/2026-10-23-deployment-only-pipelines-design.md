# Deployment-only pipelines

Status: design decisions confirmed in conversation, including the Red Team follow-up; implementation authorized on 2026-10-23 and in progress.

Sources: [issue #354](https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/work_items/354), [its comment](https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/work_items/354#note_4079182089), and the subsequent brainstorming conversation.

## Intent and scope

An image promotion should create only the jobs that check its deployment changes. Starting build, test and deploy runners merely to exit immediately wastes time and makes the pipeline misleading.

Keep the project's deployment-path setting in its normal environment files. Synchronize a generated GitLab variable through the existing `plan` job. The user accepted temporary use of the last stored value if synchronization fails, provided the failure is visible and recovery is simple.

This is one framework feature covering job selection, synchronization, MegaLinter scope, tests and documentation. Existing uncommitted work implements an earlier YAML-based configuration approach; it is a draft to reconcile, not validated delivery.

## Approaches and decision

| Approach | Trade-off | Decision |
| --- | --- | --- |
| Keep the list and generated rule in `.gitlab-ci.yml` | The rule travels with the commit, but moves the setting out of the project's normal environment files and requires regeneration. | Original issue and local draft; superseded by the comment. |
| Keep the list in environment files and synchronize a project variable from `plan` | Fits existing configuration and jobs; an unsuccessful synchronization can leave the previous rule active. | Selected in the comment and confirmed in conversation, with bounded retries and visible failure. |
| Require proof of current configuration before every reduced pipeline | Stronger freshness guarantee, but needs another coordination mechanism and changes the simple workflow. | Not pursued: the user accepted the temporary stale-value risk instead. |

The last option was discussed as a stronger guarantee, not designed or tested. This design does not promise atomic synchronization with every new commit or with pipeline creation.

The Red Team review identified an interaction with the existing release job: it can push a version commit while synchronization is waiting, making the pipeline commit obsolete. The user chose to make release wait for plan to finish on the default branch, including when plan fails. Comparing configuration hashes instead of the branch commit was considered but not selected.

## Configuration and job selection

- Keep `TASK_DEVSECOPS_TEST_DEPLOY_PATHS` in `.env.dist`, with `.env.dev` taking priority. Reuse Task's existing environment loading; do not introduce another configuration file or change its general precedence.
- Accept literal repository-relative files and directories, separated by spaces or newlines. Directories include descendants; a file matches only itself. Document a trailing slash as the unambiguous directory notation; preserve recognition of an existing directory without it.
- Generate `TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP`; users never maintain regex syntax. Match any changed path outside the configured list, so mixed MRs keep the normal pipeline.
- Empty, absent, unsupported or overlong lists produce the full-pipeline pattern `\A`. Enforce the 255-character limit before publishing. Unsupported input must have an actionable diagnostic, not silently broaden the allowed paths.
- Reject repository-root entries, parent traversal and wildcard syntax. Reject `project` and `project/` as whole-workspace entries. Reject any entry containing a path component exactly named `.config`, including `deploy/.config/` and `a/b/.config/file.yaml`.
- A changed file under any `.config` directory forces the normal pipeline even if an allowed ancestor contains it. For example, allowing `deploy/` must not exempt `deploy/.config/tool.yml`. Match path components, not substrings such as `.configuration`.
- Configuration files, tests and framework/control paths must not qualify for omission of their own checks. Protect
  `Taskfile.yml`, `Taskfile.yaml`, `AGENTS.md` and `CLAUDE.md` at every depth, including inside an allowed folder. A
  project must list deployment-only content, not a directory containing application code or tests. A forbidden entry
  disables optimization for the whole list rather than silently dropping that entry.
- Require GitLab 19.2 or newer for the updated CI configuration. The user explicitly declined compatibility with earlier versions; document the minimum and do not add a legacy YAML selection mechanism.
- Missing or empty generated variables select the normal pipeline. An existing stale but valid variable can still select the reduced pipeline: this is the accepted exception to the usual full-pipeline fallback.
- Outside merge-request pipelines, preserve existing job selection and behavior except for the agreed default-branch ordering of plan and release.

For a deployment-only MR, retain `code:commitlint`, `code:commitizen-check`, `code:commitizen-bump-dry`, `code:betterleaks`, `code:project`, `code:renovate-validate`, `code:megalinter`, `code:all` and `release` according to their existing rules. Preserve the project's Kustomize rendering through `code:project`.

Do not create `plan`, `build`, test jobs, `deploy`, `operate`, `monitor`, `feedback`, `code:lizard` or `no-cheat` for those MRs. Existing framework-specific gates, including storyboard coverage, keep their own applicable rules. Update dependencies such as `code:all` so absent optional jobs do not prevent pipeline creation.

MegaLinter checks the MR's changed files in this reduced mode. Confirm actual scanner behavior, not only `VALIDATE_ALL_CODEBASE=false`: use supported file modes and exclude scanners that require a whole-project run only in this mode. Other MRs retain their existing scans.

The older runtime deployment checks must not undo a full-pipeline decision: in the new supported CI path, a build, test or deploy job that GitLab creates must perform its work. Preserve separately supported legacy/local behavior without using it to weaken the new fallback.

## Synchronization

Add the task under `.config/devsecops/Taskfile.plan.yml` and its generated-project counterpart, with its implementation script under `.config/`. The intended entry point is `task devsecops:plan:deploy-only:sync`, called by the normal `task plan` flow.

On every eligible default-branch pipeline, even when environment files did not change:

1. Obtain the effective deployment-path setting and calculate the expected pattern.
2. Confirm this pipeline's commit is still the current default-branch tip before any write. If it is not, fail with instructions to run a pipeline on the current branch tip.
3. Read the project variable. Create it if absent, update it if different, and avoid unnecessary writes if already correct.
4. Read back and compare the stored value and relevant attributes. A lost write response is reconciled by reading before trying another write.
5. Report success only after verification. If the branch advanced during the operation, report that a current pipeline is needed instead of claiming the old commit is current.

Reuse `TASK_COMMITIZEN_TOKEN`, which the repository provisions with API permissions. Never print its value. Store the generated regex as a normal raw project variable, available to MR pipelines with environment scope `*`; it is configuration, not a secret.

Serialize participating `plan` jobs with a dedicated resource group. Recheck branch freshness after every retry wait and
immediately before mutation. Keep the strict current-commit check; do not replace it with configuration-hash comparison.
GitLab API writes cannot be made atomic with branch movement: another merge arriving during a request can leave a
temporary stale value until the current pipeline synchronizes it.

On default-branch pipelines, release waits for plan to finish, whether plan succeeds or fails. Preserve release's
existing `when: always` behavior and its own `release` resource group; do not share the two locks. This prevents the
same pipeline's release from advancing the branch during synchronization. It does not prevent another merge from
advancing it. Release accepts the added duration of plan, including retry waits, but does not require successful
synchronization. No `allow_failure` is added to plan: a synchronization failure remains visible.

Scope this ordering to default-branch pipelines using the existing release rules. Preserve the behavior of MR and tag pipelines, including deployment-only MRs where plan is not created. An absent plan job must not invalidate pipeline creation. Cancellation and manual job handling retain GitLab's existing behavior; the agreement covers success and failure of the normal automatic plan job.

Engineering convention: interpret the user's `main` as `CI_DEFAULT_BRANCH`, so projects with another default-branch name behave consistently. Local execution and non-default-branch execution do not mutate GitLab settings.

## Failures and recovery

The agreed default is three attempts for temporary failures: immediately, after 15 seconds, then after an additional 120 seconds. These are proposed practical delays, not measured optimal values. Keep requests bounded by explicit timeouts.

| Failure | Behavior and recovery |
| --- | --- |
| Transient network failure, timeout or temporary server error | Retry with the agreed delays; reconcile an uncertain write by reading its result. |
| Rate limit | Respect GitLab's `Retry-After` when supplied. If waiting would exceed the bounded run budget, fail clearly so the job can be retried later. |
| Missing, expired or revoked token; insufficient rights | Fail immediately with an actionable explanation. Waiting does not fix credentials. |
| Invalid configuration or pattern exceeding 255 characters | Publish and verify the full-pipeline fallback. If successful, report synchronization success with a clear warning that optimization is disabled and explain what to correct. If publication fails, fail `plan`; the usual stale-value risk remains. |
| Obsolete pipeline commit | Do not write. Direct the person to a new pipeline on the current default branch. |
| Read-back mismatch or unexpected API validation error | Fail visibly; report the discrepancy without exposing credentials. Do not claim synchronization succeeded. |

After exhausted attempts, `plan` fails. A Retry reruns the whole plan job and can recover if the commit is still current and the cause has disappeared. Otherwise start a new pipeline on the current default branch. The next eligible pipeline created on that branch after a merge also attempts synchronization. Token or configuration faults still require correction.

Engineering convention: a verified full-pipeline fallback is successful synchronization, even if an invalid list caused it. This avoids making an optional optimization failure block an otherwise usable plan phase. An intentionally empty list needs no warning. Existing failures in other plan tasks retain their normal status.

Release waits for plan on the default branch but remains allowed after a plan failure. This supersedes the original comment's fully parallel release behavior. No extra watchdog, scheduled repair pipeline or mandatory pre-merge synchronization is added.

## Accepted limitation

Until recovery, GitLab can use its last stored rule:

- With an unchanged deployment list, job selection is unchanged.
- Adding a deployment path can temporarily cost extra checks.
- Removing a deployment path can temporarily omit checks for a later MR that still fits the old list.

The user explicitly accepted this trade-off. Its probability has not been measured. A corrected variable applies to subsequently created pipelines; it does not add jobs back to an existing pipeline. When omitted checks matter, create a new MR pipeline after repair.

## Verification and delivery

Use the repository's TDD workflow and agent task runner. The existing local screenshots and draft tests are not evidence that this revised design works.

Prove configuration precedence, spaces/newlines, folder boundaries, exact files, empty/invalid/overlong settings,
missing variables, mixed changes and changes to configuration itself. Explicitly cover rejected `project`/`project/`
entries, `.config` entries at several depths, and a changed nested `.config` file under an otherwise allowed folder.
Include renames into deployment directories: moving code or tests must not hide their removal from outside the list.
Establish actual GitLab behavior for this case before claiming coverage.

Prove create/update/no-op/read-back, temporary failures, exhausted retries, uncertain writes, credentials failures, stale pipelines after waits and competing plan jobs. Demonstrate the accepted stale-value behavior and recovery. Tests may control time instead of actually waiting two minutes.

Prove on real GitLab that release waits while plan is running, starts after plan success and after plan failure, and keeps its prior behavior for a deployment-only MR without plan. Exercise the same-pipeline version-bump scenario and a different merge advancing the default branch during the wait. Verify the minimum version is documented; no older-version compatibility is promised.

Use real GitLab pipelines to show the expected present and absent jobs, and execute MegaLinter against a changed malformed deployment file to prove it still fails. Pair visible journey evidence with programmatic assertions and preserve tolerance-zero storyboard gates. Test selection and actual job execution are different claims.

Before delivery, run `devsecops:code:verify`, `devsecops:test:verify` and the exact MR pipeline, checking every required job. Keep the work on a dedicated MR; the user performs the merge. Preserve unrelated work in the current checkout.

Implementation was authorized with "ok go". The implementation plan records the selected standard-library API client, 30-second request timeout, 300-second synchronization budget and test structure. Its execution evidence distinguishes local validation from remote CI; commits, publication and merge remain separate actions.
