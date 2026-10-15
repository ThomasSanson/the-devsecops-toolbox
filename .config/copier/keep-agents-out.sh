#!/bin/sh
# After-migration for a publication-scope project. Runs in the project.
#   $1 = the checkout of the release just applied
#
# Copier skips only the paths a project deleted, so a path that is new in the
# release lands in a project that never had the AI files: all of .agents and
# .claude/skills on the update that brings them, a new skill later on. Take back
# the untracked files this release ships, and nothing else: a developer's own
# .claude settings stay. A project that installed the AI files too keeps them.
# ponytail: AGENTS.md is the marker (as in migrate-agents.sh), so a publication
# project with an AGENTS.md of its own gets the toolbox's AI files as well.
set -eu
src="$1"
if [ -e AGENTS.md ]; then exit 0; fi
git -c core.quotePath=false ls-files --others -- .agents .claude | while IFS= read -r f; do
  if [ -e "$src/$f" ] || [ -L "$src/$f" ] || [ -e "$src/$f.jinja" ]; then
    rm -f -- "$f"
  fi
done
for d in .agents .claude; do
  if [ -d "$d" ]; then find "$d" -depth -type d -empty -delete; fi
done
