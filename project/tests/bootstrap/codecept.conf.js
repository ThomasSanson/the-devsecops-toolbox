exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js'
  },
  helpers: {},
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './step_definitions/unzip_init_steps.js'
    ]
  },
  name: 'bootstrap-e2e'
}
