/**
 * CodeceptJS Configuration — unified E2E suite
 *
 * Single entry point that replaces the former bootstrap/, gitlab/ and template/
 * suites. Scenarios prove their effects with pixel baselines wherever the
 * content is deterministic, through one of two capture styles:
 *
 *   1. Live-terminal capture (journey scenarios): the user's real ttyd/xterm
 *      session is screenshotted via support/terminal/capture.js, optionally
 *      anchored from a marker row to skip non-deterministic scrollback.
 *   2. Filtered <pre> render (init-effects/guidance/release scenarios): the
 *      captured command output is noise-filtered, rendered in the browser as
 *      a <pre> block and screenshotted.
 *
 * GitLab-side effects are proven by page screenshots (masked: dates, avatars,
 * top bar, per-run project names) plus REST assertions where content is
 * volatile (token values, MR diffs).
 *
 * Visual regression is pixel-perfect (tolerance: 0). Chromium flags pin font and
 * color rendering so baselines are reproducible across local and CI runners.
 */

exports.config = {
  output: './_output',
  // CodeceptJS 4's default: nothing but the runner's own DSL is global.
  // Given/When/Then stay scope-injected while the step files load, and
  // inject()/codecept_dir/output_dir survive — the rest is imported.
  noGlobals: true,
  include: {
    I: '../../../.config/codeceptjs/steps_file.js',
    GitLabUserPage: './pages/GitLabUserPage.js',
    GitLabProjectPage: './pages/GitLabProjectPage.js',
    GitLabAccessTokenPage: './pages/GitLabAccessTokenPage.js',
    GitLabMergeRequestPage: './pages/GitLabMergeRequestPage.js',
    GitLabRepositoryPage: './pages/GitLabRepositoryPage.js',
    GitLabSettingsPage: './pages/GitLabSettingsPage.js'
  },
  helpers: {
    Playwright: {
      browser: 'chromium',
      url: 'http://gitlab:80', // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
      show: false,
      windowSize: '1024x768',
      waitForNavigation: 'domcontentloaded',
      ignoreHTTPSErrors: true,
      chromium: {
        args: [
          '--ignore-certificate-errors',
          '--font-render-hinting=none',
          '--disable-font-subpixel-positioning',
          '--disable-lcd-text',
          '--force-device-scale-factor=1',
          '--force-color-profile=srgb',
          '--use-angle=swiftshader-webgl'
        ]
      }
    },
    VisualHelper: {
      require: '../../../.config/codeceptjs/visual-helper.js',
      baselineDir: './screenshots/base/',
      diffDir: './screenshots/diff/',
      actualDir: './_output/',
      tolerance: 0,
      threshold: 0.1
    },
    REST: {
      endpoint: 'http://gitlab:80' // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    }
  },
  gherkin: {
    // CI shards narrow the run to their slice of feature FILES (one story per
    // file) via TASK_CODECEPTJS_FEATURES — a comma-separated list of paths
    // resolved from project/tests/e2e/shards.json. File-based selection is the
    // shard mechanism because run-workers' pool grep proved unreliable across
    // otherwise identical feature files. Local runs keep the full glob.
    features: process.env.TASK_CODECEPTJS_FEATURES
      ? process.env.TASK_CODECEPTJS_FEATURES.split(',')
      : './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './support/steps/tdd-cycle.js',
      './support/steps/init-baseline.js',
      './support/steps/init-guidance.js',
      './support/steps/glab-auth-ensure.js',
      './support/steps/release-toggle.js',
      './support/steps/quality-gate.js',
      './support/steps/osv-scope.js',
      './support/steps/daily-contribution.js',
      './support/steps/journey.js',
      './support/steps/template-matrix.js',
      './support/steps/update-conflict.js',
      './support/steps/betterleaks.js',
      './support/steps/installer-prereqs.js',
      './support/steps/installer-refusals.js',
      './support/steps/guidance-variants.js',
      './support/steps/init-token-lifecycle.js',
      './support/steps/version-pins.js',
      './support/steps/renovate-detection.js',
      './support/steps/renovate-runtime.js',
      './support/steps/generated-ci.js',
      './support/steps/hybrid-ci.js',
      './support/steps/runner-cleanup.js',
      './support/steps/test-discipline.js',
      './support/steps/source-publication.js',
      './support/steps/publication-contracts.js',
      './support/steps/publication-update.js'
    ]
  },
  plugins: {
    screenshot: { enabled: true },
    // Fills the storyboard header (feature/scenario titles, feature file,
    // re-run command) from each scenario's Gherkin metadata — see the module.
    storyboard: {
      require: '../../../.config/codeceptjs/storyboard.js',
      enabled: true
    },
    // Writes a JUnit XML per worker under _output/junit/ so GitLab renders the
    // MR "Test summary" widget (artifacts:reports:junit). See the module header
    // for why this is a 40-line listener and not mocha-junit-reporter.
    junit: {
      require: './support/junit-reporter.js',
      enabled: true
    }
  },
  // Mocha-level retry: gives one second chance to scenarios that fail because
  // of parallel apt/go install contention (the only known flake source —
  // spawning multiple ubuntu containers simultaneously occasionally races on
  // apt-get lock or Go module mirror rate-limiting). Deterministic visual
  // mismatches will fail both attempts identically, so retry does not hide
  // real regressions.
  mocha: {
    retries: 1
  },
  name: 'e2e'
}
