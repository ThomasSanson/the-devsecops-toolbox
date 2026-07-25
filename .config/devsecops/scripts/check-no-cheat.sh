#!/usr/bin/env bash
#
# ============================================================================
# No-cheat gate — "a test that was switched off never reaches the main branch"
# ============================================================================
#
# DESCRIPTION:
#   A test suite has one job: to fail when the code is wrong. The cheapest way
#   to make a red pipeline green is not to fix the code — it is to switch the
#   test off. One tag, one flag, one raised threshold, and the pipeline reports
#   success while proving nothing. The rule against it was written down, and a
#   written rule is exactly what a rushed human, or any AI assistant told to get
#   the pipeline green, steps over.
#
#   So it is read mechanically. On a merge request this guard reads the lines
#   the change ADDS and refuses the ones that switch a check off:
#
#     @skip / @wip           a scenario the suite reports without running
#     .only( / xScenario     one scenario kept, every other one dropped
#     tolerance: <non-zero>  a picture check that accepts a difference
#     allow_failure: true    a job allowed to fail with no consequence
#     a silenced linter      inside the tests, where it has no business being
#
#   Every pattern is anchored at the head of its line — a Gherkin tag, a mocha
#   modifier and a YAML key all sit alone there. Quoting one inside a sentence,
#   a string or a document therefore trips nothing, which is what lets this file
#   and the documents that describe it name what they hunt.
#
#   Deleted lines are out of scope: switching a check off is something a change
#   ADDS. And each pattern is read only where it can mean cheating — a
#   `allow_failure: true` belongs to a pipeline file, a skipped scenario to the
#   tests.
#
#   Escape hatch (deliberate + visible, never silent): a commit in the range
#   carrying a `No-cheat-exempt: <reason>` trailer waives the gate. Review sees
#   the reason.
#
# USAGE:
#   BASE=origin/main bash check-no-cheat.sh      # local
#   (CI passes CI_MERGE_REQUEST_DIFF_BASE_SHA automatically)
#
# EXIT CODES:
#   0  Nothing switched off (or nothing relevant changed, or exempted)
#   1  The change switches a check off, with no exemption
#
# ============================================================================

set -euo pipefail

# shellcheck source=.config/devsecops/scripts/diff-base.sh
source "$(dirname "${BASH_SOURCE[0]}")/diff-base.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Where the tests live, and where the pipeline lives. A guard that reads the
# whole repository would flag the honest uses of these words; each rule below
# picks the paths where its own pattern can only mean one thing.
TEST_PATHS='^(project/tests/|\.config/codeceptjs/)'
CI_PATHS='^(\.config/gitlab/ci/|\.gitlab-ci\.yml(\.jinja)?$)'

# paths | pattern | what it does, in one sentence | (optional) modified_only
RULE_PATHS=()
RULE_RE=()
RULE_SAYS=()
RULE_SCOPE=()
add_rule() { RULE_PATHS+=("$1"); RULE_RE+=("$2"); RULE_SAYS+=("$3"); RULE_SCOPE+=("${4:-any}"); }

add_rule "${TEST_PATHS}" '^[[:space:]]*@(skip|wip)([[:space:]]|$)' \
  'a skipped scenario: the suite reports it without ever running it'
add_rule "${TEST_PATHS}" '^[[:space:]]*(Scenario|Feature|Data|describe|context|it|test)\.only[[:space:]]*\(' \
  'only this one runs: every other scenario is silently dropped'
add_rule "${TEST_PATHS}" '^[[:space:]]*x(Scenario|Feature|Describe|It)[[:space:]]*\(' \
  'a disabled scenario: it never runs again'
add_rule "${TEST_PATHS}" '^[[:space:]]*tolerance:[[:space:]]*[1-9]' \
  'a picture check that accepts a difference: it stops proving anything'
# MODIFIED files only, and the reason is worth stating: turning an EXISTING job
# into one that may fail is the cheat. A file that arrives whole — installing
# the framework, adding a pipeline — carries no job that was ever green, and
# this framework's own CI ships two legitimate `allow_failure: true` lines that
# every install re-adds. Read on added files, this rule would refuse the
# framework's own installation merge request (it did, once).
add_rule "${CI_PATHS}" '^[[:space:]]*allow_failure:[[:space:]]*true' \
  'a job that used to have to pass is now allowed to fail' modified_only
add_rule "${TEST_PATHS}" '(eslint-disable|shellcheck disable|# ?noqa|# ?nosec)' \
  'a linter silenced inside the tests'

BASE="$(resolve_diff_base)"

echo -e "${BLUE}🕵 No-cheat gate (base: ${BASE})...${NC}"

# `mapfile < <(cmd)` SWALLOWS cmd's exit status: a git diff that cannot resolve
# BASE would leave the list empty and the gate would announce "nothing to read"
# — failing open, silently. Capture first, and refuse loudly instead.
# BASE=HEAD reads the working tree instead of a merge request: that is the local
# loop asking the same question before CI does — is what I am about to commit
# switching a check off?
diff_range=("${BASE}...HEAD")
[ "${BASE}" = "HEAD" ] && diff_range=(HEAD)
if ! diff_output="$(git diff --unified=0 --diff-filter=ACMR "${diff_range[@]}")"; then
  echo -e "${RED}❌ Cannot compute the diff against ${BASE} — refusing to pass silently.${NC}" >&2
  exit 1
fi

# The files this change ADDS whole. A rule marked modified_only skips them: it
# hunts a check that was turned off, and a brand-new file turned nothing off.
added_files="$(git diff --name-status --diff-filter=A "${diff_range[@]}" | cut -f2 | tr '\n' ' ')"

findings=()
file=''
lineno=0
while IFS= read -r line; do
  case "${line}" in
  '+++ b/'*)
    file="${line#+++ b/}"
    continue
    ;;
  '@@'*)
    # @@ -old,count +new,count @@ — the added lines of this hunk start at `new`.
    hunk="${line#*+}"
    hunk="${hunk%% *}"
    lineno="${hunk%%,*}"
    continue
    ;;
  '+'*) ;;
  *) continue ;;
  esac
  [ -n "${file}" ] || continue
  content="${line#+}"
  for i in "${!RULE_RE[@]}"; do
    if [ "${RULE_SCOPE[$i]}" = "modified_only" ] && [[ " ${added_files} " == *" ${file} "* ]]; then continue; fi
    if [[ "${file}" =~ ${RULE_PATHS[$i]} ]] && [[ "${content}" =~ ${RULE_RE[$i]} ]]; then
      findings+=("${file}:${lineno}|${content}|${RULE_SAYS[$i]}")
    fi
  done
  lineno=$((lineno + 1))
done <<<"${diff_output}"

if [ "${#findings[@]}" -eq 0 ]; then
  echo -e "${GREEN}✅ Nothing in this change switches a check off.${NC}"
  exit 0
fi

if has_exempt_trailer No-cheat "${BASE}"; then
  echo -e "${YELLOW}⚠️  A check is switched off, but a 'No-cheat-exempt:' trailer waives the gate.${NC}"
  printf "   ${YELLOW}~${NC} %s\n" "${findings[@]%%|*}"
  exit 0
fi

echo -e "${RED}❌ This change switches a check off instead of fixing what it caught:${NC}"
for finding in "${findings[@]}"; do
  where="${finding%%|*}"
  rest="${finding#*|}"
  echo -e "   ${RED}~${NC} ${where}"
  echo "       ${rest%%|*}"
  echo "       → ${rest#*|}"
done
cat >&2 <<'MSG'

A test suite has one job: to fail when the code is wrong. A check that was
switched off cannot do it, and the pipeline reports success while proving
nothing. Do ONE of:
  - fix the code the check caught, and leave the check alone;
  - if the check is genuinely obsolete, remove it and say so in review;
  - if this really is the honest thing to do, add a commit trailer:
        No-cheat-exempt: <why switching this off is right>
See .agent/rules/tests-integrity.md.
MSG
exit 1
