/**
 * Deterministic filtering of `task devsecops:init` captured output before it is
 * rendered to a <pre> for a visual baseline. Extracted so both the shared
 * step file (init-baseline.js) and the token-healing storyboard
 * (init-token-lifecycle.js) filter the exact same noise — the patterns are
 * load-bearing for tolerance:0, so they must live in ONE place.
 */

// Strip ANSI escape sequences so the pixel-perfect baseline stays stable.
function stripAnsi (str) {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Lines whose content varies between runs (timestamps, IDs, network info) are
// dropped before rendering, otherwise the visual baseline is brittle by design.
const TASK_OUTPUT_NOISE_PATTERNS = [
  /^\{"id":\d+/,
  /^🦊 Applying merge request settings/,
  /^task: \[/,
  // Token creation line carries the expiration date (90 days ahead) which
  // shifts every run. The success line ("Token created and CI/CD variable
  // ... stored") that follows is deterministic and sufficient as proof.
  /Creating new Project Access Token .*expires \d{4}-\d{2}-\d{2}/,
  // Lefthook iterates a Go map when emitting the hook list, so the order
  // (e.g. "(commit-msg, pre-commit)" vs "(pre-commit, commit-msg)") is
  // non-deterministic. The following "Lefthook:install phase completed
  // successfully" line is deterministic and sufficient proof.
  /^sync hooks: /
]

function filterTaskOutput (raw) {
  return stripAnsi(raw)
    .replace(/\r/g, '')
    // The duplicate-purge healing line carries the revoked token's numeric id,
    // which differs on every run — mask it so the verdict stays pixel-stable.
    .replace(/Revoked duplicate token #\d+/g, 'Revoked duplicate token #<id>')
    // `glab --version` prints the CLI's version and build hash, and init echoes
    // it while installing. Both move on every upstream release, so without this
    // mask the picture breaks on each glab bump — a dependency this framework
    // updates often — and a baseline is regenerated to say nothing new. What
    // these frames prove is that init HEALS a broken connection, never which
    // glab shipped that week.
    .replace(/^glab \d+\.\d+\.\d+ \(\S+\)$/gm, 'glab <version> (<build>)')
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed === '') return true
      return !TASK_OUTPUT_NOISE_PATTERNS.some(re => re.test(trimmed))
    })
}

// Keep only the last `tail` lines up to (and including) the completion marker,
// so the deterministic verdict block is isolated from earlier scrollback.
function tailFromMarker (lines, marker, tail = 30) {
  const markerIdx = lines.reduce((last, line, idx) => (line.includes(marker) ? idx : last), -1)
  if (markerIdx < 0) return lines.slice(Math.max(0, lines.length - tail))
  const end = markerIdx + 1
  return lines.slice(Math.max(0, end - tail), end)
}

module.exports = { stripAnsi, TASK_OUTPUT_NOISE_PATTERNS, filterTaskOutput, tailFromMarker }
