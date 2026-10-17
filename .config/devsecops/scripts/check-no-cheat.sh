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
#     @pytest.mark.skip      the same, in Python — and t.Skip(, @Disabled,
#     it.skip( / @Ignore     @Ignore, describe.skip(: one word per language
#     tolerance: <non-zero>  a picture check that accepts a difference
#     allow_failure: true    a job allowed to fail with no consequence
#     a silenced linter      inside the tests, where it has no business being
#
#   Every pattern is anchored at the head of its line — a Gherkin tag, a mocha
#   modifier and a YAML key all sit alone there. Quoting one inside a sentence,
#   a string or a document therefore trips nothing, which is what lets this file
#   and the documents that describe it name what they hunt.
#
#   A check can also go without a word being added: an assertion deleted, a
#   whole test file deleted. So the guard reads the lines the change REMOVES
#   from the tests as well, and refuses a check that leaves with nothing in its
#   place:
#
#     assert / expect        an assertion, in the languages the skip rule reads
#     Then                   a Gherkin check
#     a deleted test file    every check it held
#
#   What a change removes is paired with what it adds, the same text first: a
#   renamed test, or an assertion moved elsewhere in the change, removed
#   nothing. Each pattern is read only where it can mean cheating — a
#   `allow_failure: true` belongs to a pipeline file, a skipped scenario to the
#   tests.
#
#   Escape hatch (deliberate + visible, never silent): a commit in the range
#   carrying a `No-cheat-exempt: <reason>` trailer waives the gate. Review sees
#   the reason.
#
# USAGE:
#   BASE=origin/main bash check-no-cheat.sh              # a merge request
#   BASE=HEAD bash check-no-cheat.sh                     # the working tree
#   BASE=HEAD ONLY=linter bash check-no-cheat.sh         # one phase's own sins
#   (CI passes CI_MERGE_REQUEST_DIFF_BASE_SHA automatically)
#
# ENVIRONMENT VARIABLES:
#   TEST_PATHS   Where this project's tests live, as a regexp on the path
#                (default: under project/, any tests/, test/, spec/ or specs/
#                directory at any depth, and any file named *_test.*, *_spec.*,
#                *.test.* or *.spec.*; plus the shipped .config/codeceptjs/).
#   CI_PATHS     Where this project's pipeline lives (default: the framework's).
#
# EXIT CODES:
#   0  Nothing switched off or removed (or nothing relevant changed, or exempted)
#   1  The change switches a check off or removes one, with no exemption
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
#
# Inside the project workspace, a test is recognised the two ways languages
# actually mark one, at any depth:
#
#   a directory        project/tests/, project/src/tests/, project/apps/web/spec/
#   a file name        project/pkg/b_test.go, project/web/app.test.js, a_spec.rb
#
# Naming `project/tests/` alone was the one thing that made this gate useless
# outside this repository: it read nothing, said "nothing switches a check off",
# and exited 0. A gate that fails OPEN is worse than no gate, because the
# project believes it is covered. Go was the proof — its tests sit beside the
# code they test, in no test directory at all.
#
# A project that marks its tests some third way sets TEST_PATHS to its own
# regexp; the framework never guesses beyond project/.
TEST_PATHS="${TEST_PATHS:-^(project/(.*/)?((tests?|specs?)/|[^/]*(_test|_spec|\.test|\.spec)\.)|\.config/codeceptjs/)}"
CI_PATHS="${CI_PATHS:-^(\.config/gitlab/ci/|\.gitlab-ci\.yml(\.jinja)?$)}"

# Each rule belongs to the phase of the loop where its sin is committed, so a
# phase can ask about its own and nothing else:
#
#   tests   a verdict was switched off — the suite reports success without it
#   linter  the messenger was silenced instead of the message being fixed
#
# ONLY=tests / ONLY=linter narrows the read; unset reads everything, which is
# what the merge-request job does.
ONLY="${ONLY:-}"

# category | paths | pattern | what it does, in one sentence | (opt) modified_only
# The category is read by add_rule and kept nowhere else: a rule the current
# ONLY does not ask for is never recorded, so the loop below has nothing to
# filter.
RULE_PATHS=()
RULE_RE=()
RULE_SAYS=()
RULE_SCOPE=()
add_rule() {
  if [ -n "${ONLY}" ] && [ "${ONLY}" != "$1" ]; then return 0; fi
  RULE_PATHS+=("$2")
  RULE_RE+=("$3")
  RULE_SAYS+=("$4")
  RULE_SCOPE+=("${5:-any}")
}

add_rule tests "${TEST_PATHS}" '^[[:space:]]*@(skip|wip)([[:space:]]|$)' \
  'a skipped scenario: the suite reports it without ever running it'
# The same cheat wears a different word in every language, and a framework
# handed to projects of any language owes them all the same answer. Note what is
# absent: @pytest.mark.skipif and its kin. A conditional skip states a condition
# a reviewer can read ("not on Windows"); a bare skip states nothing.
add_rule tests "${TEST_PATHS}" '^[[:space:]]*(@pytest\.mark\.skip[[:space:]]*(\(|$)|@unittest\.skip[[:space:]]*(\(|$)|@Disabled|@Ignore|t\.Skip(f)?\(|(describe|context|it|test)\.skip[[:space:]]*\()' \
  'a skipped test: the suite reports it without ever running it'
# node:test also switches a test off from its options, { skip: true } or
# { todo: 'later' }, and from inside it, t.skip(), on a line of its own or on
# the test( line after a {, a ; or a =>. A value that is a condition,
# { skip: process.platform === 'win32' }, stays allowed for the reason above.
add_rule tests "${TEST_PATHS}" "^[[:space:]]*(describe|it|test)[[:space:]]*\\(.*[{,][[:space:]]*(skip|todo)[[:space:]]*:[[:space:]]*(true|[\"'\`])" \
  'a skipped or todo test: its failure no longer fails the suite'
add_rule tests "${TEST_PATHS}" '^[[:space:]]*((describe|it|test)\.todo[[:space:]]*\(|((describe|it|test)[[:space:]]*\(.*[{;>][[:space:]]*)?t\.(skip|todo)[[:space:]]*\()' \
  'a skipped or todo test: its failure no longer fails the suite'
add_rule tests "${TEST_PATHS}" '^[[:space:]]*(Scenario|Feature|Data|describe|context|it|test)\.only[[:space:]]*\(' \
  'only this one runs: every other scenario is silently dropped'
add_rule tests "${TEST_PATHS}" '^[[:space:]]*x(Scenario|Feature|Describe|It)[[:space:]]*\(' \
  'a disabled scenario: it never runs again'
# Any non-zero digit counts: 0.1 accepts a difference just as much as 1 does.
add_rule tests "${TEST_PATHS}" '^[[:space:]]*tolerance:[[:space:]]*[0-9.]*[1-9]' \
  'a picture check that accepts a difference: it stops proving anything'
# MODIFIED files only, and the reason is worth stating: turning an EXISTING job
# into one that may fail is the cheat. A file that arrives whole — installing
# the framework, adding a pipeline — carries no job that was ever green, and
# this framework's own CI ships two legitimate `allow_failure: true` lines that
# every install re-adds. Read on added files, this rule would refuse the
# framework's own installation merge request (it did, once).
add_rule tests "${CI_PATHS}" '^[[:space:]]*allow_failure:[[:space:]]*true' \
  'a job that used to have to pass is now allowed to fail' modified_only
# MODIFIED files only, for the same reason as the rule above and one more: the
# test engine this framework ships (.config/codeceptjs/storyboard.js) carries a
# suppression of its own, so EVERY generated project's first merge request adds
# one — it did, and this gate refused the installation. Silencing a linter is
# something you ADD to a file that was already there; a file that arrives whole
# silenced nothing.
add_rule linter "${TEST_PATHS}" '(eslint-disable|shellcheck disable|# ?noqa|# ?nosec)' \
  'a linter silenced inside the tests' modified_only

# A check, one line each: an assertion (node assert, chai and jest expect,
# Python assert and self.assert*, JUnit assert*, Go t.Error/t.Fatal and testify
# require), a CodeceptJS I.see, or a Gherkin Then (Alors in French). Read on the lines a change
# REMOVES, and on the ones it adds to pair them with.
CHECK_RE='^[[:space:]]*((await[[:space:]]+)?(([[:alnum:]_]+\.)*(assert|expect)|I\.(see|dontSee))|t\.(Error|Fatal)|require\.[A-Z]|(Then|Alors)[[:space:]])'
read_removed=false
if [ -z "${ONLY}" ] || [ "${ONLY}" = tests ]; then read_removed=true; fi

BASE="$(resolve_diff_base)"

echo -e "${BLUE}🕵 No-cheat gate (base: ${BASE}${ONLY:+, ${ONLY} only})...${NC}"

# `mapfile < <(cmd)` SWALLOWS cmd's exit status: a git diff that cannot resolve
# BASE would leave the list empty and the gate would announce "nothing to read"
# — failing open, silently. Capture first, and refuse loudly instead.
# BASE=HEAD reads the working tree instead of a merge request: that is the local
# loop asking the same question before CI does — is what I am about to commit
# switching a check off?
diff_range=("${BASE}...HEAD")
if [ "${BASE}" = "HEAD" ]; then
  diff_range=(HEAD)
  # `git diff` ignores untracked files, and a brand-new test file carrying a
  # skipped scenario is precisely what this gate exists to catch. `add -N`
  # records their existence without staging a single line of content.
  git add -N . >/dev/null 2>&1 || true
fi
# -M: a renamed file shows the lines it changed, not a deletion and a creation.
# D: a deleted file shows every line it held, and its checks with them.
if ! diff_output="$(git diff --unified=0 -M --diff-filter=ACMRD "${diff_range[@]}")"; then
  echo -e "${RED}❌ Cannot compute the diff against ${BASE} — refusing to pass silently.${NC}" >&2
  exit 1
fi

# The files this change ADDS whole. A rule marked modified_only skips them: it
# hunts a check that was turned off, and a brand-new file turned nothing off.
added_files="$(git diff --name-status --diff-filter=A "${diff_range[@]}" | cut -f2 | tr '\n' ' ')"

findings=()
removed=()          # file:line|content|what it does, one per check removed
declare -A added=() # each check line the change adds, by its text
added_count=0
file=''
old_file=''
deleted=false
in_header=false
lineno=0
old_lineno=0
while IFS= read -r line; do
  # A file's header runs from `diff --git` to its first hunk: only there is a
  # `--- a/` or `+++ b/` line a path rather than a removed or added line.
  case "${line}" in
  'diff --git '*)
    in_header=true file='' old_file='' deleted=false
    continue
    ;;
  '@@'*)
    # @@ -old,count +new,count @@ — this hunk's lines start at `old` and `new`.
    in_header=false
    hunk="${line#@@ -}"
    old_lineno="${hunk%%[ ,]*}"
    hunk="${line#*+}"
    hunk="${hunk%% *}"
    lineno="${hunk%%,*}"
    continue
    ;;
  esac
  if [ "${in_header}" = true ]; then
    case "${line}" in
    '--- a/'*) old_file="${line#--- a/}" ;;
    '+++ b/'*) file="${line#+++ b/}" ;;
    '+++ /dev/null') deleted=true ;;
    esac
    continue
  fi
  case "${line}" in
  '-'*)
    content="${line#-}"
    # The framework's own engine under .config/ is not a test of this project:
    # a framework upgrade rewrites it, and must not read as checks removed.
    if [ "${read_removed}" = true ] && [[ "${old_file}" =~ ${TEST_PATHS} ]] && [[ "${old_file}" != .config/* ]] &&
      [[ "${content}" =~ ${CHECK_RE} ]]; then
      if [ "${deleted}" = true ]; then
        says='a test file deleted: the check it held never runs again'
      else
        says='a check removed, and none added in its place: the suite stops checking it'
      fi
      removed+=("${old_file}:${old_lineno}|${content}|${says}")
    fi
    old_lineno=$((old_lineno + 1))
    continue
    ;;
  '+'*) ;;
  *) continue ;;
  esac
  [ -n "${file}" ] || continue
  content="${line#+}"
  if [[ "${file}" =~ ${TEST_PATHS} ]] && [[ "${content}" =~ ${CHECK_RE} ]]; then
    key="${content#"${content%%[![:space:]]*}"}"
    added["${key}"]=$((${added["${key}"]:-0} + 1))
    added_count=$((added_count + 1))
  fi
  for i in "${!RULE_RE[@]}"; do
    if [ "${RULE_SCOPE[$i]}" = "modified_only" ] && [[ " ${added_files} " == *" ${file} "* ]]; then continue; fi
    if [[ "${file}" =~ ${RULE_PATHS[$i]} ]] && [[ "${content}" =~ ${RULE_RE[$i]} ]]; then
      findings+=("${file}:${lineno}|${content}|${RULE_SAYS[$i]}")
    fi
  done
  lineno=$((lineno + 1))
done <<<"${diff_output}"

# A change that adds as many checks as it removes moved them; one that adds
# fewer lost some. Name every removed check that did not come back word for
# word: a moved one did, an edited one did not, and review sees which is which.
if [ "${#removed[@]}" -gt "${added_count}" ]; then
  for finding in "${removed[@]}"; do
    content="${finding#*|}"
    content="${content%|*}"
    key="${content#"${content%%[![:space:]]*}"}"
    if [ "${added["${key}"]:-0}" -gt 0 ]; then
      added["${key}"]=$((${added["${key}"]} - 1))
      continue
    fi
    findings+=("${finding}")
  done
fi

if [ "${#findings[@]}" -eq 0 ]; then
  case "${ONLY}" in
  linter) echo -e "${GREEN}✅ Nothing in this change silences a linter.${NC}" ;;
  *) echo -e "${GREEN}✅ Nothing in this change switches a check off or removes one.${NC}" ;;
  esac
  exit 0
fi

if has_exempt_trailer No-cheat "${BASE}"; then
  echo -e "${YELLOW}⚠️  A check is switched off or removed, but a 'No-cheat-exempt:' trailer waives the gate.${NC}"
  printf "   ${YELLOW}~${NC} %s\n" "${findings[@]%%|*}"
  exit 0
fi

echo -e "${RED}❌ This change switches a check off instead of fixing what it caught:${NC}"
for finding in "${findings[@]}"; do
  where="${finding%%|*}"
  rest="${finding#*|}"
  echo -e "   ${RED}~${NC} ${where}"
  # The quoted line may hold a `|` of its own (`expect(a || b)`): the reason is
  # what follows the LAST one.
  echo "       ${rest%|*}"
  echo "       → ${rest##*|}"
done
cat >&2 <<'MSG'

A test suite has one job: to fail when the code is wrong. A check that was
switched off cannot do it, and the pipeline reports success while proving
nothing. Do ONE of:
  - fix the code the check caught, and leave the check alone;
  - if the check is genuinely obsolete, or switching it off really is the
    honest thing to do, say why in a commit trailer that review reads:
        No-cheat-exempt: <why switching this off is right>
See .agents/rules/tests-integrity.md.
MSG
exit 1
