# Source publication

Publish this repository's source to a **second, public repository**, minus the
files the team decided never leave, and only after an owner approved the exact
list.

It exists for one situation: a project that has to live in a **private**
repository and, at the same time, **publish its source**. Copying it by hand is
how a deployment secret ends up on the internet, and the forge's own mirroring
copies everything, history included, with no way to leave a file out.

## What it publishes

A **filtered snapshot of the selected source commit**. Publication copies the
stored Git file contents directly, without checkout filters, line-ending
conversion or working-copy edits. Regular files retain their executable bit.
Symlinks, submodules, Git LFS pointers and paths that the line-based manifest
cannot represent are refused; exclude them before publishing.

Each newly published source commit gets a public commit, even when its selected
files have the same contents as the previous publication. Retrying the same
source commit with the same public tree creates no duplicate commit. When the
source commit has a release tag, the public branch and tag are pushed
**atomically**: both are accepted, or neither is changed. An existing conflicting
tag or a server that cannot accept the atomic push stops publication.

There is no force-push and no copying of private Git history. Files excluded
from every publication are absent from the history this component creates. The
public repository reads as a publication log:

```text
publish 1.4.0

Source: https://gitlab.example/group/field-reporting
Commit: 3f2a1b9c…
Files:  4 published, 2 withheld
```

Authorship and day-to-day history are not copied. The public commit records the
source repository URL, source commit and publication counts, as shown above.

## The files that decide

Everything lives next to this README.

| File            | Owned by        | What it does                                                      |
|-----------------|-----------------|-------------------------------------------------------------------|
| `allowlist`     | your project    | What may be published. What it does not match never leaves.       |
| `denylist`      | your project    | What must never be, even when the allowlist matched it. It wins.  |
| `denylist.base` | **the toolbox** | The floor: `.env`, private keys, `*.tfstate`… Always applied.     |
| `owners`        | your project    | Who may approve what becomes public, one forge username per line. |
| `manifest`      | written for you | The exact list of paths somebody approved.                        |

Patterns use **gitignore syntax**, evaluated by Git: a path (`README.md`), a
folder (`docs/`) or a glob (`src/**`). The manifest stores one path per line.
Names Git must quote, such as names containing tabs or newlines, and names that
would be read as manifest comments are refused instead of being misinterpreted.

Three gitignore rules surprise people:

- **a name on its own matches at any depth.** `README.md` publishes every
  README in the tree, subfolders included. Write `/README.md` when you mean
  this project's own.
- `docs/` excludes the folder as a whole, so `!docs/public.md` cannot bring a
  file back. Write `docs/**` when you want re-inclusion to work.
- an **empty allowlist publishes nothing**. That is the safe way to fail.

Only **tracked** files are ever candidates (`git ls-files`), so an untracked
`.env` sitting in a working copy cannot be published even with `**` in the
allowlist.

### Two lists, because there are two intents

A project either decides **what must not go out** (leave `**` in the allowlist
and fill the denylist) or decides **what may go out** (replace `**` with
explicit paths). Both work; the denylist always wins.

## The manifest, and why the lists are not the safety

Guarding the two lists is not enough, and this is the part that matters. The
realistic accident is not somebody editing the allowlist. It is a developer
adding `src/internal/customer-keys.js` to a repository where `src/**` has been
allowed for a year. No list changed, and the file goes public at the next
release.

So what gets guarded is the **manifest**: the sorted list of paths approved to
be public. Every selected path must occur in it. Publication **refuses to run**
when a path is newly allowed or appears under an already allowed directory
without being in the manifest:

```text
3 path(s) would become public for the first time:
  + src/internal/customer-keys.js
  + src/internal/dump.sql
  + docs/internal-runbook.md

Nobody has approved that list, so nothing was published.
```

The allowlist and denylists still apply: a path in the manifest can be withheld
by those rules. Approval grants permission to publish **paths**, not every future
change to their contents. New contents at an approved path are scanned before
publication, but the owners still need to review confidential information that
a secret scanner cannot recognise.

## The sign-off on GitLab

The sign-off uses merge-request discussions, without requiring Code Owners or
required approval rules:

1. `task publication:approve` opens a merge request that writes the new
    manifest, mentions the owners so they are notified, and leaves **one thread**
    asking whether these paths become public. Its `Publication-manifest:` marker
    contains the Git content hash of the exact proposed manifest file.
2. Enable GitLab's **All threads must be resolved** merge check so the forge
    blocks the merge while that thread is unanswered. The full toolbox configures
    this through `TASK_GLAB_ALL_THREADS_RESOLVED`; `publication:init` also enables
    it for standalone installations. Set it yourself when using manual setup.
3. At publish time the toolbox asks the API which merge request brought the
    current manifest in. It requires a resolved thread carrying that manifest's
    exact hash, answered by a username listed in `owners`. Resolving an unrelated
    discussion or a thread for an earlier manifest does not approve this one.

Editing a resolved question invalidates that decision. Run
`task publication:approve` again to request a fresh owner decision; the edited
question cannot reuse its old answer.

The merge check requires an answer; publication checks **who answered and which
manifest they answered for**. This is a GitLab identity check, not a cryptographic
signature or a guarantee that the owner read every file. Protect changes to the
owners, publication rules and CI configuration through your normal review process.

An **empty `owners` file means publication refuses to run**: nobody could sign
off. Fill it before switching publication on.

## Commands

```bash
task publication:doctor    # what is missing, with the fix beside each answer
task publication:init      # once: where the source goes, the tokens, the nightly check
task publication:check     # offline dry run: selected, withheld and unapproved paths
task publication:scan      # what would leave, scanned for secrets
task publication:approve   # open the merge request that asks the owners
task publication:publish   # the real thing (also chained into `task release`)
```

`publication:check` is offline and needs no token. It does not modify project
files or contact the forge; a named ref must already be available locally. With
no source ref configured, it evaluates tracked paths using the lists in your
**working copy**, so editing a list shows its effect immediately. With a source
ref configured, it reads that ref. Its result describes the selected paths,
not proof that they have already reached the public repository.

`check` compares paths with the manifest but does **not** verify the owner's
signature. `approve`, `scan` and `publish` read the files and policy from the
**ref that gets published**. `publish` verifies the sign-off on GitLab before
pushing, so uncommitted list edits cannot widen that publication.

## What gets published, and when

`TASK_PUBLICATION_SOURCE_REF` names it — a branch or a tag. Left empty, it is
the repository's default branch, resolved at run time. That default is the
point: publishing "whatever is checked out" is how a feature branch reaches a
public repository from a laptop that happened to have the switch on.

`TASK_PUBLICATION_ON` says when it happens by itself:

| Value     | What happens                                                                                                |
|-----------|-------------------------------------------------------------------------------------------------------------|
| `release` | Default. The full toolbox publishes after `task release`; standalone CI publishes default-branch pipelines. |
| `tag`     | Standalone CI creates publication jobs for tags and publishes the pipeline's tag.                           |
| `manual`  | Standalone CI creates a publication job that waits for a click.                                             |

For standalone CI, set `TASK_PUBLICATION_ON` as a **GitLab CI/CD variable** to
create the intended `manual` or `tag` jobs. GitLab evaluates job rules before
running `task` and cannot read `.env.dist` at that point. Keep the file and CI
setting consistent. File-only `manual` and `tag` settings still prevent an automatic
push through the script's runtime guard, but cannot create a clickable job.

On a developer's machine, `task publication:publish` is an explicit request,
independent of the automatic schedule. Publication still requires
`TASK_PUBLICATION_ENABLED=true`: the script itself enforces this switch, along
with the approval and scan checks.

## Scanning before publication

The files that would become public are scanned for secrets **before** the push,
with betterleaks — the scanner the code phase uses. What is scanned is the
snapshot made from stored Git file contents. The same contents are used to build
the public commit. This scan covers the new snapshot; it does not audit earlier
publications or the rest of the private repository.

In CI it is a job of its own, `publication:scan`, and `publish-source` needs it:
a red scan locks the pipeline and nothing is pushed. The publication job also
scans the snapshot it will push. A previous job's success is not accepted as
proof for a later publication: `TASK_PUBLICATION_SCAN=done` is not supported.
Both jobs use `task`. Locally, scanning uses an installed `betterleaks` binary
or the configured container image.

With neither, the publication **stops**: a scanner that is missing is not a
scanner that passed. The only modes are `required` and `off`. Setting
`TASK_PUBLICATION_SCAN=off` explicitly disables the scan altogether, even when a
scanner is available; it is not a fallback used only when a tool is missing.

The publication is a **task**, not a CI job: the same command behaves the same
way from a developer's machine and from the pipeline. On the default branch,
`task release` runs it after the tag.

A project that installed **only this component** has no `task release` to hook
into, so it gets standalone jobs instead: add
`- local: .config/publication/gitlab-ci.yml` to its `include:` (the installer
writes that line for you when the project has no pipeline of its own). The
publication job sits in the **release** stage, like the task it replaces, and the
feedback job that runs Renovate sits in **feedback**; a pipeline that declares
its own `stages:` has to list both names.

## What it touches, and what it never touches

The standalone installer writes `.config/publication/` and the update tools
listed below. It adds `Taskfile.yml`, `.env.dist` and `.gitlab-ci.yml` at the root
when they do not exist. Existing root files are retained, with instructions for
the includes and settings to add. `publication:init` subsequently writes the
publication settings into `.env.dist` and configures tokens and a schedule on
GitLab.

The isolated installer preserves the contents and permissions of unrelated
configuration files, including executable tools and owner-only data. It refuses
to replace the Copier answers of a project that already has the complete
framework. Enable publication through that project's existing update path:

```bash
task copier:update TASK_COPIER_CLI_OPTS="--data source_publication=true"
```

That update keeps the recorded runtime and workspace choices and uses Copier's
merge process. A fresh component installation records its own publication scope.

Publication reads your source and pushes its snapshot to the configured target.
`task publication:approve` creates or refreshes an approval branch and merge
request in the source repository; an attempted publication can also open that
request when paths lack approval. `task feedback` lets Renovate propose toolbox
updates. The offline dry run changes no project files or remote state.

On your machine it needs `task`, and `uv` for the updates. Both are asked for by
the installer, which says what each is for, and both can stay in a container
instead: see "Installing without putting anything on your machine" in the root
README.

Approval and publication also require `git`, `curl` and `jq`. Secret scanning
requires either the `betterleaks` executable or Docker to run its scanner image.

## Publishing a tag, by hand

A tag contains the source files **and the publication policy from its commit**.
Prepare the approval before creating the tag:

1. Set `TASK_PUBLICATION_ON=manual` in `.env.dist` and in GitLab's CI/CD
    variables. Leave `TASK_PUBLICATION_SOURCE_REF` empty for the default branch,
    or set it to the release branch that will receive the tag.
2. Commit the source and publication rules on that branch, then run:

    ```bash
    task publication:doctor
    task publication:check
    task publication:approve
    ```

3. Have an owner resolve the matching approval thread and merge the manifest
    into that branch. Create the release tag **after that merge**, using the
    project's release workflow.
4. Select the tag and publish it explicitly:

```bash
# in .env.dist, after the approved manifest is part of this tag
TASK_PUBLICATION_ENABLED=true
TASK_PUBLICATION_ON=manual
TASK_PUBLICATION_SOURCE_REF=2026.06.0
```

```bash
task publication:check     # inspect the tag's selected paths offline
task publication:publish   # verify its sign-off, scan, then push
```

An existing tag that lacks the approved manifest cannot be repaired by approving
a new manifest on the main branch. The tag is immutable and still points at the
old policy. Prepare a new release tag containing the approved manifest; do not
move the existing tag and assume its earlier approval applies.

## Taking something back

Publishing does not retract, and the reason is not laziness: once a file is
public it has been cloned, forked and indexed, so removing it from the public
repository is housekeeping rather than a fix. What the toolbox does is stop the
next publication from carrying it.

1. Add the path to `.config/publication/denylist` (or take it out of the
    allowlist) and merge that change.
2. Publish a source commit containing that rule. The next snapshot removes the
    file from the public branch's current tree; earlier public commits and tags
    still contain it. If the manifest is changed too, obtain approval for its
    new hash before publishing.
3. If the file held a secret, rotate it immediately. Removing a public file or
    repository cannot invalidate copies somebody already made.

## Settings

| Variable                           | Default                | What it is                                         |
|------------------------------------|------------------------|----------------------------------------------------|
| `TASK_PUBLICATION_ENABLED`         | `false`                | Script refuses to publish unless `true`.           |
| `TASK_PUBLICATION_TARGET_URL`      | —                      | Public Git URL, with no embedded credentials.      |
| `TASK_PUBLICATION_TARGET_BRANCH`   | `main`                 | The branch published on.                           |
| `TASK_PUBLICATION_TOKEN`           | —                      | A token that may push to the public repository.    |
| `TASK_PUBLICATION_TOKEN_USERNAME`  | `oauth2`               | `x-access-token` on GitHub.                        |
| `TASK_PUBLICATION_SOURCE_TOKEN`    | `GITLAB_TOKEN`         | API access to THIS repository, for the sign-off.   |
| `TASK_PUBLICATION_API_URL`         | from `origin`          | The forge API.                                     |
| `TASK_PUBLICATION_PROJECT_PATH`    | from `origin`          | This project's path on the forge.                  |
| `TASK_PUBLICATION_APPROVAL_BRANCH` | `publication-approval` | The branch the approval merge request uses.        |
| `TASK_PUBLICATION_SOURCE_REF`      | the default branch     | The branch or tag that gets published.             |
| `TASK_PUBLICATION_ON`              | `release`              | `release`, `tag` or `manual`.                      |
| `TASK_PUBLICATION_SCAN`            | `required`             | `required` or explicit `off`; no prior-job bypass. |
| `TASK_PUBLICATION_SCAN_IMAGE`      | betterleaks image      | The scanner, when no binary is installed.          |
| `TASK_PUBLICATION_SCHEDULE_CRON`   | `0 4 * * *`            | When the nightly check for a new release runs.     |

The two tokens authorize operations on different projects. Keep them as
**masked, protected** CI/CD variables. Give `TASK_PUBLICATION_TARGET_URL` a plain
URL and pass authentication separately; URLs containing credentials are refused
before they can be printed or stored in `.env.dist`.

The script passes credentials through standard input or process environment,
not command arguments, and does not write them into the destination's
`.git/config`. Masking reduces accidental exposure in logs; it does not make a
token inaccessible to a job allowed to use it or to administrators. GitLab's
separate hidden-variable setting prevents revealing a value in its settings UI.
Review code that receives protected variables accordingly.
[GitLab CI/CD variable protection](https://docs.gitlab.com/ci/variables/).

## Setting it up once

`task publication:doctor` provides setup hints, not a readiness certificate.
Without a source token it skips forge checks, and its successful exit does not
mean every requirement is satisfied. It expects the standalone CI include even
when a full toolbox project uses `task release` instead. Read its findings and
verify the chosen publication path.

Automatic setup creates a **project access token**. On GitLab.com this requires
Premium or Ultimate; GitLab.com Free does not provide that setup path. Project
access tokens are available on GitLab Self-Managed and Dedicated with any
license, subject to instance policy.
[GitLab project access token requirements](https://docs.gitlab.com/user/project/settings/project_access_tokens/).

`init` creates a replacement token before updating the existing CI variables
in place. It revokes the previous token only after both variables were stored.
A partial failure can leave both tokens active; it does not roll changes back.
Check the resulting settings before relying on the next pipeline.

1. Create the public repository, empty. Disable its CI so the published pipeline
    does not try to run there.
2. Create a token on it that may push.
3. Where project access tokens are available, run `task publication:init` with
    a personal access token allowed to create one for the source project
    (`api` scope, Maintainer or Owner). It asks for the public URL, destination
    token and scan policy, writes settings into `.env.dist`, stores protected
    masked CI/CD variables, creates the token used by Renovate and publication,
    enables the discussion merge gate, and schedules the nightly check on the
    default branch. It enables publication after token and merge-gate setup
    succeeds; schedule-creation failures are reported as warnings and need to
    be fixed separately. The setup token is not stored for reuse.
4. Fill `owners`, then `allowlist` and `denylist`.
5. Verify **All threads must be resolved** in the source project's merge checks
    (`init` enables it; manual setup must enable it too).
    Run `task publication:check` and **read the list**.
6. Run `task publication:scan` and read the verdict.
7. Run `task publication:approve`, have an owner answer the matching thread,
    then merge the manifest before publishing or creating the release tag.

On GitLab.com Free, configure this manually using a token from a dedicated
account with the required access. Store a source-project `api` token as
`TASK_PUBLICATION_SOURCE_TOKEN` and `TASK_RENOVATE_TOKEN`, and the destination
push token as `TASK_PUBLICATION_TOKEN`, all masked and protected. Set the
non-secret publication settings, add the CI include and stages, enable the merge
check, and create the nightly pipeline schedule on the default branch. Ensure
the publishing branches or tags can receive protected variables. `init` has no
automatic fallback to account tokens when project-token creation is unavailable.

## What it deliberately does not do

- **It does not retract.** Adding a path to the denylist stops publishing it
  from the next release; it does not remove it from releases already public.
  Cleaning a real leak off a public repository is manual.
- **It does not certify confidentiality.** A secret scan detects known patterns;
  it cannot decide whether every document or data file is suitable for publication.
- **It does not create the public repository or its token.** One-time human
  action.
- **Submodules, Git LFS pointers, symlinks and unrepresentable paths** are refused
  when selected. They must be excluded; they are not silently omitted.

## Installed on its own, and kept up to date

A project can take this component without the rest of the framework, from the
installer's checklist. What lands is the component **plus the spine that keeps
it up to date**: the copier answers file (which records the template and the
release it came from), the handful of files `task copier:update` needs to run,
and the Renovate config that watches that answers file.

Alongside the component, these files run its commands, CI and updates:

```text
Taskfile.yml                            runs the commands below
.env.dist                               where the publication settings live
.gitlab-ci.yml                          written only if the project had none
.config/devsecops/.copier-answers.yml   the template and the release it came from
.config/devsecops/Taskfile.feedback.yml the feedback phase, which runs Renovate
.config/copier/Taskfile.yml             the update itself
.config/copier/renovate-update.sh       what Renovate runs to apply a release
.config/copier/requirements.txt         the copier version it runs
.config/python/.python-version          the python version it runs on
.config/task/install.sh                 the task runner, pinned, for CI jobs
.config/task/version                    the version it pins
.config/renovate/config.json            what watches the answers file
.config/renovate/Taskfile.yml           how Renovate is run
```

What it leaves out is every tool (no linter, no container runtime, no forge CLI)
and eight of the nine phase orchestrators: a project that publishes has no
build, deploy or monitor phase to run. Feedback is the one it keeps, because
that is the phase that runs Renovate, and Renovate is what offers it the next
toolbox release.

Where project access tokens are available, `task publication:init` configures
the forge as described above. Otherwise, the same variables and schedule must
be configured manually.

Nothing you already have is overwritten. If the project already has a root
`Taskfile.yml`, a `.env.dist` or a `.gitlab-ci.yml`, the installer keeps yours
and prints the includes, the settings and the one pipeline line to add.

That is deliberate. A component with no upgrade path rots, and rotted rules
about what becomes public are worse than none. With the answers file, a toolbox
release reaches the project the same way it reaches a full one:

```bash
task feedback           # runs Renovate, which opens the merge request
task copier:update      # what that merge request runs to apply the release
```

Copier's three-way merge carries local changes forward when a release updates
framework files (`publish.sh`, `denylist.base`, the Taskfile). Review the update
merge request and resolve any conflicts, especially in the four policy files
your project owns. The recorded installation scope keeps tools that were not
installed out of the update.

`@publication-update` exercises a component update between two fixture releases,
including preservation of the team's rules and exclusion of an absent tool.

## Forge portability

The destination uses Git over HTTP(S) and must support atomic pushes. It can be
hosted separately from the source project. Approval checks and automatic setup
currently use the **GitLab API on the source project**; support for another
source forge requires an adapter. A portable destination does not provide that
adapter automatically.
