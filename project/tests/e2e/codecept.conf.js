/**
 * CodeceptJS Configuration — unified E2E suite
 *
 * Single entry point that replaces the former bootstrap/, gitlab/ and template/
 * suites. Each scenario must follow the convention:
 *
 *   Given <realistic environment: ttyd container, GitLab linkage if needed>
 *   When  <user types a command in the terminal>
 *   Then  <terminal output visually matches a baseline>      (xterm shadowDOM capture)
 *   And   <GitLab instance reflects the effect of the command> (UI screenshot or REST assertion)
 *
 * Visual regression is pixel-perfect (tolerance: 0). Chromium flags pin font and
 * color rendering so baselines are reproducible across local and CI runners.
 */

exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js',
    GitLabLoginPage: './pages/GitLabLoginPage.js',
    GitLabUserPage: './pages/GitLabUserPage.js',
    GitLabProjectPage: './pages/GitLabProjectPage.js',
    GitLabAccessTokenPage: './pages/GitLabAccessTokenPage.js'
  },
  helpers: {
    Playwright: {
      browser: 'chromium',
      url: 'http://gitlab:80',
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
      require: '@digital-commons-official/codeceptjs-visual-helper',
      baselineDir: './screenshots/base/',
      diffDir: './screenshots/diff/',
      actualDir: './_output/',
      tolerance: 0,
      threshold: 0.1
    },
    REST: {
      endpoint: 'http://gitlab:80'
    }
  },
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './support/steps/init-baseline.js'
    ]
  },
  plugins: {
    screenshotOnFail: { enabled: true },
    tryTo: { enabled: true }
  },
  name: 'e2e'
}
