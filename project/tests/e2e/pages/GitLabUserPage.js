/* global inject */
const { I } = inject()
const { getRootHeaders } = require('../support/helpers/gitlabApi')

class GitLabUserPage {
  constructor () {
    this.urls = {
      login: '/users/sign_in'
    }
  }

  // rootUser / rootPassword are still in the signature for the callers, but the
  // API no longer takes them: GitLab 19 removed the OAuth password grant this
  // used to trade them for a token. Admin auth now comes from getRootHeaders().
  async ensureUserViaApi (baseUrl, rootUser, rootPassword, userData) {
    // The test GitLab transiently answers 5xx under CI load (4-vCPU runner
    // shared with Chromium workers and scenario containers), so the whole
    // ensure flow retries: each attempt re-checks existence first, which also
    // makes a created-despite-500 first attempt converge.
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers = await getRootHeaders()

        const existingUsers = await I.sendGetRequest(
          `${baseUrl}/api/v4/users?username=${userData.username}`,
          headers
        )
        if (existingUsers.data && existingUsers.data.length > 0) {
          return
        }

        const response = await I.sendPostRequest(
          `${baseUrl}/api/v4/users`,
          {
            email: userData.email,
            username: userData.username,
            name: userData.name,
            password: userData.password,
            skip_confirmation: true,
            force_random_password: false,
            reset_password: false
          },
          headers
        )
        if (response.status === 201) {
          return
        }
        lastError = new Error(`Failed to create user: ${response.status} ${JSON.stringify(response.data)}`)
        if (response.status < 500) throw lastError
      } catch (error) {
        lastError = error
      }
      await I.wait(10)
    }
    throw lastError
  }

  async loginAs (username, password) {
    // A shard can open with a scenario whose FIRST GitLab contact is this UI
    // login: on that shard's virgin instance the lambda user does not exist
    // yet (the monolithic suite hid the dependency behind whichever install
    // scenario ran first). Ensure it via the admin API — one existence check
    // when the user is already there — so no scenario depends on run order.
    if (username === process.env.TASK_GITLAB_LAMBDA_USER) {
      await this.ensureUserViaApi(
        'http://gitlab:80', // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
        process.env.TASK_GITLAB_ROOT_USER,
        process.env.TASK_GITLAB_ROOT_PASSWORD,
        {
          email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
          username: process.env.TASK_GITLAB_LAMBDA_USER,
          name: 'Lambda User',
          password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
        }
      )
    }
    await I.amOnPage(this.urls.login)
    await I.waitForElement('#user_login', 60)
    await I.fillField('#user_login', username)
    await I.fillField('#user_password', password)
    await I.click('[data-testid="sign-in-button"]')
    await I.wait(3)
    const url = await I.grabCurrentUrl()
    if (url.includes('password/new') || url.includes('user_settings/password')) {
      // GitLab forced password change — use label-based selectors
      const newPassword = password + '!'
      await I.fillField('Current password', password)
      await I.fillField('New password', newPassword)
      await I.fillField('Confirm password', newPassword)
      await I.click('Update password')
      await I.wait(3)

      // After password update GitLab redirects to sign_in
      const newUrl = await I.grabCurrentUrl()
      if (newUrl.includes('sign_in')) {
        await I.waitForElement('#user_login', 60)
        await I.fillField('#user_login', username)
        await I.fillField('#user_password', newPassword)
        await I.click('[data-testid="sign-in-button"]')
        await I.wait(3)
      }
    }
  }
}

module.exports = GitLabUserPage
