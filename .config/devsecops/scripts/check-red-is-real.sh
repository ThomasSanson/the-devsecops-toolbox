#!/usr/bin/env bash
#
# ============================================================================
# Red-is-real gate — "the test failed, and it failed on its own check"
# ============================================================================
#
# DESCRIPTION:
#   The method of this repository rests on one fact: the test failed BEFORE the
#   code existed. That fact was taken on trust — whoever drove the loop, human
#   or AI assistant, simply said "it failed". It is checkable, so it is checked.
#
#   A test run can fail for a reason that has nothing to do with the test. When
#   a step file asks for a module that does not exist yet, the run dies while it
#   is still loading files: no scenario is ever tried, and the run still exits
#   non-zero. On a screen that looks exactly like the proof the method asks for.
#   It is not one.
#
#   The discriminator is already on disk. The suite writes one JUnit report per
#   worker (project/tests/e2e/support/junit-reporter.js), and it writes it only
#   when at least one scenario was recorded. So:
#
#     no report            -> the run died on its way to the test  (refused)
#     scenario absent      -> that scenario never ran              (refused)
#     scenario passed      -> nothing was proven                   (refused)
#     scenario failed      -> a real failure, quoted back          (accepted)
#
#   This gate is for the LOCAL loop, between writing the test and writing the
#   code. It is deliberately not a CI job: on a merge request the code is
#   already there, so every test is expected to pass.
#
# USAGE:
#   task devsecops:test:check:red-is-real -- @my-tag
#   bash .config/devsecops/scripts/check-red-is-real.sh @my-tag
#
# ENVIRONMENT VARIABLES:
#   REPORT_DIR   Where the JUnit reports are (default:
#                project/tests/e2e/_output/junit)
#
# EXIT CODES:
#   0  The scenario ran and failed on its own check
#   1  No report, no such scenario, or the scenario passed
#   2  No scenario tag given
#
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

TAG="${1:-}"
REPORT_DIR="${REPORT_DIR:-project/tests/e2e/_output/junit}"

if [ -z "${TAG}" ]; then
  echo -e "${RED}❌ Which scenario? Pass its tag: task devsecops:test:check:red-is-real -- @my-tag${NC}" >&2
  exit 2
fi

echo -e "${BLUE}🔴 Red-is-real gate (scenario: ${TAG})${NC}"

# Every recorded run of that scenario, one per line: status, name, message.
# A passed or skipped testcase is one self-closing line; a failed one carries a
# <failure> on the line below. Nothing else in the file can look like either.
records() {
  # The leading space in ` name="` is load-bearing: `classname="` also ends in
  # `name="`, and would win an unanchored match.
  awk -v tag="${TAG}" '
    /<testcase / {
      if (index($0, tag) == 0) next
      if (!match($0, / name="[^"]*"/)) next
      name = substr($0, RSTART + 7, RLENGTH - 8)
      if (index($0, "</testcase>") > 0) {
        printf "%s\t%s\t\n", (index($0, "<skipped/>") > 0 ? "skipped" : "passed"), name
        next
      }
      if ((getline next_line) > 0 && index(next_line, "<failure") > 0) {
        msg = next_line; sub(/.*message="/, "", msg); sub(/"[[:space:]]*\/>.*/, "", msg)
        printf "failed\t%s\t%s\n", name, msg
      }
    }
  ' "$@"
}

# The reporter escapes the scenario name and the failure message for XML; print
# them back the way the developer wrote them.
unescape() {
  sed -e 's/&quot;/"/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&#10;/ /g' -e 's/&amp;/\&/g'
}

shopt -s nullglob
reports=("${REPORT_DIR}"/results-*.xml)
shopt -u nullglob

if [ "${#reports[@]}" -eq 0 ]; then
  echo -e "${RED}❌ The run left no report at all: it stopped before a single scenario ran.${NC}"
  echo "   ${REPORT_DIR}/ holds no result file, so nothing was tried and nothing failed."
  echo "   A run that dies while loading its files — a missing module, a syntax error —"
  echo "   exits non-zero just like a failed test. That is a crash, not a proof."
  echo "   Make the run reach the scenario, then ask again."
  exit 1
fi

found="$(records "${reports[@]}")"

if [ -z "${found}" ]; then
  echo -e "${RED}❌ No scenario tagged ${TAG} in the report: that scenario never ran.${NC}"
  echo "   Recorded instead:"
  grep -h '<testcase ' "${reports[@]}" | sed -e 's/.* name="/   ~ /' -e 's/".*//' | unescape
  exit 1
fi

failure="$(printf '%s\n' "${found}" | awk -F'\t' '$1 == "failed"' | head -1 || true)"

if [ -z "${failure}" ]; then
  echo -e "${RED}❌ The scenario tagged ${TAG} did not fail. Nothing is proven.${NC}"
  printf '%s\n' "${found}" | while IFS=$'\t' read -r status name _; do
    echo "   ~ ${status}: ${name}" | unescape
  done
  echo "   The test must fail BEFORE the code that makes it pass exists. A test that was"
  echo "   never seen failing proves nothing about the code written after it."
  exit 1
fi

name="$(printf '%s' "${failure}" | cut -f2 | unescape)"
message="$(printf '%s' "${failure}" | cut -f3 | unescape)"
echo -e "${GREEN}✅ The failure is real: the scenario ran and failed on its own check.${NC}"
echo "   scenario: ${name}"
echo "   check   : ${message}"
