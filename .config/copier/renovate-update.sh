#!/bin/sh
# Apply a toolbox release inside the merge request Renovate has just opened.
#
# Renovate runs a post-upgrade command as a command, not as a shell line: an
# `a && b && c` written in its configuration reaches `a` with "&&" as one of its
# arguments, and dies there. So the three steps live in a file, and the
# configuration names the file.
#
# What the three steps are for:
#   - Renovate has already edited the answers file to the new release. Copier
#     does that itself, and does it as part of a real update, so the edit is
#     reverted first;
#   - a leftover file from a previous attempt would be merged into the update as
#     if the project owned it;
#   - and then the release is applied by the project's own command, the same one
#     a developer types.
set -eu

VERSION="${1:-}"
if [ -z "${VERSION}" ]; then
  echo "usage: sh .config/copier/renovate-update.sh <version>" >&2
  exit 2
fi

git checkout -- .
git clean -fd
# --trust is the task's own, and passing it twice is a usage error copier
# refuses outright.
task copier:update TASK_COPIER_CLI_OPTS="--skip-answered --defaults --vcs-ref ${VERSION}"
