/* global inject */
const { I } = inject()

class GitLabUserPage {
  constructor () {
    this.urls = {
      login: '/users/sign_in'
    }
  }

  async ensureUserViaApi (baseUrl, rootUser, rootPassword, userData) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    // Check if user already exists
    const existingUsers = await I.sendGetRequest(
      `${baseUrl}/api/v4/users?username=${userData.username}`,
      headers
    )

    if (existingUsers.data && existingUsers.data.length > 0) {
      // User exists — update password to ensure we can login
      await I.sendPutRequest(
        `${baseUrl}/api/v4/users/${existingUsers.data[0].id}`,
        { password: userData.password },
        headers
      )
      return
    }

    // User does not exist — create
    const response = await I.sendPostRequest(
      `${baseUrl}/api/v4/users`,
      {
        email: userData.email,
        username: userData.username,
        name: userData.name,
        password: userData.password,
        skip_confirmation: true,
        force_random_password: false
      },
      headers
    )

    if (response.status !== 201) {
      throw new Error(`Failed to create user: ${response.status} ${JSON.stringify(response.data)}`)
    }
  }

  loginAs (username, password) {
    I.amOnPage(this.urls.login)
    I.fillField('#user_login', username)
    I.fillField('#user_password', password)
    I.click('.js-sign-in-button')
  }

  verifyHomepage () {
    I.waitForElement('body', 30)
    I.dontSeeInCurrentUrl('/sign_in')
  }

  verifyVisualRegression () {
    I.waitForElement('body', 30)

    I.moveCursorTo('body', 1, 1)

    I.takeScreenshot('gitlab_lambda_homepage')
    I.assertVisualMatch('gitlab_lambda_homepage')
  }
}

module.exports = GitLabUserPage
