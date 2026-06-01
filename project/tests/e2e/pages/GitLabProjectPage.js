/* global inject */
const { I } = inject()

class GitLabProjectPage {
  constructor () {
    this.urls = {
      newProject: '/projects/new'
    }
  }

  async deleteProjectIfExists (baseUrl, rootUser, rootPassword, projectPath) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    const encodedPath = encodeURIComponent(projectPath)
    const response = await I.sendGetRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}`,
      headers
    )

    if (response.status === 200 && response.data && response.data.id) {
      await I.sendDeleteRequest(
        `${baseUrl}/api/v4/projects/${response.data.id}`,
        headers
      )
      // Wait for deletion to propagate
      await I.wait(2)
    }
  }

  async createBlankPublicProject (projectName) {
    await I.amOnPage(this.urls.newProject)
    await I.wait(2)

    await I.waitForText('Create blank project', 10)
    await I.click('Create blank project')

    await I.waitForElement('#project_name', 10)
    await I.fillField('#project_name', projectName)

    // GitLab 18: select namespace explicitly (no longer defaults to user namespace)
    await I.click('[data-testid="select-namespace-dropdown"] [data-testid="base-dropdown-toggle"]')
    await I.waitForElement('[role="listbox"]', 5)
    // Select the first available namespace (the user's own namespace)
    await I.click('[role="listbox"] [role="option"]')

    // Select Public visibility
    await I.waitForElement('#project_visibility_level_20', 5)
    await I.checkOption('#project_visibility_level_20')

    await I.click('Create project')
    await I.wait(3)
  }

  async verifyProjectCreated (projectName) {
    await I.waitForText(projectName, 30, '[data-testid="project-name-content"]')
    await I.dontSeeInCurrentUrl('/projects/new')
  }

  async verifyVisualRegression (projectName) {
    await I.waitForElement('body', 30)

    await I.moveCursorTo('body', 1, 1)

    const screenshotName = `gitlab_project_${projectName}`
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabProjectPage
