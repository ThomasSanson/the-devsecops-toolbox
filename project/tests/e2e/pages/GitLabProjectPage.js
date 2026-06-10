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
    // GitLab 18 deletes projects in two steps: DELETE marks the project for
    // deletion and immediately renames its path to <name>-deletion_scheduled-<id>,
    // freeing the original path — but it keeps a redirect from the old path, so
    // a GET on the original path can still return 200 with the RENAMED project.
    // "The path is free" therefore means: 404, or a (redirect-followed) payload
    // whose path_with_namespace is no longer the requested path.
    const pathIsFree = (response) =>
      response.status !== 200 ||
      !response.data ||
      !response.data.id ||
      response.data.path_with_namespace !== projectPath

    const existing = await I.sendGetRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}`,
      headers
    )
    if (pathIsFree(existing)) return

    await I.sendDeleteRequest(
      `${baseUrl}/api/v4/projects/${existing.data.id}`,
      headers
    )
    // The rename is quick but asynchronous: poll until the path frees so an
    // immediate re-create (mocha retry, rapid TDD rerun) cannot hit
    // "name has already been taken".
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const probe = await I.sendGetRequest(
        `${baseUrl}/api/v4/projects/${encodedPath}`,
        headers
      )
      if (pathIsFree(probe)) return
      await I.wait(2)
    }
    throw new Error(`Project "${projectPath}" still occupied its path 60s after deletion was requested`)
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
}

module.exports = GitLabProjectPage
