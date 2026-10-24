# Deployment-only merge requests

Requires **GitLab 19.2 or later**. When a merge request changes only deployment
files, GitLab creates the code checks and release. It does not create plan,
build, test, deploy, operate, monitor, feedback, Lizard or no-cheat jobs.

## Configure the paths

Set the list in the repository's root `.env.dist`:

```dotenv
TASK_DEVSECOPS_TEST_DEPLOY_PATHS='deploy/
infra/k8s/overlays/prod/
charts/my-app/values-prod.yaml'
```

Spaces and newlines separate paths. Quote multiline values. Task loads the
setting normally: `.env.dev` overrides `.env.dist`, including an empty value.
Do not put the list or a generated source copy in `.gitlab-ci.yml`.

Use literal repository-relative paths. A trailing `/` means a directory and
all its descendants; an existing directory also works without it. A file entry
matches only that file, never its neighbours. Only list deployment content,
such as manifests and image tags, not application code or tests.

The repository root, `project`, `project/`, parent traversal, wildcards and
paths containing a component exactly named `.config` are refused. Control
files and standard test paths are protected too. `Taskfile.yml`, `Taskfile.yaml`,
`AGENTS.md` and `CLAUDE.md` are protected at every depth. A single refused entry, or
a generated pattern longer than 255 characters, disables the optimization for
the whole list and prints a warning. An empty list deliberately disables it.

Preview the effective value without writing any file:

```bash
task devsecops:plan:deploy-only:pattern
```

The full-pipeline fallback prints `\A`. A normal pattern is generated for you;
there is no regex to maintain by hand.

## How synchronization works

Every enabled `plan` on the current default-branch commit runs
`task devsecops:plan:deploy-only:sync` before the project's own plan task.
It also runs when the path setting has not changed. Local runs, other branches
and tags do not update GitLab. The default branch can have any name.

The task reuses `TASK_COMMITIZEN_TOKEN`, which needs its existing API scope and
Maintainer permissions. It creates or updates
`TASK_DEVSECOPS_DEPLOY_ONLY_REGEXP` under **Settings → CI/CD → Variables**,
with environment scope `*`, raw values, and no masked/protected flags. This
variable contains configuration, not a secret; the token is never printed.
An identical value with the correct attributes needs no write. Every success
includes an independent read-back from GitLab.

The log says either `Deployment policy synchronized and verified.` or
`Deployment policy is already synchronized and verified.` Invalid input can
still synchronize successfully: GitLab receives and verifies the safe fallback.

Plan jobs share `resource_group: deployment-only-sync`. This serializes their
whole plan phase. On the default branch, release waits for plan to finish,
including when plan fails; plan stays red. Release keeps its separate lock.
This stops that pipeline's version commit from interrupting its synchronization.
MRs and tags retain their existing release behavior.
Canceling plan keeps GitLab's native behavior and can cause release to be skipped.

Setting `TASK_DEVSECOPS_PLAN_ENABLED=false` also disables synchronization. To
turn off reduced pipelines, empty the path list and run an enabled plan on the
current default branch first. Confirm the fallback was synchronized before
disabling plan itself.

## Failures and recovery

There are at most three attempts: immediately, after 15 seconds, then after
another 120 seconds. Network failures and temporary server errors can retry.
Rate limits respect `Retry-After` if the wait fits. API requests have a
30-second timeout and synchronization has a 300-second budget. Invalid
credentials, insufficient rights, unexpected API responses and read-back
mismatches fail visibly; waiting does not repair those problems.

| What happened | What to do |
| --- | --- |
| Temporary API/network outage | Retry plan if its commit is still the current default-branch commit. |
| A newer commit reached the default branch | Start a new pipeline on that branch. The obsolete plan refuses to write. |
| Token missing, expired or forbidden | Restore the existing token's API access and Maintainer permissions, then retry on the current commit. |
| Invalid deployment list | Correct the paths or shorten the list. The synchronized fallback keeps the full pipeline meanwhile. |
| GitLab asks for a wait beyond the budget | Wait for availability, then retry on the current commit. |

**An unsuccessful synchronization can leave the previous rule active.** A
removed deployment path can therefore still get a reduced MR pipeline until
the next successful plan. This temporary stale state is accepted by this
design. Another merge can also advance the branch during an API request:
freshness checks detect it, but branch updates and variable writes are not one
atomic operation. The next current default-branch plan repairs the value.

After repair, create a **new MR pipeline** to apply the new selection. An
existing pipeline's graph never changes, and retrying one of its jobs does not
recreate missing jobs. No extra periodic synchronization job is installed.

## Checks that remain

Deployment-only MRs keep `code:commitlint`, `code:commitizen-check`,
`code:commitizen-bump-dry`, `code:betterleaks`, `code:project`,
`code:renovate-validate`, `code:megalinter`, `code:all` and release, according to
their normal rules. The project's own code task still performs its checks,
including Kustomize rendering where configured. Toolbox-specific storyboard
coverage keeps its own rules.

MegaLinter checks changed files against the MR target. Supported scanners use
file modes; scanners requiring a whole-project run remain in normal pipelines.
Grype and Syft keep their project mode: the pinned image reuses the first path
when their file mode receives several files. They remain in full pipelines.
YAML validation and infrastructure security checks still apply to deployment
changes. Mixed changes restore the normal scan configuration.

A change outside the list, under any `.config` component, to repository
configuration, agent controls or standard tests keeps the full pipeline.
`.configuration` is a different directory name and is not rejected as `.config`.
Every created build, test and deploy job executes its task. The standalone
`check-deploy-only.sh` helper remains available for legacy/local callers;
the new CI jobs do not use it to reconsider GitLab's selection.

References: [GitLab changed-path regex rules](https://docs.gitlab.com/ci/yaml/#ruleschangesregexp),
[project variables API](https://docs.gitlab.com/api/project_level_variables/),
[conditional job dependencies](https://docs.gitlab.com/ci/yaml/#rulesneeds).
