/* global inject */
const { I } = inject()

class GitLabAccessTokenPage {
  async navigateToAccessTokenSettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/access_tokens`)
    await I.waitForElement('body', 30)
    await I.wait(2)
  }

  async verifyTokenWithMaintainerRole (tokenName) {
    await I.waitForText(tokenName, 10)
    await I.see('Maintainer')
  }

  async verifyVisualRegression () {
    await I.waitForElement('body', 30)
    // GitLab 18: revoked tokens stay visible in an "Inactive" section for 30 days.
    // Remove the entire inactive section from the DOM before taking the screenshot.
    await I.executeScript(() => {
      const inactive = document.querySelector('section#inactive-project-access-tokens')
      if (inactive) inactive.remove()
    })
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_access_token_renovate'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }

  async navigateToCiCdSettings (projectPath) {
    await I.amOnPage(`/${projectPath}/-/settings/ci_cd`)
    await I.waitForElement('body', 30)
    await I.wait(2)
    // Dismiss Docker Hub rate limit banner if present (removed in GitLab 18)
    const dismissBtns = await I.grabNumberOfVisibleElements('.gl-dismiss-btn')
    if (dismissBtns > 0) {
      await I.click('.gl-dismiss-btn')
      await I.wait(1)
    }
    // Expand Variables section
    await I.click('Expand', '#js-cicd-variables-settings')
    await I.wait(2)
  }

  async verifyCiCdVariable (variableName) {
    await I.waitForText(variableName, 10, '#js-cicd-variables-settings')
  }

  async verifyVisualRegressionCiCd () {
    await I.scrollTo('[data-testid="ci-variable-table"]')
    await I.wait(1)
    await I.moveCursorTo('body', 1, 1)

    const screenshotName = 'gitlab_ci_cd_variable_renovate'
    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabAccessTokenPage
