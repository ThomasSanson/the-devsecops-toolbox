const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runInstaller (script) {
  const source = path.resolve(__dirname, '../../../.config/node')
  const result = spawnSync('docker', [
    'run', '--rm', '--pull=never', '--network=none', '--cpus=2', '--memory=1g',
    '--pids-limit=256', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--volume', `${source}:/work/node:ro`, '--workdir=/work',
    'registry.gitlab.com/digital-commons/devsecops/the-devsecops-toolbox:24.10.1',
    'bash', '-c', script
  ], { encoding: 'utf8', timeout: 180000 })
  assert.ifError(result.error)
  const output = result.stdout + result.stderr
  process.stdout.write(output)
  return { status: result.status, output }
}

test('@node-reinstallation pinned tools survive repeated installation in the CI image', () => {
  const result = runInstaller(`
      set -eu
      ln --version | head -n 1
      expected="v$(cat /work/node/version)"
      for attempt in 1 2 3; do
        bash /work/node/install.sh
        test "$("$HOME/.local/bin/node" --version)" = "$expected"
        test -x "$(readlink -f "$HOME/.local/bin/npm")"
        test -x "$(readlink -f "$HOME/.local/bin/npx")"
        printf 'PASS: pinned tools available after installation %s\\n' "$attempt"
      done
    `)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /PASS: pinned tools available after installation 3/)
})

test('@node-reinstallation-concurrent every shared-toolchain installer succeeds', () => {
  const result = runInstaller(`
    set -eu
    output="$(mktemp -d)"
    trap 'rm -rf "$output"' EXIT
    for round in 1 2 3; do
      pids=()
      for worker in 1 2 3 4 5 6 7 8; do
        bash /work/node/install.sh >"$output/$worker.log" 2>&1 &
        pids+=("$!")
      done
      failed=0
      for pid in "\${pids[@]}"; do
        if ! wait "$pid"; then failed=1; fi
      done
      cat "$output/"*.log
      test "$failed" -eq 0
      test "$("$HOME/.local/bin/node" --version)" = "v$(cat /work/node/version)"
      test -x "$(readlink -f "$HOME/.local/bin/npm")"
      test -x "$(readlink -f "$HOME/.local/bin/npx")"
      printf 'PASS: all eight installers succeeded in round %s\\n' "$round"
    done
  `)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /PASS: all eight installers succeeded in round 3/)
})
