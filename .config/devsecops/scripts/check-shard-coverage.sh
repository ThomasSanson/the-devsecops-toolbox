#!/usr/bin/env bash
# Guard: every e2e feature file must belong to EXACTLY ONE CI shard.
#
# The CI test job runs `parallel: N`, each shard running only the feature
# files its entry in shards.json lists (via TASK_CODECEPTJS_FEATURES). A
# feature file missing from the map would silently never run in CI; one
# listed in several shards would run twice and skew durations and JUnit
# counts. This guard fails the build in both cases, and when a shard lists a
# file that does not exist (a rename would otherwise silently drop a story).
set -euo pipefail

SHARDS_FILE="${SHARDS_FILE:-project/tests/e2e/shards.json}"
FEATURES_DIR="${FEATURES_DIR:-project/tests/e2e/features}"

if [ ! -f "$SHARDS_FILE" ]; then
  echo "❌ shard map not found: $SHARDS_FILE"
  exit 1
fi

mapfile -t shard_entries < <(jq -r 'to_entries[] | select(.key | test("^[0-9]+$")) | .value' "$SHARDS_FILE")
if [ "${#shard_entries[@]}" -eq 0 ]; then
  echo "❌ no shard entries in $SHARDS_FILE"
  exit 1
fi

errors=0

# Every path listed in a shard must exist on disk (paths are relative to the
# codecept dir, i.e. the features/ parent).
declare -A shard_files
for entry in "${shard_entries[@]}"; do
  IFS=',' read -ra paths <<< "$entry"
  for p in "${paths[@]}"; do
    resolved="${FEATURES_DIR%/features}/${p#./}"
    if [ ! -f "$resolved" ]; then
      echo "❌ shard lists a missing file: $p"
      errors=$((errors + 1))
    fi
    shard_files["$p"]=$(( ${shard_files["$p"]:-0} + 1 ))
  done
done

# Every feature file on disk must be claimed by exactly one shard.
count=0
while IFS= read -r f; do
  count=$((count + 1))
  rel="./${f#"${FEATURES_DIR%/features}/"}"
  claims="${shard_files[$rel]:-0}"
  if [ "$claims" -ne 1 ]; then
    echo "❌ $rel claimed by $claims shard(s) — expected exactly 1"
    errors=$((errors + 1))
  fi
done < <(find "$FEATURES_DIR" -name '*.feature' | sort)

if [ "$errors" -gt 0 ]; then
  echo "❌ shard coverage check failed ($errors problem(s) across $count feature file(s))"
  exit 1
fi
echo "✅ shard coverage: $count feature file(s), each claimed by exactly one of ${#shard_entries[@]} shards"
