exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js',
    Admin: './actors/Admin.js',
    ApplicationLoginPage: './pages/LoginPage.js',
    ApplicationHomePage: './pages/HomePage.js'
  },
  helpers: {
    Playwright: {
      browser: 'chromium',
      url: process.env.CODECEPTJS_BASE_URL,
      show: false,
      windowSize: '1920x1080',
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
    }
  },
  hooks: [],
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './step_definitions/application_steps.js'
    ]
  },
  plugins: {
    screenshotOnFail: { enabled: true },
    retryFailedStep: { enabled: true },
    tryTo: { enabled: true },
    // ONE Gherkin sentence = ONE storyboard card = ONE pixel baseline: fills
    // the storyboard header from each scenario's metadata and renders the SVG
    // when the test ends — see .config/codeceptjs/storyboard.js.
    storyboard: {
      require: '../../../.config/codeceptjs/storyboard.js',
      enabled: true
    },
    pageInfo: {
      enabled: true,
      browserLogs: ["verbose", "debug", "info", "log", "warning", "error"]
    }
  },
  name: 'application-e2e'
}
