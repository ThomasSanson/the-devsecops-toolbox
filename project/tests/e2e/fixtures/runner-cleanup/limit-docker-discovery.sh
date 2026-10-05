#!/bin/sh
# Bound the destructive regression to our two real test runners. Never expose
# another developer's containers to the old global purge.
if [ "$1" = ps ]; then
  for argument in "$@"; do
    case "$argument" in
    status=exited | name=gitlab-runner)
      exec "$TASK_E2E_REAL_DOCKER" "$@" --filter "label=io.digital-commons.e2e.run=$TASK_E2E_RUN_OWNER"
      ;;
    esac
  done
fi
exec "$TASK_E2E_REAL_DOCKER" "$@"
