#!/bin/sh
# Before-migration for the move of .agent/ to .agents/. Runs in the project.
#   $1 = the checkout of the template being applied
#   $2 = the release the project is on
#   $3 = the project's answers file (copier gives no answers to a before-migration)
#
# A toolbox file the team never touched is removed: copier then writes the new
# release's copy at its new place, with nothing to merge. Any other file (one
# the team added or edited, or one this script cannot compare) moves with
# git mv, so copier merges it like any other change of the team's. A team's own
# workflow stays in .agent/workflows: there is no skill of that name to merge
# it with. Copier reads the project from its Git index, hence git rm and git mv.
set -eu
src="$1"
from="$2"
answers="$3"
[ -d .agent ] || exit 0
# An answer, without the quotes YAML puts around some values (gherkin_language: 'no').
answer() { sed -n "s/^$1: *//p" "$answers" | head -n 1 | sed "s/^['\"]\(.*\)['\"]\$/\1/"; }
lang="$(answer gherkin_language)"
scope="$(answer install_scope)"
# A publication-scope project with no AGENTS.md never had the toolbox's AI
# files: an .agent folder there is the team's own, for its own tools.
[ "$scope" != publication ] || [ -e AGENTS.md ] || exit 0
# The workflows the toolbox shipped, each now the skill of the same name.
workflows="create-feature delete-feature development-cycle read-feature tdd-step1-red tdd-step2-green tdd-step3-refactor update-feature"

# The file as release $from rendered it, or a failure when that release had no
# such file. The raw tags and the language are the only Jinja in these twins.
old() {
  if git -C "$src" cat-file -e "$from:$1.jinja" 2>/dev/null; then
    git -C "$src" show "$from:$1.jinja" |
      sed -e 's/{% raw %}//g' -e 's/{% endraw %}//g' -e "s/{{ gherkin_language }}/${lang}/g"
  elif git -C "$src" cat-file -e "$from:$1" 2>/dev/null; then
    git -C "$src" show "$from:$1"
  else
    return 1
  fi
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
git -c core.quotePath=false ls-files .agent | while IFS= read -r f; do
  if old "$f" >"$tmp" && cmp -s "$tmp" "$f"; then
    git rm -q -- "$f"
    continue
  fi
  case "$f" in
  .agent/workflows/*)
    n="${f#.agent/workflows/}"
    n="${n%.md}"
    case " $workflows " in
    *" $n "*) t=".agents/skills/$n/SKILL.md" ;;
    *) continue ;;
    esac
    ;;
  *) t=".agents/${f#.agent/}" ;;
  esac
  [ -e "$t" ] && continue
  mkdir -p "$(dirname "$t")"
  git mv -- "$f" "$t"
done
