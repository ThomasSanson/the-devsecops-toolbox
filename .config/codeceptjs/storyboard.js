/**
 * Storyboard entry point — a one-line bridge, not a wrapper.
 *
 * The engine ships as `@digital-commons-official/codeceptjs-storyboard`. The
 * step files under project/tests sit outside this folder, so they cannot
 * resolve a package installed in .config/codeceptjs/node_modules by its name.
 * They require THIS file, and codecept.conf.js registers the plugin through
 * the same path, so the plugin and the steps share one engine.
 *
 * Source and docs:
 * gitlab.com/digital-commons/software/libraries/npm/codeceptjs-storyboard
 */

module.exports = require('@digital-commons-official/codeceptjs-storyboard')
