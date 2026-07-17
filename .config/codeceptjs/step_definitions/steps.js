const { I } = inject();
// Add in your custom step files

// Your first storyboard — ONE Gherkin sentence = ONE card = ONE pixel
// baseline, and the scenario renders itself as a copyable SVG under
// storyboards/. Uncomment, adapt the sentences, run once with
// TASK_E2E_UPDATE_BASELINES=1 to create the baselines, inspect them, done.
// (Register the `storyboard` plugin in codecept.conf.js — see
// codecept.conf.sample.js — and tag the scenario: its LAST tag becomes the
// replay command printed on the board.)
//
// const storyboard = require('../storyboard')
//
// storyboard.storyboardStep(Given, 'a visitor lands on the home page', {
//   note: 'The stage: what the page looks like before anything happens.',
//   copy: 'https://your-app.example/'
// }, async () => {
//   await I.amOnPage('/')
//   await storyboard.addStoryboardFrame(I, await storyboard.capturePageFrame(I, 'home'))
// })
