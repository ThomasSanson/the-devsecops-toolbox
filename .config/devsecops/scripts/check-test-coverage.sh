#!/usr/bin/env bash
#
# ============================================================================
# CI Test Coverage Checker
# ============================================================================
#
# DESCRIPTION:
#   Validates that every test task from the Taskfile chain has a
#   corresponding CI job in the GitLab CI test configuration.
#
# USAGE:
#   bash check-test-coverage.sh
#   task devsecops:test:check:test-coverage
#
# ENVIRONMENT VARIABLES:
#   PROJECT_ROOT             Project root path (default: current directory)
#
# HOW IT WORKS:
#   1. Parses project/Taskfile.yml to find test suites in project:test:tdd
#   2. Parses .config/devsecops/Taskfile.test.yml to find checks in default
#   3. Parses .config/gitlab/ci/devsecops/test.yml to find CI job scripts
#   4. Verifies each test task has a corresponding CI job
#
# CONVENTIONS:
#   - In project:test:tdd: lines matching "- task: project:test:*"
#     (excluding clean, tdd) are test suites requiring CI coverage
#   - In devsecops:test default: lines matching "- task: check:*"
#     are validation checks requiring CI coverage (prefixed devsecops:test:)
#   - CI jobs must contain "task <full-task-name>" in their script block
#
# EXIT CODES:
#   0  All test tasks have an associated CI job
#   1  At least one test task is missing a CI job
#
# ============================================================================

set -euo pipefail

# Environment variables with defaults
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

PROJECT_TASKFILE="${PROJECT_ROOT}/project/Taskfile.yml"
DEVSECOPS_TEST_TASKFILE="${PROJECT_ROOT}/.config/devsecops/Taskfile.test.yml"
CI_TEST_FILE="${PROJECT_ROOT}/.config/gitlab/ci/devsecops/test.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
total_tasks=0
missing_ci_jobs=0

# ============================================================================
# Step 1: Extract test suite tasks from project:test:tdd
# ============================================================================

declare -a test_tasks=()

echo -e "${BLUE}🔍 Scanning test tasks from Taskfile chain...${NC}"

if [ ! -f "$PROJECT_TASKFILE" ]; then
  echo -e "${RED}❌ Project Taskfile not found: $PROJECT_TASKFILE${NC}"
  exit 1
fi

# Extract task references from project:test:tdd cmds
# Pattern: "- task: project:test:*" (excluding clean, tdd)
in_tdd_task=false
in_tdd_cmds=false
while IFS= read -r line; do
  # Detect project:test:tdd task definition
  if [[ "$line" =~ ^[[:space:]]+project:test:tdd: ]]; then
    in_tdd_task=true
    in_tdd_cmds=false
    continue
  fi

  # Exit task block on next task definition (2-space indent + name:)
  if $in_tdd_task && [[ "$line" =~ ^[[:space:]]{2}[a-zA-Z] && ! "$line" =~ ^[[:space:]]{4} ]]; then
    break
  fi

  # Detect cmds block within task
  if $in_tdd_task && [[ "$line" =~ ^[[:space:]]+cmds: ]]; then
    in_tdd_cmds=true
    continue
  fi

  # Extract task references from cmds
  if $in_tdd_cmds && [[ "$line" =~ ^[[:space:]]+-[[:space:]]+task:[[:space:]]+(project:test:[a-zA-Z0-9_-]+) ]]; then
    task_ref="${BASH_REMATCH[1]}"
    # Exclude infrastructure tasks (clean, tdd)
    if [[ "$task_ref" != "project:test:clean" && "$task_ref" != "project:test:tdd" ]]; then
      test_tasks+=("$task_ref")
    fi
  fi
done <"$PROJECT_TASKFILE"

# ============================================================================
# Step 2: Extract check tasks from devsecops:test default
# ============================================================================

if [ -f "$DEVSECOPS_TEST_TASKFILE" ]; then
  in_default_task=false
  in_default_cmds=false
  while IFS= read -r line; do
    # Detect default task definition
    if [[ "$line" =~ ^[[:space:]]+default: ]]; then
      in_default_task=true
      in_default_cmds=false
      continue
    fi

    # Exit task block on next task definition
    if $in_default_task && [[ "$line" =~ ^[[:space:]]{2}[a-zA-Z] && ! "$line" =~ ^[[:space:]]{4} ]]; then
      break
    fi

    # Detect cmds block within task
    if $in_default_task && [[ "$line" =~ ^[[:space:]]+cmds: ]]; then
      in_default_cmds=true
      continue
    fi

    # Extract check task references (check:*)
    if $in_default_cmds && [[ "$line" =~ ^[[:space:]]+-[[:space:]]+task:[[:space:]]+(check:[a-zA-Z0-9_-]+) ]]; then
      # Prefix with devsecops:test: namespace (as called in CI)
      test_tasks+=("devsecops:test:${BASH_REMATCH[1]}")
    fi
  done <"$DEVSECOPS_TEST_TASKFILE"
fi

# Display found tasks
echo -e "${GREEN}✓ ${#test_tasks[@]} test task(s) found${NC}"
if [ ${#test_tasks[@]} -gt 0 ]; then
  for task in "${test_tasks[@]}"; do
    echo "  - $task"
  done
fi
echo ""

# ============================================================================
# Step 3: Extract CI job task commands from test.yml
# ============================================================================

echo -e "${BLUE}🔍 Scanning CI test jobs from test.yml...${NC}"

if [ ! -f "$CI_TEST_FILE" ]; then
  echo -e "${RED}❌ CI test file not found: $CI_TEST_FILE${NC}"
  exit 1
fi

# Extract all "task <name>" commands from script blocks
declare -a ci_tasks=()
mapfile -t ci_tasks < <(grep -oP '^\s*-\s+task\s+\K[a-zA-Z0-9:_-]+' "$CI_TEST_FILE" | sort -u)

echo -e "${GREEN}✓ ${#ci_tasks[@]} CI task command(s) found${NC}"
if [ ${#ci_tasks[@]} -gt 0 ]; then
  for ci_task in "${ci_tasks[@]}"; do
    echo "  - $ci_task"
  done
fi
echo ""

# ============================================================================
# Step 4: Verify coverage
# ============================================================================

echo -e "${BLUE}🔍 Verifying test coverage...${NC}\n"

for task in "${test_tasks[@]}"; do
  ((total_tasks++)) || true

  task_found=false
  for ci_task in "${ci_tasks[@]}"; do
    if [[ "$ci_task" == "$task" ]]; then
      task_found=true
      break
    fi
  done

  if $task_found; then
    echo -e "${GREEN}✓${NC} $task"
  else
    echo -e "${RED}✗${NC} $task"
    echo -e "  ${RED}→ Missing CI job for: $task${NC}"
    ((missing_ci_jobs++)) || true
  fi
done

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$total_tasks" -eq 0 ]; then
  echo -e "${GREEN}✅ No test tasks found to verify${NC}"
  exit 0
fi

echo -e "Total test tasks: $total_tasks"
echo -e "Missing CI jobs: ${RED}$missing_ci_jobs${NC}"
echo -e "Coverage: $(((total_tasks - missing_ci_jobs) * 100 / total_tasks))%"

if [ "$missing_ci_jobs" -eq 0 ]; then
  echo -e "\n${GREEN}✅ All test tasks have an associated CI job!${NC}"
  exit 0
else
  echo -e "\n${RED}❌ Missing CI jobs detected${NC}\n"
  echo -e "Add the missing task(s) to .config/gitlab/ci/devsecops/test.yml"
  echo ""
  exit 1
fi
