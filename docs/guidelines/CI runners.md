# CI runners

The toolbox separates file checks from tasks that need a container engine.
The same generated pipeline works on GitLab.com and on self-hosted GitLab.

| Jobs                                                                                                    | Runner selection            | Container engine |
|---------------------------------------------------------------------------------------------------------|-----------------------------|------------------|
| Commitlint, Commitizen checks, Lizard, Renovate validation, BetterLeaks, MegaLinter and pipeline guards | No tags                     | None             |
| Project code checks and the plan, build, test, release, deploy, operate, monitor and feedback phases    | `gitlab_docker_runner_tags` | Docker-in-Docker |

Project tasks keep Docker by default because a project can start containers in
any phase. A task name does not tell us whether its implementation needs Docker.

## Select the Docker runners with Copier

The `gitlab_docker_runner_tags` answer is a JSON list of existing runner tags.
For example, select `["saas-linux-medium-amd64"]` or
`["saas-linux-large-amd64"]`. The toolbox preserves the names exactly; the same
answers work on self-hosted GitLab. Multiple tags are an **AND** condition: a
runner must have every listed tag, so listing medium and large does not mean
"either size".

GitLab.com defaults to `["saas-linux-medium-amd64"]`. Self-hosted GitLab defaults
to `[]` for compatibility with existing installations. **An empty list requires
Docker-capable untagged runners.** Set an explicit Docker tag before allowing
ordinary Kubernetes runners to take untagged jobs.

Configure the runners in the separate infrastructure repository:

- Ordinary runners accept untagged jobs, run without privileged mode and expose
  neither a host Docker socket nor cloud credentials to jobs.
- Docker runners advertise the selected tags and have `run_untagged=false`.
  Docker-in-Docker needs privileged execution and the shared `/certs/client`
  certificate volume when TLS is enabled.
- Limit each runner's GitLab scope to the intended projects or groups. Tags
  choose a runner; they are not an authorization boundary.

For self-hosted Docker-in-Docker with TLS, use
`gitlab_docker_host=tcp://docker:2376`, `gitlab_docker_tls_certdir=/certs` and
`gitlab_docker_driver=overlay2`.

## MegaLinter

The CI job starts directly in the pinned MegaLinter image. It installs the pinned
Task binary and runs `task megalinter:ci`; it does not run the toolbox bootstrap
or start another container. Task keeps the project's environment loading and
`TASK_MEGALINTER_CONFIG` selection. The default configuration still extends
`.config/megalinter/config.base.yml`, including the linter configuration files,
project dictionary, hooks and scan scope. Reports remain at
`megalinter-reports/` and are uploaded on both failure and success.

Local `task code` and `task megalinter` retain their container execution paths.
The CI image and the local runner version are updated together by Renovate.

GitLab selects the job image before checking out the project, so it cannot read
an image prefix or flavor from `.env.dist`. The direct CI job uses the pinned
default MegaLinter image. Projects requiring a custom image or flavor should
postpone this update until that requirement is supported. Local image settings
still apply to local tasks.

The direct image avoids downloading both the toolbox and MegaLinter in the same
job. Its first pull and the scanners still take time. Reusing an image cache on
the ordinary runner's nodes can help; this change does not promise a particular
duration or reduce the checks.

Unprivileged execution means `privileged=false`, without a Docker service or
host socket. It is not a claim of compatibility with a non-root user or a
read-only root filesystem: the current Task installer and dictionary hook need
writable tool installation directories. Assess these separately when setting
Kubernetes pod security policies.

Project lint hooks and the linters they invoke must work without a container
engine in the direct CI job. Projects with hooks that start containers should
postpone this update until those hooks no longer require Docker.

## Update an existing project

Update through Copier in a branch and review the resulting merge request. Keep
the old runners available until the new configuration has passed. Select the
Docker tag explicitly when introducing the ordinary runner; leaving the legacy
self-hosted answer empty will still route Docker jobs to an untagged runner.

Keep project vocabulary in `.config/cspell/config.project.json` and project lint
settings in `.config/megalinter/config.yml`. Review any Copier conflict in these
files; a conflict is not a successful migration. Project tasks continue to use
the Docker runner through the generated pipeline.

The `@hybrid-ci` storyboard exercises generated jobs against real local GitLab
runners, one with privileged mode disabled and one with Docker-in-Docker.
Kubernetes pod isolation, cloud VM creation, cancellation cleanup and return to
zero resources require a separate infrastructure demonstration. A passing
framework test does not certify that infrastructure.
