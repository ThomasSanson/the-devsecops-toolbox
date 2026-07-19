#!/usr/bin/env bash
#
# ============================================================================
# Taskfile Include Coverage Checker
# ============================================================================
#
# DESCRIPTION:
#   Validates that every `taskfile:` include path declared in the root
#   Taskfile.yml (and its Taskfile.yml.jinja twin) points at a file that
#   actually exists on disk. Optional includes fail silently at runtime
#   (`optional: true`): a typo such as `.yaml` instead of `.yml` makes the
#   whole task namespace vanish with no error. This guard makes it loud.
#
# USAGE:
#   bash check-include-coverage.sh
#   task devsecops:test:check:include-coverage
#
# ENVIRONMENT VARIABLES:
#   PROJECT_ROOT   Project root path (default: current directory)
#
# EXIT CODES:
#   0  Every include path resolves to an existing file
#   1  At least one include path is missing
#
# ============================================================================

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Root Taskfile plus its template twin (both ship the same include list, so a
# typo duplicated across twins is caught in one pass).
taskfiles=("$PROJECT_ROOT/Taskfile.yml" "$PROJECT_ROOT/Taskfile.yml.jinja")

total_includes=0
missing_includes=0

echo -e "${BLUE}🔍 Checking Taskfile include paths...${NC}"

for taskfile in "${taskfiles[@]}"; do
  [ -f "$taskfile" ] || continue
  rel_taskfile="${taskfile#"$PROJECT_ROOT"/}"

  # Grab every `taskfile: <path>` include target (all static literals here).
  while IFS= read -r include_path; do
    [ -z "$include_path" ] && continue
    ((total_includes++)) || true
    if [ -f "$PROJECT_ROOT/$include_path" ]; then
      echo -e "${GREEN}✓${NC} $rel_taskfile → $include_path"
    else
      echo -e "${RED}✗${NC} $rel_taskfile → $include_path ${RED}(missing)${NC}"
      ((missing_includes++)) || true
    fi
  done < <(grep -oP '^\s*taskfile:\s+\K\S+' "$taskfile")
done

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Total include paths: $total_includes"
echo -e "Missing include files: ${RED}$missing_includes${NC}"

if [ "$missing_includes" -eq 0 ]; then
  echo -e "\n${GREEN}✅ Every Taskfile include path resolves to an existing file!${NC}"
  exit 0
else
  echo -e "\n${RED}❌ Broken include path(s) detected${NC}"
  echo -e "Fix the include target(s) above (a wrong extension makes an optional include vanish silently)."
  exit 1
fi
