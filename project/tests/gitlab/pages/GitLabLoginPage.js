/* global inject */
const { I } = inject()

class GitLabLoginPage {
  constructor () {
    this.urls = {
      login: '/users/sign_in'
    }
  }

  navigateTo () {
    I.amOnPage(this.urls.login)
  }

  login (user, password) {
    I.fillField('#user_login', user)
    I.fillField('#user_password', password)
    I.click('.js-sign-in-button')
  }

  verifyDashboard () {
    I.waitForElement('body', 30)
    I.dontSeeInCurrentUrl('/sign_in')
  }

  verifyVisualRegression () {
    I.waitForElement('body', 30)

    I.moveCursorTo('body', 1, 1)

    I.takeScreenshot('gitlab_dashboard')
    I.assertVisualMatch('gitlab_dashboard')
  }
}

module.exports = GitLabLoginPage
