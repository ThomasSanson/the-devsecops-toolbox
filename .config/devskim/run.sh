#!/usr/bin/env bash
ulimit -Sn "$(ulimit -Hn)" || exit
exec devskim "$@"
