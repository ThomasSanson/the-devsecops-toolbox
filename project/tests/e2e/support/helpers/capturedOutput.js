/**
 * stripAnsi turns captured command output back into plain text for the asserts.
 */
function stripAnsi (str) {
  return String(str)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

module.exports = {
  stripAnsi
}
