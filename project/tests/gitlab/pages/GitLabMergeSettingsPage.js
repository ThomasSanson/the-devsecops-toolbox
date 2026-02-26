/* global inject */
const { I } = inject()

class GitLabMergeSettingsPage {
  async setMergeMethodViaApi (baseUrl, rootUser, rootPassword, projectPath) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    const encodedPath = encodeURIComponent(projectPath)
    const response = await I.sendPutRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}`,
      { merge_method: 'ff' },
      headers
    )

    if (response.status !== 200) {
      throw new Error(`Failed to set merge method: ${response.status} ${JSON.stringify(response.data)}`)
    }
  }

  async navigateToMergeSettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/merge_requests`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async verifyFastForwardEnabled () {
    await I.waitForText('Merge method', 10)
    await I.seeCheckboxIsChecked('input[value="ff"]')
  }

  async verifyVisualRegression () {
    await I.waitForElement('body', 30)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_merge_settings_fast_forward'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabMergeSettingsPage
