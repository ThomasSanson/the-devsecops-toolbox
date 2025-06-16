exports.config = {
  include: {
    I: '../../../../../.config/codeceptjs/steps_file.js'
  },
  hooks: [],
  gherkin: {
    features: '../../features/**/*.feature',
    steps: [
      '../../../../../.config/codeceptjs/step_definitions/steps.js',
      './step_definitions/entrypoint.js'
    ]
  },
  name: 'plugin'
}
