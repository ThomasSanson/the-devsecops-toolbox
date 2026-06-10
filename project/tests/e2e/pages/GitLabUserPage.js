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
      // User already exists — skip creation
      return
    }

    // Create user
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

    if (response.status !== 201) {
      throw new Error(`Failed to create user: ${response.status} ${JSON.stringify(response.data)}`)
    }
  }

  async loginAs (username, password) {
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
