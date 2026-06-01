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

  async verifyVisualRegression (screenshotName) {
    await I.waitForElement('body', 30)
    // GitLab 18: revoked tokens stay visible in an "Inactive" section for 30 days.
    // Remove the entire inactive section from the DOM before taking the screenshot.
    // Also neutralise dynamic dates ("Created: May 06, 2026", "Expires: in 2
    // months", "2026-08-04") so the baseline is reproducible across days.
    await I.executeScript(() => {
      const inactive = document.querySelector('section#inactive-project-access-tokens')
      if (inactive) inactive.remove()

      const DATE_PATTERNS = [
        /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/, // "May 06, 2026"
        /^\d{4}-\d{2}-\d{2}$/, //                "2026-08-04"
        /^in \d+ (second|minute|hour|day|week|month|year)s?$/, // "in 2 months"
        /^\d+ (second|minute|hour|day|week|month|year)s? ago$/ //  "3 days ago"
      ]
      const PLACEHOLDER = '—'
      document.querySelectorAll('td, th, dd, dt, span, div, p, time').forEach(el => {
        if (el.children.length === 0) {
          const text = el.textContent.trim()
          if (DATE_PATTERNS.some(re => re.test(text))) el.textContent = PLACEHOLDER
        }
      })
    })
    await I.moveCursorTo('body', 1, 1)

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

  async verifyVisualRegressionCiCd (screenshotName) {
    await I.scrollTo('[data-testid="ci-variable-table"]')
    await I.wait(1)
    await I.moveCursorTo('body', 1, 1)

    await I.takeScreenshot(screenshotName)
    await I.assertVisualMatch(screenshotName)
  }
}

module.exports = GitLabAccessTokenPage
