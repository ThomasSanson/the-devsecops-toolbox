# Review of MR !282: source publication

Review dates: 2026-09-04–2026-09-05.

This report records the review baseline for [MR !282][mr] and [issue #215][issue],
followed by the corrective branch's implementation and validation record.
The reviewed head is `52ce1cc75eb9d3816d019559a300714af4593e3a`, on
`add-source-publication`. The comparison is fixed to:

```text
git diff 1af19caa5bb0b5d1216150b35fbd26f626d54fa1...52ce1cc75eb9d3816d019559a300714af4593e3a
```

All implementation links below name that revision. Findings describe static
evidence at that revision, not a later working tree. Reproduction scenarios and
acceptance criteria are proposed checks, not claims that those checks ran.
The corrective implementation and execution record below are separate from
those original findings. The baseline sections do not claim that their proposed
checks ran; the execution record states what was actually exercised.

## Need and accepted scope

A project must keep its working repository private while publishing its source
to a second repository. A whole-repository mirror would also expose private
paths and their old revisions. The intended publication is therefore a new
filtered snapshot for each release, appended to a separate public history.

The important safety boundary is a reviewed grant of permission to publish each
path. An existing `src/**` allow rule must not authorize a newly added private
file without a new owner decision. The manifest supplies that path-level grant;
the GitLab approval discussion identifies the person who made it. Local runs and
CI must enforce the same publication policy.

The current MR description deliberately extends the initial issue in these
areas, so this review does not classify them as accidental scope expansion:

- Scan the outgoing snapshot for secrets, by default, with an explicit opt-out.
- Select a named branch or tag instead of publishing the current checkout.
- Support an isolated component installation that retains Copier, Renovate and
  the feedback phase needed to receive future framework updates.
- Repair the existing Renovate-to-Copier update path on which that installation
  depends.
- Provide setup and diagnostic tasks, installer consent, CI wiring and a nightly
  update schedule.
- Preserve existing project entry points and anchor the template README exclusion
  so component documentation reaches generated projects.

The requested review delivery is a separate branch and merge request targeting
`add-source-publication`. The user retains the merge decision.

## Guarantees to preserve and limits to state

| Contract                        | Meaning and boundary                                                                                                                                                                              |
|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Exact outgoing path set         | Only tracked paths allowed by the project, outside the deny floor and covered by the approved manifest may leave. A path grant is not an approval of every future change to that file's contents. |
| Mandatory deny floor            | Project rules may add exclusions. A missing or unreadable framework floor must not silently remove its protection.                                                                                |
| Owner decision                  | Approval must identify the owner, the specific publication decision and the manifest revision to which it applies. Resolving an unrelated review comment is insufficient.                         |
| Snapshot history                | Private commits are not copied into the destination. Previously public history remains public; this feature does not retract past disclosures.                                                    |
| Release traceability            | The public release commit and tag must identify the source revision, including releases whose public file contents did not change.                                                                |
| Explicit activation             | Disabled publication stays disabled. Manual publication requires an explicit action in both local and CI usage.                                                                                   |
| Scan before publication         | The scan must cover the same snapshot that will leave. A missing or failed scanner is not a successful scan. A scanner cannot establish that every private business fact is absent.               |
| Secret handling                 | Credentials must not appear in process arguments, printed URLs, job logs or repository configuration. Masked CI variables remain available to authorized jobs.                                    |
| Supported file types            | Unsupported Git objects or filters need a visible refusal or warning before an operator relies on the dry run.                                                                                    |
| Updatable isolated installation | An installed component must receive relevant framework updates while preserving project-owned rules and not adding unrelated components.                                                          |

Destination repository creation, withdrawal of already public information,
publication of private development history and destination branch locking are
outside the original issue's scope. The forge-independent operation is the Git
snapshot push; approval and automated setup currently depend on GitLab.

## Spec findings

`P1` denotes a material safety or authorization failure. `P2` denotes an
incorrect or incomplete supported workflow. These findings are assessed against
the issue and the current MR description, independently of repository style.

### SPEC-01 — P1: owner approval can be reused for a different manifest

**Requirement:** “what is published equals what was approved.”

[Approval lookup][pub-approval] selects the first merge request associated with
the last manifest commit. It then accepts any non-system note resolved by any
current owner. It does not identify the publication discussion, require the
relevant merged request, or bind the decision to the reviewed manifest contents.
[Refreshing an open request][pub-request] writes the next manifest and returns
without opening a new discussion or invalidating the old decision.

**Scenario:** an owner resolves the publication discussion; another file is
added; a second approval request refreshes the same open MR; the MR is merged.
The previous resolved note still qualifies even though its owner did not approve
the added path. An unrelated resolved comment by an owner can also satisfy the
lookup.

**Acceptance:** publishing requires a specific owner decision for the exact
manifest under review. Updating that manifest invalidates the previous decision;
an unrelated discussion or an inapplicable MR cannot authorize publication.

### SPEC-02 — P1: the enabled switch does not guard direct or isolated publication

**Requirement:** “Off by default everywhere.”

[The publication task][pub-task] always calls `publish.sh publish`.
[The command][pub-command] does not check `TASK_PUBLICATION_ENABLED`.
[The isolated CI jobs][pub-ci-jobs] do not check it either. Only
[the complete release chain][release-chain] tests the switch.

**Scenario:** an isolated project already has valid tokens, an approved manifest
and a destination. Its team sets `TASK_PUBLICATION_ENABLED=false` to stop future
publications. A later default-branch pipeline still invokes publication with the
same credentials.

**Acceptance:** `false` prevents publication through every supported entry
point, including the isolated pipeline. Any intentional override must be
explicit and documented.

### SPEC-03 — P1: the documented manual setting is overridden in CI

**Requirement:** “manual, where nothing leaves until somebody clicks.”

[The README's manual workflow][pub-manual-doc] sets
`TASK_PUBLICATION_ON=manual` in `.env.dist`.
[The CI include][pub-ci-mode] supplies `TASK_PUBLICATION_ON=release` as a pipeline
variable and evaluates its job rules from that value. That environment value
also takes precedence over the file in the script.

**Scenario:** an operator follows the README and selects manual publication in
`.env.dist`. With no separate GitLab variable overriding the CI include, the next
default-branch pipeline follows the automatic release rule instead.

**Acceptance:** the documented setting has the same meaning locally and in CI.
Job creation must use a clearly defined source of configuration, and an
automatic job must not bypass the project's manual policy.

### SPEC-04 — P1: publication credentials enter process arguments

**Requirement:** “The token never appears […] in argv.”

[Credential-store construction][pub-credential] interpolates the destination
token into the expression passed to `sed`. Clone-error redaction similarly
passes it in a `sed` argument. [The API wrapper][pub-api] passes its source token
as a `curl` header argument; [CI variable creation][pub-variable] passes secret
values through `jq --arg` and the JSON argument supplied to `curl`.

**Scenario:** another process with permission to inspect the publisher's process
arguments observes those commands while publication or setup is running. A
masked GitLab variable does not remove this local process exposure.

**Acceptance:** use synthetic credentials to verify that no child-process
argument contains either token. Protect any file or stream used instead and
preserve that property on error paths.

### SPEC-05 — P1: a missing deny floor is treated as an empty floor

**Requirement:** the framework floor is “always applied” and cannot be silently
emptied.

[Policy loading][pub-policy] replaces every failed `git show` with an empty
file, including `denylist.base`. [Pattern matching][pub-matching] also suppresses
Git errors. Publication therefore continues without reporting the loss of a
mandatory exclusion layer.

**Scenario:** a selected source ref omits the floor after an incomplete install
or update. Files normally prohibited by that floor become ordinary approval
candidates. The operator receives no failure indicating that the framework
protection is absent.

**Acceptance:** missing or unreadable mandatory policy files stop publication
with a useful error. Failure to evaluate exclusions cannot be interpreted as
“nothing excluded.”

### SPEC-06 — P2: unchanged snapshots and tag errors break release traceability

**Requirement:** “Each release produces one commit” and the release tag when one
exists.

[Snapshot push][pub-push] returns before creating a commit or tag when the
destination tree is unchanged. It also suppresses tag creation and tag-push
failures, then prints a successful publication message.

**Scenario:** two source releases differ only in private files. The second has
the same public tree, so its public release commit and tag are absent. Separately,
a destination that rejects a tag receives a branch update while publication
reports complete success.

**Acceptance:** distinct releases remain traceable even with identical public
content. Repeating the same release is idempotent. A tag conflict or rejected tag
push must produce an accurate incomplete/failure result and a safe retry path.

### SPEC-07 — P2: unsupported Git file types are not identified by the dry run

**Requirement:** “Submodules, LFS and symlinks” are outside the first version, and
“the dry run says so out loud.”

[Path enumeration][pub-paths] reads names without checking Git object modes or
LFS pointers. [Snapshot export][pub-export] passes that list to `checkout-index`.
The dry run contains no corresponding unsupported-type warning or refusal.

**Scenario:** an allowlisted Git submodule is counted as a file to publish even
though exporting ordinary indexed files does not export that submodule's source.
An operator cannot infer this omission from the announced file count.

**Acceptance:** cover each excluded type explicitly. The displayed publication
set must not promise content that the exporter silently omits or transforms.

### SPEC-08 — P1: component installation widens existing file permissions

The isolated installer calls `normalise_permissions` on the entire existing
`.config` tree and root entry points ([installer][publication-installer]). It
turns every regular file into mode `0644`, including unrelated project files.

**Reproduction:** a pre-existing executable with mode `0750` loses its executable
bit, and private data with mode `0600` becomes readable by other local users.
Both changes were observed through the real installer. The updated scenario
checks modes, file hashes and execution, before and after installation.

**Acceptance:** normalize only newly rendered component files. Existing project
files retain their contents and permissions.

### SPEC-09 — P1: component installation replaces a complete project's answers

The same installer unconditionally copies the scratch render's
`.config/devsecops/.copier-answers.yml` over the project's current answers.
The scratch render selects publication-only defaults. The next Copier update
therefore no longer describes the original project.

**Reproduction:** a real complete Copier project with `container_runtime: podman`
and `project_enabled: true` receives publication-only answers with Docker and
the workspace disabled. The installer returns success. The new refusal scenario
records every existing file hash and mode before attempting installation.

**Acceptance:** detect a complete installation before any component copy and
direct its owner to `task copier:update` with `source_publication=true`. Keep
all existing files and choices intact; do not splice a partial render into the
existing complete installation.

## Standards findings

These findings use the repository's written rules. They remain separate from
Spec findings: a suitable implementation can still lack the required proof, and
a well-presented proof can still exercise an incomplete contract.

### STD-01 — P2: the nightly CI claim is represented by a local reconstruction

**Rules:** [tests-integrity.md][rule-integrity] requires the actual GitLab page
when the fact lives in CI, preserves real terminal output and limits narration
to the available evidence. [ai-delegation.md][rule-ai] requires the command's
execution verdict.

[The update fixture][update-project] disables CI on its project.
[`runFeedback`][update-run] executes `task feedback` locally and catches process
failure without propagating its exit status. The following rendering removes
ANSI colors. [The nightly-check card][update-card] then renders that result into
a `<pre>` frame.

**Scenario:** local Renovate produces the expected MR while the installed
scheduled pipeline cannot run. The storyboard can still show an apparent
nightly success because it never executes that schedule. A failing local process
can also continue into later assertions if it printed the expected fragments.

**Required proof:** preserve the command verdict and use a real pipeline/job page
for the schedule claim, or explicitly narrow the story to the local feedback
workflow.

### STD-02 — P2: the fixture supplies a protection absent from isolated setup

**Rule:** [tests-integrity.md:117][rule-integrity] requires evidence that the named
actor actually caused the claimed guarantee.

[The source-publication fixture][source-setup] directly enables
`only_allow_merge_if_all_discussions_are_resolved`. The complete framework has a
separate merge-settings task, but isolated `publication:init` does not establish
or verify this setting.

**Scenario:** a newly isolated project reaches an approval MR without the
fixture's extra setup. Its merge button need not be blocked while the discussion
is unresolved. The pictured blocking behavior does not establish the isolated
installation's guarantee.

**Required proof:** exercise the supported setup path from a project without
that protection and observe the real merge-state result. If an operator must
configure it separately, make that prerequisite explicit.

### STD-03 — P2: the new doctor workflow has no corresponding storyboard proof

**Rules:** [tests-integrity.md:22–27][rule-integrity] requires visible evidence for
each product change; [tdd-cycle.md][rule-tdd] includes behavioral scripts under
`.config/`.

[`cmd_doctor`][pub-doctor] adds an interactive workflow covering owners,
destination, credentials, schedule, CI inclusion, scanner availability and the
enabled switch. The reviewed diff supplies no scenario, assertion or storyboard
card exercising that workflow.

**Scenario:** doctor gives an inaccurate “nothing missing” answer or enters setup
unexpectedly; the three added publication stories do not exercise that path.

**Required proof:** a visible, programmatically asserted journey for meaningful
complete and incomplete configurations, including the interactive handoff when
offered.

### STD-04 — P2: token narration claims more than the assertion establishes

**Rule:** [tests-integrity.md:118][rule-integrity] requires narrowing a claim when
its evidence cannot establish it.

[The installation story][install-token-claim] says no job can print the stored
tokens and nobody can read them back. [Its assertion][source-token-check] only
checks `masked` and `protected`. GitLab documents masking as log redaction and
protection as restriction to eligible pipelines; neither makes a token
inaccessible to the jobs that receive it. Hiding a value in the settings UI is a
separate option. See [GitLab CI/CD variable documentation][gitlab-variables],
checked on 2026-09-04.

**Scenario:** an authorized job receives the masked variable as an environment
value. That is compatible with both tested flags and incompatible with the
story's unrestricted secrecy claim.

**Required proof:** say precisely that the variables are masked and protected,
and assert any additional property separately before claiming it.

### STD-05 — P3: new multi-line shell logic remains inside Taskfiles

**Rule:** [code-style.md:16][rule-style] requires scripts to be externalized.

[Copier scope resolution][copier-scope] and
[the release publication guard][release-chain], including its
[Jinja counterpart][release-jinja], add multi-line shell logic inside Taskfiles.

**Scenario:** changes to scope resolution or publication gating must be
maintained inside orchestration YAML, including duplicated template logic.

**Required change:** keep task wiring declarative and put the behavioral shell
logic behind the repository's normal script entry points.

### STD-06 — P2: a new ShellCheck suppression has no visible exemption

**Rule:** [ai-delegation.md:48][rule-ai] forbids silencing a linter; its documented
exception requires an explicit `No-cheat-exempt` commit trailer.

[The scanner fallback][pub-shellcheck] introduces
`shellcheck disable=SC2086`. The reviewed commit range carries no corresponding
exemption.

**Scenario:** the scanner command's unquoted optional arguments bypass the check
instead of satisfying it.

**Required change:** remove the need for suppression through explicit argument
construction, or record an applicable, reviewable exemption under the written
rule. This report does not recommend weakening the guard.

### STD-07 — P3: new fixed sleeps replace observable readiness conditions

**Rule:** [tests-integrity.md:130][rule-integrity] prohibits hardcoded `I.wait`
delays and requires stable, observable conditions.

Examples occur in `source-publication.js` at
[lines 323][source-wait], 447 and 1235, and `publication-update.js` at
[line 296][update-wait] and 421.

**Scenario:** a slow runner has not reached the intended UI state after the
delay, or a fast runner repeatedly waits after the state is already ready.

**Required change:** wait for the terminal, page or remote fact needed by the
next action, with a bounded timeout.

### STD-08 — P1: a zero baseline-update flag silently enables regeneration

[The Taskfile][baseline-forwarding] treats every non-empty
`TASK_E2E_UPDATE_BASELINES` value as true and forwards `1` to the test process.
[The storyboard helper][baseline-mode] and the page helper also test whether
the variable is non-empty rather than whether it equals `1`.

**Scenario:** a maintainer runs the complete suite with the apparently disabled
value `0`. A pixel comparison fails, but update mode replaces the reference and
the scenario passes. During this review, the run changed three existing PNGs
while reporting 24 successful scenarios. It cannot certify strict comparisons.

**Required change:** only the documented explicit value `1` may regenerate
references locally. An unset value and `0` must fail on real pixel differences,
preserve the original reference, and never enable update mode through Task.
CI must continue to reject deliberate regeneration.

## Decisions and follow-up evidence

### DEC-01 — GitLab.com Free installation support

The issue requires a sign-off path without Premium approval features. That does
not make every setup API available on every Free offering. GitLab's current
documentation says project access tokens require Premium or Ultimate on
GitLab.com, while Self-Managed and Dedicated support them with any license.
See [Project access tokens][gitlab-project-tokens], checked on 2026-09-04.

[`init_token`][pub-init-token] always creates a project access token for Renovate
and publication. A successful test against the repository's self-managed GitLab
therefore does not establish that this setup works on GitLab.com Free.

**Decision needed:** explicitly support an alternative credential setup for
GitLab.com Free, or constrain the supported installation offering before
advertising a Free-compatible end-to-end workflow. Reading owner sign-off and
creating a project token are different capabilities and need separate evidence.

### DEC-02 — Separate the portable publisher from GitLab setup responsibilities

The issue proposes one POSIX publisher and a narrow forge approval seam.
At the reviewed revision, `publish.sh` is 1,156 lines and includes policy
selection, secret scanning, snapshot pushes, GitLab approvals, token creation,
CI variable management, schedules, dotenv editing and interactive diagnostics.
[Setup and scheduling][pub-init-token] are additional forge-specific concerns,
not only the four approval functions described by the file's introduction.

**Decision needed:** preserve one policy implementation while defining a clear
boundary between exporting/pushing a snapshot and performing GitLab
administration. A future forge adapter should not need to copy or modify the
publication safety algorithm. The line count identifies the breadth of
responsibility; it is not itself a correctness failure or a request for a large
rewrite before the safety defects are addressed.

### DEC-03 — Prove the schedule independently of local feedback

The local `task feedback` journey is useful evidence that Renovate can discover
and apply an update. It does not prove that an installed GitLab schedule starts
the correct pipeline, uses eligible protected variables, executes the intended
jobs and produces the same reviewed update.

[Schedule setup][pub-schedule] uses the current checkout branch, recognizes an
existing schedule only by description, and reports creation failure as a warning.
Those behaviors make the installed schedule a separate object to validate.

**Evidence needed:** run the installed schedule against a real isolated project,
record the schedule ref and resulting pipeline/job links, inspect their terminal
statuses, and verify the resulting update MR. Include setup from a feature
branch or detached checkout and an existing inactive or misdirected schedule.
Until then, describe the existing story as local feedback execution, as required
by STD-01.

### DEC-04 — Define how a previously created tag can obtain approval

[The documented manual-tag workflow][pub-manual-doc] selects an existing tag,
opens an approval MR targeting the default branch and then publishes the tag.
[Policy loading][pub-policy] nevertheless reads the manifest from that immutable
tag. If that manifest lacks the requested grant, merging a newer manifest on the
default branch does not change the selected tag, so publication keeps refusing.

**Decision needed:** either require approval before creating a publishable tag,
with documentation that says so, or define an independently versioned approval
record that authorizes that exact tagged source. An implementation must not
silently move the source tag to make this workflow appear successful.

## Review result at the pinned revision

Spec: nine findings, with P1 approval, activation and installation failures among the most
serious. Standards: eight findings, including the P1 regeneration switch and
P2 gaps in the fidelity and coverage of
the evidence. Decision follow-ups are recorded separately; neither a green
aggregate pipeline nor a later documentation edit closes these findings without
evidence for the relevant behavior.

## Corrective implementation

The branch `fix/publication-review-282` starts at the reviewed head and targets
`add-source-publication`. It keeps the snapshot/manifest approach, the existing
DevSecOps phases and the optional component installation. The review report is
under `project/tests/`, which Copier excludes from generated projects.

### Spec disposition

| Finding | Correction and proof contract                                                                                                                                                                                                                                                                                                                                               |
|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SPEC-01 | Require a resolvable, resolved publication discussion containing the exact manifest blob hash, on a merged MR, without an edit after resolution. Refresh changed or edited questions; an unsigned manifest can request a signature without adding a path. Contracts: `unrelated-signoff`, `stale-signoff`, `edited-signoff`, `approval-refresh`, `approval-thread-failure`. |
| SPEC-02 | Enforce the activation switch inside the publisher before forge access or a destination push. Contract: `disabled`.                                                                                                                                                                                                                                                         |
| SPEC-03 | Remove the CI default that overwrote the project's choice. Enforce manual and tag-only modes again at runtime. Document the CI variable needed to create the right jobs. Contracts: `manual-ci`, `tag-ci`.                                                                                                                                                                  |
| SPEC-04 | Send API headers/bodies through stdin; supply Git credentials through an environment-backed helper, with no token in its file. Reject credential-bearing target URLs without echoing them. Contracts: `credentials-argv`, `credential-url`.                                                                                                                                 |
| SPEC-05 | Require every policy file and propagate matcher errors. Contract: `missing-floor`.                                                                                                                                                                                                                                                                                          |
| SPEC-06 | Publish identical bytes for a new release with a distinct release commit; push branch and tag atomically and reject tag conflicts. Verify retry/tag behavior explicitly. Contracts: `unchanged-release`, `tag-conflict`, `late-tag`.                                                                                                                                        |
| SPEC-07 | Refuse symlinks, submodules and Git LFS pointer files before advertising the snapshot. Read ordinary file contents and executable modes directly from Git objects. Contracts: `unsupported-symlink`, `unsupported-lfs`, `committed-bytes`, `option-path`.                                                                                                                   |
| SPEC-08 | Set modes on scratch-rendered files only; preserve unrelated executable and private files. Journey: `@publication-only`.                                                                                                                                                                                                                                                    |
| SPEC-09 | Check existing Copier scope before either component is copied; refuse replacement of complete answers with the supported Copier update command. Journey: `@publication-existing-framework`.                                                                                                                                                                                 |

Additional review findings closed by the implementation:

- An uncommitted smudge filter could alter exported bytes. Export now reads
  Git blobs, and the public index is built from those same objects. A tracked
  file remains publishable even when `.gitignore` matches it (`ignored-paths`).
- `TASK_PUBLICATION_SCAN=done` was an unverified assertion that skipped scanning.
  Only `required` and the explicit `off` choice remain. The publication job
  scans its own snapshot even after the earlier scan job (`unverified-scan`).
- API errors could masquerade as an approval request. Failed commits, MR
  creation and discussion creation now fail the command (`api-failure`).
- A dry run could query the approval API or fetch a missing source ref. Check
  now uses only local data and identifies a missing ref (`offline-check`,
  `offline-missing-ref`).
- Setup revoked a working token and deleted CI variables before their
  replacements were stored. Variables are updated in place; the old token is
  revoked after both replacement values are stored. Setup schedules the default
  branch, enables the discussion merge gate and delays activation until its
  required setup steps succeed (`init-token-failure`, `init-variable-failure`,
  `init-settings`). Partial API updates are not transactional: both tokens can
  remain active after a failure and require inspection.

The second review of the corrective diff also identified defects to cover:
an export error could be swallowed inside a conditional scan, a later blob-read
error could become an empty public file, and a tag added
after the first publication of its source commit could be missed by the retry
shortcut. These are explicit `export-failure`, `index-failure` and `late-tag` regressions in the
new contract journey.

The quality run also found vulnerable transitive dependencies already present
in the reviewed branch. The correction updates existing lockfile resolutions:
`fast-uri` to `3.1.7` in both toolchains, `qs` to `6.16.0`, and
`@xmldom/xmldom` to `0.9.12` through an explicit transitive override. No new
library is introduced. The test image was rebuilt with the resulting lockfile;
both npm audits and the subsequent OSV scan reported no vulnerabilities.
The published fix ranges are documented by the maintainers:
[fast-uri](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8),
[qs](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g),
[xmldom](https://github.com/xmldom/xmldom/security/advisories/GHSA-6gmq-8vp8-gcm6).

### Standards disposition

| Finding | Disposition                                                                                                                                                                      |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| STD-01  | Remains a follow-up: the Renovate journey does not prove execution by a real scheduled GitLab pipeline. Its local feedback invocation must not be treated as that evidence.      |
| STD-02  | Setup now enables the discussion merge gate. The isolated-installation journey additionally checks the resulting project setting via the real GitLab API.                        |
| STD-03  | Remains a follow-up: doctor needs its own narrative journey and machine-readable readiness semantics. Its current limitations are documented.                                    |
| STD-04  | Corrected the token narration and README. A failed variable assertion also reports only masking/protection flags, never the variable value.                                      |
| STD-05  | Remains a focused refactor follow-up for the existing Copier/release task shell blocks.                                                                                          |
| STD-06  | Removed the added ShellCheck suppression by constructing scanner arguments with POSIX positional parameters.                                                                     |
| STD-07  | The merged-MR capture now waits for the source branch's actual deletion and fails on API errors or an exhausted wait. Other existing fixed waits remain a follow-up.             |
| STD-08  | Only the exact value 1 permits local regeneration. The new baseline-mode journey checks both real helpers, Task forwarding and reference bytes; CI regeneration stays forbidden. |

The new contracts use real disposable Git repositories and real shipped task
entry points. Their approval/setup API is explicitly simulated; the existing
source-publication and isolated-installation journeys exercise GitLab itself.
Ordinary Git contracts explicitly disable scanning; the two Git-read failure
contracts inject a controlled scanner to establish operation order. They do not
measure secret detection. The existing source-publication journey exercises the
real scanner and checks that an injected secret blocks the pipeline and never
reaches the public repository.
The contract storyboard retains every preparation/result pair in one scenario,
instead of overwriting one SVG for each Scenario Outline example.

Running both installer scenarios sequentially exposed an existing cleanup race.
The first scenario's asynchronous teardown read the next scenario's global token
list and revoked its fresh token. GitLab request timestamps and a controlled
replay of the actual teardown callback reproduced that order. Teardown now
captures its own resources before awaiting deletion and does not clear its
successor's state. The scenario assertions remain unchanged.

The merged-publication screenshot also exposed a GitLab background-work race:
the MR becomes merged before the requested source-branch deletion completes.
A controlled replay of the actual step callback failed before the correction.
The callback now queries the specific source branch until its disappearance,
with at most 30 reads. The replay passes immediate and delayed deletion, refuses
403/500 and inconsistent responses, and refuses an exhausted wait. The original
"Deleted the source branch" reference remains unchanged.

### Remaining design decisions

- Keep the reviewed grant path-based. Changing content at an already approved
  path does not require a new owner decision; secret scanning is an additional
  check, not a content-review system.
- Keep GitLab.com Free setup manual, with the documented account-token route.
  Automated project-token creation is unavailable there; no fallback is claimed.
- Separate the portable publisher from GitLab initialization/diagnostics in a
  subsequent refactor. That separation should preserve the present contracts.
- Approval lookup currently examines the first merged MR and up to 100
  discussions. Ambiguous histories or larger discussions can refuse a valid
  approval; broader lookup needs separate pagination/selection coverage.
- An old immutable tag missing the required approved paths needs a new release
  containing the approved manifest. Editing the main branch cannot change the
  old tag's policy.
- The nightly feedback schedule and manual publication job share a pipeline.
  Their ordering deserves a dedicated scheduled-pipeline test; the current
  local Renovate journey does not settle it.
- The RED guard accepted undefined-step and fixture-TypeError failures during
  development. Manual inspection rejected those runs as product evidence;
  strengthen the guard's infrastructure-error classification separately.
- Release naming uses Git's tag selection when several tags name the same
  source commit. Define the desired alias preference, including a configured
  source tag, before claiming support for every multi-tag release workflow.
- The default JavaScript linter skips hidden `.config/codeceptjs` paths. The
  changed regeneration comparisons are exercised by the real browser helpers;
  explicit lint coverage of this hidden tool directory remains a follow-up.
- The branch secret scan examines committed changes only. Run it after
  committing as well as during local development; scanning the working
  tree separately would close this gap in the pre-commit checks.
- MegaLinter reports obsolete `REPOSITORY_GITLEAKS` and `REPOSITORY_KICS`
  configuration entries as ignored. Clean up these existing entries in both
  `.config/megalinter/config.base.yml` and its Jinja twin separately. The final
  quality result is evidence for the scanners that actually ran.

### Execution record

Commands run from the corrective checkout through Task:

- RED: the new contracts failed on their own assertions before each behavioral
  correction. `task devsecops:test:check:red-is-real -- @publication-contracts`
  accepted the valid failures, including the post-scan Git read failure. The
  installer additionally reproduced mode changes and replacement of full Copier
  answers; its refusal assertion was certified with
  `task devsecops:test:check:red-is-real -- @publication-existing-framework`.
- Build: `task project:build:tests` succeeded after the dependency changes.
  Test image: `sha256:b8c3e134c303076acf6db0ef8e291e29e51c76dd2ee6325b643143a364725481`.
- GREEN: `task project:test:e2e -- --grep '@publication-contracts'` passed all
  27 contracts in one scenario. Its 54 preparation/result PNGs were regenerated
  with `TASK_E2E_UPDATE_BASELINES=1` and individually inspected. New cards use
  enough viewport height to avoid a reproduced Chromium font change during
  captures extending beyond the viewport; the capture rendering is unchanged.
- GREEN: the combined `@publication-only|@publication-existing-framework` run
  passed both real installer journeys, including the entire existing project's
  file hashes/modes and the absence of unwanted copied files. Their new images
  were inspected as well.
- Quality: `task devsecops:code:verify` succeeded, including the no-cheat gate,
  shell/JavaScript checks and vulnerability scanners. After correcting two
  advisory Markdown table-alignment findings, the complete quality gate was
  rerun and reported that all files were linted without errors.
- An initial full run with `TASK_E2E_UPDATE_BASELINES=0` exited 0 with 24
  scenarios passed in 32 minutes. Inspection found three regenerated PNGs,
  exposing STD-08. This run is explicitly rejected as strict visual evidence.
  The two Renovate images changed because the explicit dependency override
  increases the detected npm dependencies from 16 to 17; these were inspected.
  The merged-MR image was restored and its asynchronous deletion race corrected
  as described above. Existing TDD storyboard images were synchronized with
  their already committed PNGs, and the publication-update caption was aligned
  with its existing Gherkin description; neither change alters an assertion.
- The baseline-mode journey first failed on the actual Task forwarding of 0;
  the RED guard certified that assertion. After correction, both real visual
  helpers reject changed pixels with an unset flag or 0, accept explicit local
  regeneration with 1, and reject it with CI set. The final targeted strict
  run with 0 passed; all five PNGs and its SVG retained their SHA256 hashes.
  The five images were inspected after their viewport was sized to contain
  each complete transcript. The test copy was removed after the scenario.
- The test image was rebuilt for the corrected storyboard engine:
  `sha256:e31b54ced4d1958554e1a2fe628ef1bcd5bd6ff3a153e785576f3d6c6e4e8123`.
- Final strict: `task devsecops:test:verify` ran with the regeneration flag
  removed from the environment and explicitly empty in Task. It exited 0:
  all 25 scenarios passed in 33 minutes. An independent SHA256 comparison
  confirmed that all 317 PNG and SVG proofs remained byte-identical during
  this run. No visual reference was regenerated.
- Final quality: `task devsecops:code:verify` exited 0 after the last
  JavaScript formatting corrections. Its no-cheat gate, configured linters
  and vulnerability scanners passed. Final report edits receive a separate
  Markdown and spelling check before the commit.

The branch-history scanner classified even an obvious dummy literal in the
URL-rejection fixture as a generic password. The fixture now generates a fresh
random credential at runtime. The non-disclosure assertion checks the raw
command output against `target.password` before any result reaches a card.
Only the preparation card replaces this random value with a visible generated
credential marker. No scanner exception was added. The one setup PNG and its
embedded SVG image were updated and inspected. The same 27 contracts then
passed with regeneration disabled; all 317 proof hashes remained unchanged
during this targeted strict run. The complete 25-scenario run above predates
this fixture adjustment. Remote results for the amended commit are recorded
on the corrective MR.

The first CI installer job also exposed a difference in its fixture directory:
only the `.config` listing had the background color for a directory writable by
others. The preparation used plain `mkdir`, so its mode depended on the caller's
umask. Replaying that exact command with umask 000 produced mode 777 instead of
the local 755. The fixture now creates that directory explicitly with mode 755;
the command passes with umask values 000, 022 and 077 and preserves an existing
directory's mode 700. The installer still preserves project permissions. The
original screenshot is retained, and both installer journeys are rechecked
strictly after this fixture correction.

### Final review of editable approval notes

The final independent review found a second way to reuse an owner decision:
GitLab [keeps the resolution fields when a note is edited][gitlab-note-edits]. An
author could therefore replace a previously resolved comment with the exact
publication marker after the owner answered. The marker alone did not close
SPEC-01.

This behavior was verified against the local GitLab CE 19.2.4 test instance,
using temporary users, projects and tokens. Sixteen normal resolutions through
both REST endpoints set `updated_at` exactly equal to `resolved_at`. Editing
the body retained the resolver and old resolution time. In the note-level
example, `updated_at` moved from `2026-09-05T01:57:12.507Z` to
`2026-09-05T01:57:12.777Z`, while `resolved_at` remained at `.507Z`. Reopening and
resolving again recorded a new decision. REST preserved millisecond precision;
the GraphQL response omitted fractions and was unsuitable for this comparison.
All temporary projects were confirmed absent, and the proof's users and tokens
were removed or revoked after the measurement.

The shared approval-note filter now requires valid UTC timestamps and a
resolution at least as recent as the last edit. It compares normalized decimal
fractions without rounding, rejecting missing or invalid dates. Both approval
lookup and question reuse apply this filter, so an edited question cannot
prevent a fresh request. A replay of the actual helper passed all 22 recorded
REST states and 28 additional timestamp cases, including nanosecond differences,
different fractional precision and invalid calendar dates.

The added `edited-signoff` contract first failed because the shipped publication
command accepted the edited note. Its Gherkin RED was certified by
`red-is-real`. GREEN then proved zero public commits and a new discussion
request. The contract collection now contains 28 cases and 56 PNGs. The two new
images and three setup images extended with timestamps were individually
inspected. The earlier 25-scenario strict run predates this final correction.

### Additional CI finding: interrupted workers can report success

On corrective revision `efca3f403b38a8b900321b57cca0a7ae6b252601`,
[test job 7/9][ci-incomplete-workers] was green despite completing neither of
its two selected scenarios. The trace records both workers being terminated
after inactivity, both exiting with code 1, then CodeceptJS reporting
`OK 0 passed` with exit code 0. No JUnit file was produced. Inspecting the
reports, rather than the job color alone, exposed this material evidence gap.

The acceptance criterion is that every selected scenario has a completed,
successful result from the current run. A successful worker cannot cover a
missing result from another worker, and reports from an older run cannot
establish completion. File selection and local grep filters must remain
consistent with the engine's selection. This is a separate failure from the
visual-regeneration switch described in STD-08.

The task now wraps the real parallel engine with a completion check. It derives
the selected full scenario titles with CodeceptJS's own Gherkin parser and
Mocha filters, then requires fresh, successful JUnit records for that exact
selection. Missing results, duplicate titles across workers, failed or skipped
last attempts and unexpected results all fail the command. Unsupported run
options fail explicitly. The container's old reports are removed before the
launch; artifact synchronization also removes old host JUnit reports before
copying the current ones.

The added `worker-completion` scenario uses actual worker exits, first alone
and then beside a worker completing two Outline examples. A real successful
run seeds earlier reports before each refusal check. The task accepted both
incomplete runs in RED; `red-is-real` certified that assertion. GREEN rejects
both, while grep and inverted grep accept the two selected examples and
exclude an unselected feature. The strict replay of this scenario and
`baseline-mode` completed both selected scenarios and left all 11 associated
PNG and SVG hashes unchanged. The suite now selects 26 distinct scenarios.
Four new worker proof images and the four affected task-preview images were
inspected individually; no pixel tolerance was changed.

That CI run also exposed existing preparation weaknesses:

- Four test jobs exhausted their 45-minute limit after the Ubuntu image's apt
  update/install layer alone took 28 to 34 minutes. The suites started with
  only 3 to 11 minutes left. The traces establish this preparation cost, not
  a particular network cause.
- Both attempts of `fresh-machine` failed while preparing the bare container,
  before copying or executing the installer. `execInContainer` ignores a
  caller's timeout and uses 120 seconds, while `runCommandWithResult` discards
  the child process error and signal. A controlled replay proves that this
  loses an `ETIMEDOUT` diagnostic; the empty CI error alone does not prove
  that this was the actual cause of those two failures.
- The first `release-window` attempt failed with HTTP 422 when recreating
  the protected main branch. Its setup deletes the existing protection and
  ignores deletion errors, then creates it again. This separate fixture needs
  a reliable update and an explicit readiness check.
- The later installer attempts also stopped during environment setup. The
  saved log from [job 2/9][ci-installer-two] ends in Python installation through
  apt. [Job 4/9][ci-installer-four] records an Ubuntu package-index size
  mismatch, retries initialization, and ends at the same Python installation
  step. These artifacts locate the failure more precisely than the outer
  installer's generic completion timeout.

These setup functions were unchanged by the corrective revision. Their
failures and the incomplete-worker success are not accepted as passing test
evidence. The final corrective MR records the pipeline of its delivered head.

### CI exposed a duration mask and an installer retry defect

The first [test 3/9 attempt on the next revision][ci-duration-install] failed
two scenarios. The completion guard correctly rejected this incomplete run
with four of six selected scenarios successful.

The TDD storyboard differed only in its duration: the actual frame contained
`// 1m`, while its reference contained `// <duration>`. The existing normalizer
recognized milliseconds and seconds but omitted minutes. The 126 changed
pixels, or 0.058874% of the frame, all belong to that duration. Both the
normalizer and the PNG reference were unchanged from the reviewed parent.
The correction includes minutes in the same duration field; it preserves
the assertion, the failure verdict, the reference image and zero tolerance.
The failed CI JUnit report passed `check:red-is-real`, and a replay of the
actual summary failed before the correction and passed afterward.

The piped installer failure has a separate chain, proved by its persistent
log: the first push created `init-framework-devsecops`, but the immediately
following merge-request API call returned HTTP 400, saying that the source
branch did not exist. The installer treated this as missing prerequisites
and restarted initialization. Its supposedly idempotent branch script used
`git checkout -B` from main again, recreated the commit and failed its second
push with a non-fast-forward rejection. The process exited with code 201,
but the outer fixture watched only a success marker and waited until its
fifteen-minute timeout. This is not evidence of an apt failure.

These unchanged installer functions need a separate correction: preserve the
existing proposal commit during retries, wait for the pushed branch to be
visible before creating its MR, distinguish configuration failures from
missing prerequisites, and surface a terminated installer immediately.
Retrying the entire CI job does not establish that these defects are fixed.

### Final local verification

After the editable-note and worker-completion corrections,
`task devsecops:code:verify` passed the configured linters and scanners.
The final `task devsecops:test:verify` ran with the regeneration environment
variable absent and its Task override empty. All 26 selected scenarios passed;
the completion guard certified 26 of 26, and the three current JUnit files
contain a successful result for every scenario, without duplicate distribution
across workers. SHA256 comparison confirmed that all 324 reference PNGs and
storyboard SVGs remained byte-identical across this full run.

The final audit text is checked separately after recording these results.
The branch-history secret scan is repeated on the actual committed revision
before pushing. Remote validation is recorded in the corrective MR, against
its delivered commit, rather than inferred from this local success.

Invalid undefined-step, fixture-TypeError and revoked-test-token runs were
rejected as product RED evidence. The revoked token was traced to the teardown
race described above. The first quality attempt could not resolve a Git
worktree's external metadata from its scanner container, so validation moved
to a separate full clone. No gate or assertion was disabled for these problems.

[mr]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/merge_requests/282
[issue]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/issues/215
[pub-approval]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L670-703
[pub-request]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L725-805
[pub-task]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/Taskfile.yml#L115-136
[pub-command]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L497-550
[pub-ci-jobs]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/gitlab-ci.yml#L73-99
[release-chain]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/devsecops/Taskfile.release.yml#L39-53
[release-jinja]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/devsecops/Taskfile.release.yml.jinja#L39-53
[pub-manual-doc]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/README.md#L195-217
[pub-ci-mode]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/gitlab-ci.yml#L26-30
[pub-credential]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L560-590
[pub-api]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L647-656
[pub-variable]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L876-890
[pub-policy]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L260-278
[pub-matching]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L195-199
[pub-push]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L600-631
[pub-paths]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L284-301
[pub-export]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L336-340
[pub-doctor]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L992-1060
[pub-shellcheck]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L388-397
[pub-init-token]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L893-935
[pub-schedule]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/publication/publish.sh#L941-958
[rule-integrity]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.agent/rules/tests-integrity.md
[rule-ai]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.agent/rules/ai-delegation.md
[rule-tdd]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.agent/rules/tdd-cycle.md
[rule-style]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.agent/rules/code-style.md
[update-project]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/publication-update.js#L393-405
[update-run]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/publication-update.js#L331-362
[update-card]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/publication-update.js#L440-447
[source-setup]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/source-publication.js#L701-709
[source-token-check]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/source-publication.js#L1258-1265
[install-token-claim]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/features/01-install/publication-only.feature#L39-42
[copier-scope]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/copier/Taskfile.yml#L85-97
[source-wait]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/source-publication.js#L323
[update-wait]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/tests/e2e/support/steps/publication-update.js#L296
[gitlab-project-tokens]: https://docs.gitlab.com/user/project/settings/project_access_tokens/
[gitlab-variables]: https://docs.gitlab.com/ci/variables/
[publication-installer]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/devsecops/install.sh#L637-738
[baseline-forwarding]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/project/Taskfile.yml#L213
[baseline-mode]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/blob/52ce1cc75eb9d3816d019559a300714af4593e3a/.config/codeceptjs/storyboard.js#L254-276
[gitlab-note-edits]: https://gitlab.com/gitlab-org/gitlab/-/blob/master/app/services/notes/update_service.rb#L92
[ci-incomplete-workers]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/jobs/16320948484
[ci-installer-two]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/jobs/16321203953
[ci-installer-four]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/jobs/16321204821
[ci-duration-install]: https://gitlab.com/digital-commons/devsecops/the-devsecops-toolbox/-/jobs/16321705126
