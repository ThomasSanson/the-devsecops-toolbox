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
#   The discriminator is already on disk. A test runner writes its JUnit report
#   only for scenarios it actually ran, so:
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
#   Any runner's JUnit will do — this repository's own reporter, pytest, jest,
#   go-junit-report. The reader is deliberately indifferent to how the XML is
#   laid out, because every one of them lays it out differently.
#
# ENVIRONMENT VARIABLES:
#   REPORT_DIR   Where the JUnit reports are (default:
#                project/tests/e2e/_output/junit). Point it at your runner's
#                report directory; the files are read as `results-*.xml`.
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

# Every recorded run of a scenario whose name contains TAG, one per line:
# status, name, message.
#
# Read as a stream of TAGS, never of lines. JUnit is XML, and every runner lays
# it out differently: this repository's own reporter writes one testcase per
# line, pytest writes the whole document on one line and lets a failure message
# span the next thirty. Splitting on `<` makes the reader indifferent to that —
# which is the point, since the whole reason to read JUnit is that every runner
# writes it.
#
# The leading space in ` name="` is load-bearing twice over: `classname="` also
# ends in `name="`, and so does the enclosing `<testsuite name="pytest">`.
records() {
  # TAG='' lists every scenario, whatever its name — used by the refusal below.
  awk -v tag="${TAG}" '
    BEGIN { RS = "<"; pending = 0 }
    function attr(record, key,   pattern) {
      pattern = "[ \t]" key "=\"[^\"]*\""
      if (!match(record, pattern)) return ""
      return substr(record, RSTART + length(key) + 3, RLENGTH - length(key) - 4)
    }
    function flush() {
      if (!pending) return
      if (tag == "" || index(name, tag) > 0) {
        printf "%s\t%s\t%s\n", (failed ? "failed" : (skipped ? "skipped" : "passed")), name, msg
      }
      pending = 0; name = ""; msg = ""; failed = 0; skipped = 0
    }
    /^testcase[ \t]/ {
      flush()
      name = attr($0, "name"); pending = 1
      next
    }
    /^(failure|error)[ \t>\/]/ && pending {
      failed = 1
      if (msg == "") msg = attr($0, "message")
      next
    }
    /^skipped[ \t>\/]/ && pending { skipped = 1; next }
    /^\/testcase/ { flush(); next }
    END { flush() }
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
  TAG='' records "${reports[@]}" | cut -f2 | sed 's/^/   ~ /' | unescape
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
