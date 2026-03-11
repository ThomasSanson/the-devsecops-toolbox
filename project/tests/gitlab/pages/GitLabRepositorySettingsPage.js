/* global inject */
const { I } = inject()

class GitLabRepositorySettingsPage {
  async setDefaultBranchViaApi (baseUrl, rootUser, rootPassword, projectPath, branch) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    const encodedPath = encodeURIComponent(projectPath)

    // Ensure the branch exists by creating an initial commit if needed
    const branchCheck = await I.sendGetRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}/repository/branches/${branch}`,
      headers
    )
    if (branchCheck.status !== 200) {
      await I.sendPostRequest(
        `${baseUrl}/api/v4/projects/${encodedPath}/repository/files/README.md`,
        {
          branch,
          content: '# Project\n',
          commit_message: 'Initial commit'
        },
        headers
      )
      await I.wait(1)
    }

    const response = await I.sendPutRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}`,
      { default_branch: branch },
      headers
    )

    if (response.status !== 200) {
      throw new Error(`Failed to set default branch: ${response.status} ${JSON.stringify(response.data)}`)
    }
  }

  async navigateToRepositorySettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/repository`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async verifyDefaultBranch (branch) {
    await I.waitForText('Branch defaults', 10)
    // Expand the "Branch defaults" section
    await I.executeScript(() => {
      const section = document.querySelector('#branch-defaults-settings')
      if (section) {
        section.classList.add('expanded')
      }
    })
    await I.wait(2)
    await I.see(branch)
  }

  async verifyVisualRegression () {
    await I.waitForElement('body', 30)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_repository_settings_default_branch'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabRepositorySettingsPage
