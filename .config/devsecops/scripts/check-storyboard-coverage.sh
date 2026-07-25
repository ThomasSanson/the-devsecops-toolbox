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
#   request it FAILS when product files changed and no storyboard baseline was
#   captured or updated with them.
#
#   Product = .config/**, copier.yml, Taskfile.yml{,.jinja}
#   Proof   = project/tests/e2e/screenshots/base/**.png
#
#   The proof is the CAPTURED artifact, not a text file next to it: a baseline
#   image exists only because a test really ran and photographed something. A
#   comment added to a .feature produces none, so "touch a file under the
#   storyboard folder" does not pass the gate.
#
#   Escape hatch (deliberate + visible, never silent): a commit in the range
#   carrying a `Storyboard-exempt: <reason>` trailer waives the gate. Review
#   sees the reason.
#
# USAGE:
#   BASE=origin/main bash check-storyboard-coverage.sh      # local
#   (CI passes CI_MERGE_REQUEST_DIFF_BASE_SHA automatically)
#
# EXIT CODES:
#   0  Coverage holds (or no product change, or exempted)
#   1  Product changed with no captured baseline and no exemption
#
# ============================================================================

set -euo pipefail

# The diff base, the git-ownership fix the CI checkout needs and the visible
# waiver are shared with the other merge-request guard (no-cheat).
# shellcheck source=.config/devsecops/scripts/diff-base.sh
source "$(dirname "${BASH_SOURCE[0]}")/diff-base.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Product = the shipped framework surface. A change here must be proven visibly.
PRODUCT_RE='^(\.config/|copier\.yml$|Taskfile\.yml(\.jinja)?$)'
# What satisfies the gate: a baseline image, changed or added. Only a real
# capture run produces one.
PROOF_RE='^project/tests/e2e/screenshots/base/.+\.png$'
# Storyboard TEXT touched without capturing anything — a comment typed into a
# card. Named separately in the refusal so the author sees the gate read it and
# refused it anyway, instead of wondering whether it was even looked at.
TEXT_RE='^project/tests/e2e/(features|support/steps|storyboards)/'

BASE="$(resolve_diff_base)"

changed_files() {
  git diff --name-only --diff-filter=ACMR "${BASE}...HEAD"
}

is_exempt() {
  has_exempt_trailer Storyboard "${BASE}"
}

echo -e "${BLUE}🎬 Storyboard-coverage gate (base: ${BASE})...${NC}"

# `mapfile < <(cmd)` SWALLOWS cmd's exit status: a git diff that cannot resolve
# BASE would leave the list empty and the gate would announce "nothing to prove"
# — failing open, silently. Capture first, and refuse loudly instead.
if ! diff_output="$(changed_files)"; then
  echo -e "${RED}❌ Cannot compute the diff against ${BASE} — refusing to pass silently.${NC}" >&2
  exit 1
fi
mapfile -t all_changed < <(printf '%s\n' "${diff_output}" | sed '/^$/d')
product=()
proof=()
text=()
for f in "${all_changed[@]}"; do
  [[ "$f" =~ $PRODUCT_RE ]] && product+=("$f")
  [[ "$f" =~ $PROOF_RE ]] && proof+=("$f")
  [[ "$f" =~ $TEXT_RE ]] && text+=("$f")
done

if [ "${#product[@]}" -eq 0 ]; then
  echo -e "${GREEN}✅ No product change — nothing to prove.${NC}"
  exit 0
fi

if [ "${#proof[@]}" -gt 0 ]; then
  echo -e "${GREEN}✅ Product changed and a storyboard captured it:${NC}"
  printf '   ~ %s\n' "${proof[@]}"
  exit 0
fi

if is_exempt; then
  echo -e "${YELLOW}⚠️  Product changed with no storyboard, but a 'Storyboard-exempt:' trailer waives the gate.${NC}"
  exit 0
fi

echo -e "${RED}❌ Product changed with NO storyboard picture to prove it:${NC}"
printf "   ${RED}~${NC} %s\n" "${product[@]}"
if [ "${#text[@]}" -gt 0 ]; then
  echo -e "${YELLOW}   A storyboard file changed, but it captured no picture — text is not proof:${NC}"
  printf "   ${YELLOW}~${NC} %s\n" "${text[@]}"
fi
cat >&2 <<'MSG'

The key principle of this repo: every product change is proven by a visible
storyboard card, and the proof is the picture that card captures — a comment
next to it is not one. Do ONE of:
  - add or extend a card in project/tests/e2e/features/** and commit the
    baseline it captures (project/tests/e2e/screenshots/base/**);
  - if the change is genuinely invisible, add a commit trailer:
        Storyboard-exempt: <why this needs no visual proof>
See .agent/rules/tests-integrity.md.
MSG
exit 1
