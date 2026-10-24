#!/usr/bin/env bash
set -eu

# DevSkim opens every source file before analyzing them. Docker's low soft
# limit can crash its logger instead of reporting findings on a large project.
# Keep the administrator's hard limit and use the capacity already permitted.
ulimit -Sn "$(ulimit -Hn)"
exec devskim "$@"
