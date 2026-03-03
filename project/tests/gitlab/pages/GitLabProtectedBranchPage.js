/* global inject */
const { I } = inject()

class GitLabProtectedBranchPage {
  async protectBranchViaApi (baseUrl, rootUser, rootPassword, projectPath, branch) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    const encodedPath = encodeURIComponent(projectPath)

    // Unprotect the branch first if already protected (idempotency)
    await I.sendDeleteRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}/protected_branches/${branch}`,
      headers
    )

    // Protect the branch with strict rules
    const response = await I.sendPostRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}/protected_branches`,
      {
        name: branch,
        merge_access_level: 40,
        push_access_level: 0,
        allow_force_push: false
      },
      headers
    )

    if (response.status !== 201) {
      throw new Error(`Failed to protect branch: ${response.status} ${JSON.stringify(response.data)}`)
    }
  }

  async navigateToRepositorySettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/repository`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async verifyProtectedBranch (branch) {
    await I.waitForText('Protected branches', 10)

    // Scroll to and expand the "Protected branches" section
    await I.executeScript(() => {
      // Find the header with text "Protected branches" and get its closest section
      const headers = Array.from(document.querySelectorAll('h2, h3, h4, span'))
      const target = headers.find(el => el.textContent.trim() === 'Protected branches')
      if (target) {
        const section = target.closest('section') || target.closest('div[id*="protected-branches"]')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        } else {
          target.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      } else {
        // Fallback
        const section = document.querySelector('#js-protected-branches-settings') || document.querySelector('#protected-branches-settings')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      }
    })
    await I.wait(2)
    await I.see(branch)
  }

  async verifyVisualRegression () {
    // Scroll to the Protected branches section for the screenshot
    await I.executeScript(() => {
      // Find the header with text "Protected branches" and get its closest section
      const headers = Array.from(document.querySelectorAll('h2, h3, h4, span'))
      const target = headers.find(el => el.textContent.trim() === 'Protected branches')
      if (target) {
        const section = target.closest('section') || target.closest('div[id*="protected-branches"]')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        } else {
          target.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      } else {
        // Fallback
        const section = document.querySelector('#js-protected-branches-settings') || document.querySelector('#protected-branches-settings')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      }
    })
    await I.wait(2)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_repository_settings_protected_branch'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabProtectedBranchPage
