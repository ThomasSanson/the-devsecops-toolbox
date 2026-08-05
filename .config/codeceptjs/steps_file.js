// in this file you can append custom step methods to 'I' object

// Imported, not global: the configs run with `noGlobals: true`, CodeceptJS 4's
// default. Only this directory can resolve `codeceptjs` — node_modules lives
// here, not in the test tree.
const { actor } = require('codeceptjs')

module.exports = function() {
  return actor({

    // Define custom steps here, use 'this' to access default methods of I.
    // It is recommended to place a general 'login' function here.

  });
}
