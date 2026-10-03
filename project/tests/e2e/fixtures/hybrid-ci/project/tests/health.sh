#!/usr/bin/env sh
set -eu
response=$(docker compose -f project/docker-compose.yml exec -T web wget -qO- http://127.0.0.1/) # DevSkim: ignore DS162092 -- Deliberate loopback check in the local test environment.
printf '%s\n' "$response" | grep -q 'Web application ready'
printf 'PASS: the Compose web application returns the expected HTTP response\n'
