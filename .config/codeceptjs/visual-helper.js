/**
 * VisualHelper entry point — a one-line bridge, not a wrapper.
 *
 * CodeceptJS 4 loads helpers with `import()`. The published
 * `@digital-commons-official/codeceptjs-visual-helper` declares only a
 * `require` condition in its package `exports` map, so importing it by
 * package name dies with ERR_PACKAGE_PATH_NOT_EXPORTED — even though the code
 * itself is plain CommonJS that runs fine. A relative `require:` in
 * codecept.conf.js resolves to THIS file path instead of a package name, and
 * a file path is not gated by `exports`; the `require()` below then loads the
 * package through the condition it does publish.
 *
 * ponytail: delete this file and point `require:` back at the package name the
 * day it ships an `import`/`default` condition —
 * gitlab.com/digital-commons/software/libraries/npm/codeceptjs-visual-helper
 */

module.exports = require('@digital-commons-official/codeceptjs-visual-helper')
