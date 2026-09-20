#!/usr/bin/env sh
set -eu
test ! -S /var/run/docker.sock
test -n "${DOCKER_HOST:-}"
docker info >/dev/null
printf 'PASS: the project task keeps its Docker engine\n'
