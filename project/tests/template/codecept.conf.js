/**
 * CodeceptJS Configuration
 *
 * Root configuration file that loads all domain features and steps.
 * Organized by Domain-Driven Design principles.
 */

exports.config = {
  output: './_output',
  include: {
    I: '../../../.config/codeceptjs/steps_file.js'
  },
  gherkin: {
    features: './features/**/*.feature',
    steps: [
      '../../../.config/codeceptjs/step_definitions/steps.js',
      './entrypoint.js',
      // Step objects with Gherkin definitions
      './step_objects/copier.js',
      './step_objects/content.js',
      // Domain steps
      './steps/ansible.js',
      './steps/commitizen.js',
      './steps/devsecops.js',
      './steps/docker.js',
      './steps/gitlab.js',
      './steps/glab.js',
      './steps/podman.js',
      './steps/renovate.js',
      './steps/system.js',
      './steps/taskfile.js'
    ]
  },
  name: 'devsecops-toolbox-tests'
}
