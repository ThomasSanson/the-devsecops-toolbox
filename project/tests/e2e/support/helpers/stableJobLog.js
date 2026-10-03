/* global document */

// Concurrent filesystem walks and reporters emit the same information in
// different orders. Sort only those native log rows for visual comparison;
// keep every original row, path, package count, finding and verdict.
function stableJobLog () {
  const rows = Array.from(document.querySelectorAll('.js-log-line.job-log-line'))
  const groups = [
    rows.filter(row => /Scanned .+ file and found \d+ packages?/.test(row.textContent)),
    rows.filter(row => /\[(Gitlab Comment|Updated Sources) Reporter\]/.test(row.textContent))
  ]
  for (const rows of groups) {
    const text = row => row.textContent.match(/Scanned .+ file and found \d+ packages?|\[(?:Gitlab Comment|Updated Sources) Reporter\].*/)[0]
    const sorted = [...rows].sort((left, right) => text(left).localeCompare(text(right)))
    const slots = rows.map(row => {
      const slot = document.createComment('log-order')
      row.replaceWith(slot)
      return slot
    })
    slots.forEach((slot, index) => slot.replaceWith(sorted[index]))
  }
}

module.exports = { stableJobLog }
