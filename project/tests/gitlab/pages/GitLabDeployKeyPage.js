/* global inject */
const { I } = inject()

class GitLabDeployKeyPage {
  async navigateToRepositorySettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/repository`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async verifyDeployKeyViaApi (baseUrl, rootUser, rootPassword, projectPath, keyTitle) {
    const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
      grant_type: 'password',
      username: rootUser,
      password: rootPassword
    })
    const accessToken = tokenResponse.data.access_token
    const headers = { Authorization: `Bearer ${accessToken}` }

    const encodedPath = encodeURIComponent(projectPath)
    const keysResponse = await I.sendGetRequest(
      `${baseUrl}/api/v4/projects/${encodedPath}/deploy_keys`, headers
    )

    const matchingKey = keysResponse.data.find(k => k.title === keyTitle)
    if (!matchingKey) {
      throw new Error(`Deploy key '${keyTitle}' not found for project '${projectPath}'`)
    }
    if (!matchingKey.can_push) {
      throw new Error(`Deploy key '${keyTitle}' does not have write access (can_push=${matchingKey.can_push})`)
    }
  }

  async verifyDeployKey (keyTitle) {
    await I.waitForText('Deploy keys', 10)

    // Scroll to and expand the "Deploy keys" section
    await I.executeScript(() => {
      const headers = Array.from(document.querySelectorAll('h2, h3, h4, span'))
      const target = headers.find(el => el.textContent.trim() === 'Deploy keys')
      if (target) {
        const section = target.closest('section') || target.closest('div[id*="deploy-keys"]')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        } else {
          target.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      } else {
        const section = document.querySelector('#js-deploy-keys-settings') || document.querySelector('#deploy-keys-settings')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      }
    })
    await I.wait(2)
    await I.see(keyTitle)
  }

  async verifyVisualRegression () {
    // Scroll to the Deploy keys section for the screenshot
    await I.executeScript(() => {
      const headers = Array.from(document.querySelectorAll('h2, h3, h4, span'))
      const target = headers.find(el => el.textContent.trim() === 'Deploy keys')
      if (target) {
        const section = target.closest('section') || target.closest('div[id*="deploy-keys"]')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        } else {
          target.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      } else {
        const section = document.querySelector('#js-deploy-keys-settings') || document.querySelector('#deploy-keys-settings')
        if (section) {
          section.classList.add('expanded')
          section.scrollIntoView({ behavior: 'instant', block: 'start' })
        }
      }
    })
    await I.wait(2)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_repository_settings_deploy_key'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }

  async navigateToCiCdSettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/ci_cd`)
    await I.waitForElement('body', 30)
    await I.wait(2)
    // Expand Variables section
    await I.click('Expand', '#js-cicd-variables-settings')
    await I.wait(2)
  }

  async verifyCiCdVariable (variableName) {
    await I.waitForText(variableName, 10, '#js-cicd-variables-settings')
  }

  async verifyVisualRegressionCiCd () {
    await I.waitForElement('body', 30)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_ci_cd_variable_deploy_key'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabDeployKeyPage
