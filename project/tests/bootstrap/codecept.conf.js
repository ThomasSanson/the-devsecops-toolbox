exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js'
  },
  helpers: {
    Playwright: {
      browser: 'chromium',
      url: 'http://127.0.0.1:17681', // DevSkim: ignore DS162092
      show: false,
      windowSize: '1024x768',
      waitForNavigation: 'domcontentloaded',
      chromium: {
        args: [
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
      tolerance: 3,
      threshold: 0.1
    }
  },
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './step_definitions/unzip_init_steps.js',
      './step_definitions/bootstrap_steps.js',
      './step_definitions/ttyd_steps.js'
    ]
  },
  plugins: {
    screenshotOnFail: { enabled: true }
  },
  name: 'bootstrap-e2e'
}
