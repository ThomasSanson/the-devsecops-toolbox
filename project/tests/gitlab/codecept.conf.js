exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js',
    GitLabLoginPage: './pages/GitLabLoginPage.js'
  },
  helpers: {
    Playwright: {
      browser: 'chromium',
      url: 'http://gitlab:80',
      show: false,
      windowSize: '1920x1080',
      waitForNavigation: 'domcontentloaded',
      ignoreHTTPSErrors: true,
      chromium: {
        args: [
          '--ignore-certificate-errors',
          '--font-render-hinting=none',
          '--disable-font-subpixel-positioning',
          '--disable-lcd-text'
        ]
      }
    },
    VisualHelper: {
      require: '@digital-commons-official/codeceptjs-visual-helper',
      baselineDir: './screenshots/base/',
      diffDir: './screenshots/diff/',
      actualDir: './_output/',
      tolerance: 2,
      threshold: 0.1
    }
  },
  hooks: [],
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './step_definitions/page_connexion_gitlab_steps.js'
    ]
  },
  plugins: {
    screenshotOnFail: { enabled: true },
    retryFailedStep: { enabled: true },
    tryTo: { enabled: true },
    pageInfo: {
      enabled: true,
      browserLogs: ['verbose', 'debug', 'info', 'log', 'warning', 'error']
    }
  },
  name: 'gitlab-e2e'
}
