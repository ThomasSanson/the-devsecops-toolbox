/* global inject */
const { I } = inject()

class GitLabDeployKeyPage {
  async navigateToRepositorySettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/repository`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async _scrollToDeployKeysSection () {
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
  }

  async verifyDeployKey (keyTitle) {
    await I.waitForText('Deploy keys', 10)
    await this._scrollToDeployKeysSection()
    await I.see(keyTitle)
  }

  async verifyVisualRegression () {
    await this._scrollToDeployKeysSection()
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
