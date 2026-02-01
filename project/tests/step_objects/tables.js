/**
 * Table utilities for Gherkin data tables
 *
 * Provides helper functions to work with Cucumber/CodeceptJS data tables.
 */

/**
 * Get rows from a data table, optionally extracting a specific column
 * @param {Object} table - The data table object
 * @param {string} [columnName] - Optional column name to extract
 * @returns {string[]} Array of values
 */
function getTableRows (table, columnName = null) {
  if (!table.rows || table.rows.length === 0) return []

  // If column name is provided, find its index in the header
  if (columnName) {
    const headers = table.rows[0].cells.map(c => c.value)
    const colIndex = headers.indexOf(columnName)

    if (colIndex === -1) {
      console.warn(`Column '${columnName}' not found in table headers: ${headers.join(', ')}`)
      return []
    }

    // Return values from that column, skipping the header row
    return table.rows.slice(1).map(row => {
      const cell = row.cells[colIndex]
      return cell ? cell.value : ''
    }).filter(val => val !== '')
  }

  // Fallback: return first column values if no column name specified
  return table.rows.map(row => {
    const cell = row.cells[0]
    // If it looks like a header row (matches 'Directory Path' e.g.), we might want to skip it?
    // But without columnName we don't know what is header.
    // Standardize to always return strings.
    return cell ? cell.value : ''
  }).filter(val => val !== '')
}

/**
 * Get cell values from a data table with headers
 * @param {Object} table - The data table object
 * @param {number} [columnIndex] - Column index to extract (default: 0)
 * @returns {string[]} Array of cell values (excluding header)
 */
function getTableCells (table, columnIndex = 0) {
  // table.rows is an array of row objects, skip header row
  // Each row has a cells array with cell objects containing value property
  return table.rows.slice(1).map(row => row.cells[columnIndex].value)
}

/**
 * Get key-value pairs from a data table (vertical or horizontal)
 * @param {Object} table - The data table object
 * @returns {Object} Object with key-value pairs
 */
function getKeyValuePairs (table) {
  const data = {}

  // Try parsing raw table
  let rawRows = []
  if (table.parse) {
    // Cucumber/CodeceptJS table object
    rawRows = table.parse().raw()
  } else if (table.rows) {
    // Direct structure access might be needed if parse() isn't available
    // But usually we interact with table object in steps
    // Fallback: assume rows have cells
    rawRows = table.rows.map(r => r.cells.map(c => c.value))
  }

  // Check for vertical table (Key | Value)
  // Logic: Iterate rows, if row has 2 columns, treat as Key=Value
  rawRows.forEach(row => {
    if (row.length === 2) {
      data[row[0]] = row[1]
    }
  })

  // TODO: Add horizontal table support if needed (Header row + 1 data row)
  return data
}

module.exports = {
  getTableRows,
  getTableCells,
  getKeyValuePairs
}
