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
#     report cut short     -> nobody knows what the run did        (refused)
#     scenario absent      -> that scenario never ran              (refused)
#     tag on several       -> the proof points at no one scenario  (refused)
#     scenario passed      -> nothing was proven                   (refused)
#     environment failed   -> the test never reached its check     (refused)
#     scenario failed      -> a real failure, quoted back          (accepted)
#
#   "Environment failed" is an <error> element, or a failure whose text says
#   the test stopped before its own check: a refused connection, an unknown
#   host, a missing module, a failed hook. A runner may file those as a plain
#   <failure> (this repository's reporter files everything that way), so the
#   words are read, not only the element.
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
#   1  No whole report, no such scenario, a tag on several, the scenario
#      passed, or it failed on its environment
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

# What a test says when it stopped on its environment, before its own check:
# a network error from Node or a browser, a refused connection in any language,
# a module that is not there, a hook (mocha's titles, CodeceptJS's suite hooks)
# that failed before the scenario ran. Read in the testcase's name and in the
# failure's message and text.
# cspell:ignore ECONNREFUSED ENOTFOUND EHOSTUNREACH ENETUNREACH
INFRA='ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connection refused|Connection refused|net::ERR_|Cannot find module|Cannot find package|No module named|(before|after) (each|all)(&quot;|") hook|BeforeSuite|AfterSuite|(Before|After) hook'

# Every recorded run of a scenario named by TAG, one per line: status, name,
# message. The status is passed, skipped, failed (on the test's own check) or
# broken (on its environment, see INFRA).
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
#
# A Gherkin tag ends where its word ends: @greeting names a scenario tagged
# @greeting, not one tagged @greeting-text. Any other TAG (a unit test's name)
# is matched anywhere in the name, as before.
records() {
  # TAG='' lists every scenario, whatever its name — used by the refusal below.
  awk -v tag="${TAG}" -v infra="${INFRA}" '
    BEGIN { RS = "<"; pending = 0 }
    function attr(record, key,   pattern) {
      pattern = "[ \t]" key "=\"[^\"]*\""
      if (!match(record, pattern)) return ""
      return substr(record, RSTART + length(key) + 3, RLENGTH - length(key) - 4)
    }
    function named(n,   at, after) {
      if (tag == "") return 1
      while ((at = index(n, tag)) > 0) {
        after = substr(n, at + length(tag), 1)
        if (substr(tag, 1, 1) != "@" || after !~ /[A-Za-z0-9_-]/) return 1
        n = substr(n, at + 1)
      }
      return 0
    }
    function flush(   status) {
      if (!pending) return
      if (named(name)) {
        status = failed ? ((broken || evidence ~ infra) ? "broken" : "failed") : (skipped ? "skipped" : "passed")
        printf "%s\t%s\t%s\n", status, name, msg
      }
      pending = 0; name = ""; msg = ""; failed = 0; skipped = 0; broken = 0; evidence = ""; inside = 0
    }
    /^testcase[ \t]/ {
      flush()
      name = attr($0, "name"); pending = 1; evidence = name
      next
    }
    /^(failure|error)[ \t>\/]/ && pending {
      failed = 1
      if (/^error/) broken = 1
      if (msg == "") msg = attr($0, "message")
      # The element and its text, up to its closing tag: a CDATA section
      # arrives as records of its own.
      evidence = evidence "\n" $0
      head = $0; gsub(/"[^"]*"/, "", head)
      inside = (substr(head, 1, index(head, ">")) !~ /\/>$/)
      next
    }
    /^\/(failure|error)[ \t>]/ { inside = 0; next }
    inside { evidence = evidence "\n" $0; next }
    /^skipped[ \t>\/]/ && pending { skipped = 1; next }
    /^\/testcase/ { flush(); next }
    END { flush() }
  ' "$@"
}

# Why a report is not a whole XML document, or nothing when it is. A run killed
# while it writes its report leaves it cut in the middle, and a cut report can
# say anything. Every open tag must close, in order, and nothing may be cut in
# the middle of a tag.
incomplete() {
  awk '
    BEGIN { RS = "<"; depth = 0; closer = ""; why = "" }
    NR == 1 || why != "" { next }
    closer != "" { if (index($0, closer)) closer = ""; next }
    /^[?]/ { next }
    /^!--/ { if (!index($0, "-->")) closer = "-->"; next }
    /^!\[CDATA\[/ { if (!index($0, "]]>")) closer = "]]>"; next }
    /^!/ { next }
    {
      head = $0; gsub(/"[^"]*"/, "", head)
      if (!index(head, ">")) { why = "it stops in the middle of a tag"; next }
      head = substr(head, 1, index(head, ">"))
      element = head; sub(/^\//, "", element); sub(/[ \t\r\n\/>].*/, "", element)
      if (head ~ /^\//) {
        if (depth == 0 || stack[depth] != element) why = "</" element "> closes a tag that is not open"
        depth--
      } else if (head !~ /\/>$/) {
        stack[++depth] = element
      }
      seen = 1
    }
    END {
      if (why == "" && closer != "") why = "a comment or a CDATA section never closes"
      if (why == "" && depth > 0) why = "<" stack[1] "> never closes"
      if (why == "" && !seen) why = "it holds no XML at all"
      if (why != "") print why
    }
  ' "$1"
}

# The reporter escapes the scenario name and the failure message for XML; print
# them back the way the developer wrote them, on one line: a line break, a
# carriage return or a tab becomes a space.
unescape() {
  sed -e 's/&quot;/"/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&#10;/ /g' -e 's/&#13;/ /g' -e 's/&#9;/ /g' -e 's/&amp;/\&/g'
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

for report in "${reports[@]}"; do
  why="$(incomplete "${report}")"
  if [ -n "${why}" ]; then
    echo -e "${RED}❌ ${report} is not a whole JUnit report: ${why}.${NC}"
    echo "   A run killed while it writes its report leaves the file cut short, and a"
    echo "   report that does not close cannot say what the run did. Run the scenario"
    echo "   again, then ask again."
    exit 1
  fi
done

found="$(records "${reports[@]}")"

if [ -z "${found}" ]; then
  echo -e "${RED}❌ No scenario tagged ${TAG} in the report: that scenario never ran.${NC}"
  echo "   Recorded instead:"
  TAG='' records "${reports[@]}" | cut -f2 | sed 's/^/   ~ /' | unescape
  exit 1
fi

scenarios="$(printf '%s\n' "${found}" | cut -f2 | sort -u)"
count="$(printf '%s\n' "${scenarios}" | wc -l | tr -d ' ')"

if [ "${count}" -gt 1 ]; then
  echo -e "${RED}❌ The tag ${TAG} names ${count} scenarios: a proof must point at one.${NC}"
  printf '%s\n' "${scenarios}" | sed 's/^/   ~ /' | unescape
  echo "   Ask about the scenario you are proving, by a tag that only it carries."
  exit 1
fi

failure="$(printf '%s\n' "${found}" | awk -F'\t' '$1 == "failed"' | head -1 || true)"
broken="$(printf '%s\n' "${found}" | awk -F'\t' '$1 == "broken"' | head -1 || true)"

if [ -z "${failure}" ] && [ -n "${broken}" ]; then
  echo -e "${RED}❌ The scenario tagged ${TAG} stopped before its own check: its environment failed, not the test.${NC}"
  echo "   scenario: $(printf '%s' "${broken}" | cut -f2 | unescape)"
  echo "   error   : $(printf '%s' "${broken}" | cut -f3 | unescape)"
  echo "   A refused connection, an unknown host, a missing module or a failed hook"
  echo "   fails whatever the code does, so it proves nothing about the code. Make the"
  echo "   test reach what it checks, then ask again."
  exit 1
fi

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
