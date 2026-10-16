#!/usr/bin/env sh
set -eu
response=$(docker compose -f project/docker-compose.yml exec -T web wget -qO- http://127.0.0.1/) # DevSkim: ignore DS162092 -- Deliberate loopback check in the local test environment.
printf '%s\n' "$response" | grep -q 'Web application ready'
printf 'PASS: the Compose web application returns the expected HTTP response\n'
# The same result as a JUnit report, the format GitLab reads for its Tests tab.
mkdir -p project/tests/_output/junit
printf '<testsuite name="health" tests="1"><testcase classname="health" name="the Compose web application returns the expected HTTP response"/></testsuite>\n' >project/tests/_output/junit/health.xml
