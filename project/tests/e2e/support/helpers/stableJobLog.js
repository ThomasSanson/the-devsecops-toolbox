/* global document */

// Concurrent filesystem walks and reporters emit the same information in
// different orders. Sort only those native log rows for visual comparison;
// keep every original row, path, package count, finding and verdict.
// Reporter rows can print before or after MegaLinter's summary table. Gather
// them just before its final verdict, regardless of when each one finished.
// The GitLab reporter's refused-token warning ends on two untagged rows: they
// travel with the tagged row above them.
function stableJobLog () {
  const rows = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
  const scans = rows.filter(row => /Scanned .+ file and found \d+ packages?/.test(row.textContent)).map(row => [row])
  const reporters = []
  for (const row of rows) {
    if (/\[(Gitlab Comment|SARIF|Updated Sources) Reporter\]/.test(row.textContent)) reporters.push([row])
    else if (reporters.length && /\(if already defined, your token is probably invalid\)|If you are using local certificate/.test(row.textContent)) reporters.at(-1).push(row)
  }
  const verdict = rows.find(row => /Successfully linted all files without errors|Error\(s\) have been found during linting/.test(row.textContent))
  for (const group of [scans, reporters].filter(group => group.length)) {
    const text = ([row]) => row.textContent.match(/Scanned .+ file and found \d+ packages?|\[(?:Gitlab Comment|SARIF|Updated Sources) Reporter\].*/)[0]
    const sorted = [...group].sort((left, right) => text(left).localeCompare(text(right)))
    const slot = document.createComment('log-order')
    if (group === reporters && verdict) verdict.before(slot)
    else group.at(-1).at(-1).after(slot)
    slot.replaceWith(...sorted.flat())
  }
}

module.exports = { stableJobLog }
