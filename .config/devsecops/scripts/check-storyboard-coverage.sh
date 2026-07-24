#!/usr/bin/env bash
#
# ============================================================================
# Storyboard-coverage gate — "prove it in a storyboard, or it didn't happen"
# ============================================================================
#
# DESCRIPTION:
#   The key principle of this repository is that every PRODUCT change is proven
#   by a VISIBLE storyboard card. A written rule alone is ignorable — an agent
#   or a rushed human can ship a `.config/**` fix with no visual proof and the
#   pipeline stays green. This guard turns the principle into teeth: on a merge
#   request it FAILS when product files changed without any storyboard file
#   being changed OR added.
#
#   Product   = .config/**, copier.yml, Taskfile.yml{,.jinja}
#   Storyboard = project/tests/e2e/{features,screenshots/base,support/steps,storyboards}/**
#
#   Escape hatch (deliberate + visible, never silent): a commit in the range
#   carrying a `Storyboard-exempt: <reason>` trailer waives the gate. Review
#   sees the reason.
#
# USAGE:
#   BASE=origin/main bash check-storyboard-coverage.sh      # local
#   (CI passes CI_MERGE_REQUEST_DIFF_BASE_SHA automatically)
#
# TEST SEAM:
#   STORYBOARD_COVERAGE_FILES="a b c"  # newline/space list, bypasses git diff
#   STORYBOARD_EXEMPT=1                 # simulate an exemption trailer
#
# EXIT CODES:
#   0  Coverage holds (or no product change, or exempted)
#   1  Product changed with no storyboard change/addition and no exemption
#
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Product = the shipped framework surface. A change here must be proven visibly.
PRODUCT_RE='^(\.config/|copier\.yml$|Taskfile\.yml(\.jinja)?$)'
# A change/addition under any of these satisfies the gate.
STORYBOARD_RE='^project/tests/e2e/(features|screenshots/base|support/steps|storyboards)/'

BASE="${BASE:-${CI_MERGE_REQUEST_DIFF_BASE_SHA:-origin/main}}"

changed_files() {
  if [ -n "${STORYBOARD_COVERAGE_FILES:-}" ]; then
    # Intentional word-split of the space/newline-separated test list.
    # shellcheck disable=SC2086
    printf '%s\n' ${STORYBOARD_COVERAGE_FILES}
  else
    git diff --name-only --diff-filter=ACMR "${BASE}...HEAD"
  fi
}

is_exempt() {
  if [ -n "${STORYBOARD_EXEMPT:-}" ]; then
    return 0
  fi
  [ -z "${STORYBOARD_COVERAGE_FILES:-}" ] || return 1
  git log "${BASE}..HEAD" --format='%B' 2>/dev/null | grep -qiE '^Storyboard-exempt:[[:space:]]*\S'
}

echo -e "${BLUE}🎬 Storyboard-coverage gate (base: ${BASE})...${NC}"

mapfile -t all_changed < <(changed_files | sed '/^$/d')
product=()
storyboard=()
for f in "${all_changed[@]}"; do
  [[ "$f" =~ $PRODUCT_RE ]] && product+=("$f")
  [[ "$f" =~ $STORYBOARD_RE ]] && storyboard+=("$f")
done

if [ "${#product[@]}" -eq 0 ]; then
  echo -e "${GREEN}✅ No product change — nothing to prove.${NC}"
  exit 0
fi

if [ "${#storyboard[@]}" -gt 0 ]; then
  echo -e "${GREEN}✅ Product changed and a storyboard was changed/added:${NC}"
  printf '   ~ %s\n' "${storyboard[@]}"
  exit 0
fi

if is_exempt; then
  echo -e "${YELLOW}⚠️  Product changed with no storyboard, but a 'Storyboard-exempt:' trailer waives the gate.${NC}"
  exit 0
fi

echo -e "${RED}❌ Product changed with NO storyboard card changed or added:${NC}"
printf "   ${RED}~${NC} %s\n" "${product[@]}"
cat >&2 <<'MSG'

The key principle of this repo: every product change is proven by a visible
storyboard card. Do ONE of:
  - add/extend a card in project/tests/e2e/features/** (+ its step and baseline);
  - if the change is genuinely invisible, add a commit trailer:
        Storyboard-exempt: <why this needs no visual proof>
See .agent/rules/tests-integrity.md.
MSG
exit 1
