# Source publication

Publish this repository's source to a **second, public repository**, minus the
files the team decided never leave, and only after an owner approved the exact
list.

It exists for one situation: a project that has to live in a **private**
repository and, at the same time, **publish its source**. Copying it by hand is
how a deployment secret ends up on the internet, and the forge's own mirroring
copies everything, history included, with no way to leave a file out.

## What it publishes

A **filtered snapshot, one commit per release**. Nothing is ever rewritten,
there is no force-push, and a file that was held back was never in the public
history to be found later. The public repository reads as a publication log:

```text
publish 1.4.0

Source: https://gitlab.example/group/field-reporting
Commit: 3f2a1b9c…
Files:  4 published, 2 withheld
```

The cost of that choice is that authorship and day-to-day history are not
published. For a source-publication obligation that is the right trade. A
project that wants public collaboration wants a different mechanism.

## The files that decide

Everything lives next to this README.

| File            | Owned by        | What it does                                                      |
|-----------------|-----------------|-------------------------------------------------------------------|
| `allowlist`     | your project    | What may be published. What it does not match never leaves.       |
| `denylist`      | your project    | What must never be, even when the allowlist matched it. It wins.  |
| `denylist.base` | **the toolbox** | The floor: `.env`, private keys, `*.tfstate`… Always applied.     |
| `owners`        | your project    | Who may approve what becomes public, one forge username per line. |
| `manifest`      | written for you | The exact list of paths somebody approved.                        |

Patterns are **gitignore syntax**, and git itself evaluates them, so a path
(`README.md`), a folder (`docs/`) and a glob (`src/**`) all behave the way you
already expect, identically on every platform.

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

So what gets guarded is the **manifest**: the sorted list of every path approved
to be public. The publication publishes the manifest and nothing else, and it
**refuses to run** when the lists now compute a different set:

```text
3 path(s) would become public for the first time:
  + src/internal/customer-keys.js
  + src/internal/dump.sql
  + docs/internal-runbook.md

Nobody has approved that list, so nothing was published.
```

One rule covers both the list edit and the new file: **what is published equals
what was approved.**

## The sign-off, without a paid forge

Code Owners and required approvals are paid features. The sign-off is built out
of what the free tier does enforce:

1. `task publication:approve` opens a merge request that writes the new
    manifest, mentions the owners so they are notified, and leaves **one thread**
    asking whether these paths become public.
2. The forge **blocks the merge while that thread is unanswered**. That part is
    not ours; it is the project setting the toolbox already turns on
    (`TASK_GLAB_ALL_THREADS_RESOLVED`).
3. At publish time the toolbox asks the API which merge request brought the
    current manifest in, and requires that the thread was answered by a username
    listed in `owners`.

The forge makes sure somebody ticked the box; the toolbox checks **who** ticked
it. It is not airtight — an owner can tick without reading — but no path becomes
public without a named person having been asked, in a merge request that lists
exactly which paths, and having had to act.

An **empty `owners` file means publication refuses to run**: nobody could sign
off. Fill it before switching publication on.

## Commands

```bash
task publication:init      # once: where the source goes, the tokens, the nightly check
task publication:check     # dry run: what would leave, what is held back, who approved
task publication:scan      # what would leave, scanned for secrets
task publication:approve   # open the merge request that asks the owners
task publication:publish   # the real thing (also chained into `task release`)
```

`publication:check` needs no token and touches nothing. Run it before switching
publication on, and run it again whenever you wonder what is public. It answers
for your **working copy**, so a list you are editing right now shows its effect;
`approve` and `publish` answer for the **ref that gets published**, so nothing
uncommitted can widen what becomes public.

## What gets published, and when

`TASK_PUBLICATION_SOURCE_REF` names it — a branch or a tag. Left empty, it is
the repository's default branch, resolved at run time. That default is the
point: publishing "whatever is checked out" is how a feature branch reaches a
public repository from a laptop that happened to have the switch on.

`TASK_PUBLICATION_ON` says when it happens by itself:

| Value     | What happens                                                     |
|-----------|------------------------------------------------------------------|
| `release` | default. After the tag on the default branch, task and pipeline. |
| `tag`     | only a tag pipeline publishes, and it publishes that tag.        |
| `manual`  | nothing publishes by itself: the job waits for a click.          |

`task publication:publish` run by hand always publishes, whatever `ON` says.
That is what "manual" means.

## Nothing leaves unscanned

The files that would become public are scanned for secrets **before** the push,
with betterleaks — the scanner the code phase uses. What is scanned is the
snapshot, not the repository around it: the publication pushes one commit with
no history, so its contents are everything the public repository will ever hold,
and a secret in a file that never leaves is the code phase's business rather
than this one's.

In CI it is a job of its own, `publication:scan`, and `publish-source` needs it:
a red scan locks the pipeline and nothing is pushed. Both jobs run `task`, like
everything else here; they install the pinned runner first because their images
are chosen for what they scan with, not for what they run with. On a machine it runs from
an installed `betterleaks` if there is one, from the container image otherwise.

With neither, the publication **stops**: a scanner that is missing is not a
scanner that passed. `TASK_PUBLICATION_SCAN=off` waives it, and the installer
asks the question so that choice is made once, in the open.

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

## Settings

| Variable                           | Default                | What it is                                       |
|------------------------------------|------------------------|--------------------------------------------------|
| `TASK_PUBLICATION_ENABLED`         | `false`                | Off unless `true`.                               |
| `TASK_PUBLICATION_TARGET_URL`      | —                      | The public repository's git URL.                 |
| `TASK_PUBLICATION_TARGET_BRANCH`   | `main`                 | The branch published on.                         |
| `TASK_PUBLICATION_TOKEN`           | —                      | A token that may push to the public repository.  |
| `TASK_PUBLICATION_TOKEN_USERNAME`  | `oauth2`               | `x-access-token` on GitHub.                      |
| `TASK_PUBLICATION_SOURCE_TOKEN`    | `GITLAB_TOKEN`         | API access to THIS repository, for the sign-off. |
| `TASK_PUBLICATION_API_URL`         | from `origin`          | The forge API.                                   |
| `TASK_PUBLICATION_PROJECT_PATH`    | from `origin`          | This project's path on the forge.                |
| `TASK_PUBLICATION_APPROVAL_BRANCH` | `publication-approval` | The branch the approval merge request uses.      |
| `TASK_PUBLICATION_SOURCE_REF`      | the default branch     | The branch or tag that gets published.           |
| `TASK_PUBLICATION_ON`              | `release`              | `release`, `tag` or `manual`.                    |
| `TASK_PUBLICATION_SCAN`            | `required`             | `required`, `off`, or `done` (a CI job did it).  |
| `TASK_PUBLICATION_SCAN_IMAGE`      | betterleaks image      | The scanner, when no binary is installed.        |
| `TASK_PUBLICATION_SCHEDULE_CRON`   | `0 4 * * *`            | When the nightly check for a new release runs.   |

The two tokens point at two different projects, which is why there are two. Keep
them as **masked, protected** CI/CD variables; the publication never prints one,
never puts one in a command line and never writes one into the destination's
`.git/config`.

## Setting it up once

1. Create the public repository, empty. Disable its CI so the published pipeline
    does not try to run there.
2. Create a token on it that may push.
3. Run `task publication:init`. It asks four things — a token for THIS
    repository (used once, never stored), the public repository's URL, the token
    from step 2, and whether a missing secret scanner should stop a publication
    — then writes the URL into `.env.dist`, stores the push token as a masked,
    protected CI/CD variable, creates the project token Renovate and the
    sign-off both use, and schedules the nightly check that brings the next
    toolbox release in. The installer offers to run it for you.
4. Fill `owners`, then `allowlist` and `denylist`.
5. Run `task publication:check` and **read the list**.
6. Run `task publication:scan` and read the verdict.
7. Run `task publication:approve`, and have an owner answer the thread.

## What it deliberately does not do

- **It does not retract.** Adding a path to the denylist stops publishing it
  from the next release; it does not remove it from releases already public.
  Cleaning a real leak off a public repository is manual.
- **It does not hunt for secrets.** The `code` phase already scans, before
  release.
- **It does not create the public repository or its token.** One-time human
  action.
- **Submodules, LFS and symlinks** are out of scope for now.

## Installed on its own, and kept up to date

A project can take this component without the rest of the framework, from the
installer's checklist. What lands is the component **plus the spine that keeps
it up to date**: the copier answers file (which records the template and the
release it came from), the handful of files `task copier:update` needs to run,
and the Renovate config that watches that answers file.

Measured: **22 files, about 120 KB**, against 199 files and 1.7 MB for a full
install. Nine of them are the component; the other thirteen are the spine:

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

`task publication:init` does the forge side once: it asks where the source goes
and for the token that may push there, stores that token masked, creates the
project token Renovate authenticates with, and schedules the nightly run that
looks for a new release.

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

Copier's three-way merge is what protects you: a release edits the files the
framework owns (`publish.sh`, `denylist.base`, the Taskfile) and leaves the four
files **you** own exactly as you wrote them. It also brings nothing you never
installed: a release that changes a tool absent from your project changes
nothing in it.

`@publication-update` in the test suite proves all of that against two real
toolbox releases.

## Forge portability

Publishing is a `git push`, so the mechanism is forge-neutral by construction:
GitLab to GitLab, GitLab to GitHub, Forgejo to anything. The only forge-specific
part is the sign-off, and it lives in the last four functions of `publish.sh`.
