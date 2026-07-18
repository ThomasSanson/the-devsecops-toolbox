/* global inject */
const { I } = inject()
const { assertPageVisualMatch } = require('../support/helpers/pageVisual')

// GitLab 18: revoked tokens stay visible in an "Inactive" section for 30 days.
// Remove that section before the screenshot, neutralise dynamic dates
// ("Created: May 06, 2026", "Expires: in 2 months", "2026-08-04") and hide the
// top app bar (its global To-Do / MR / Issue counters vary across runs) so the
// baseline is reproducible.
async function maskAccessTokens () {
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

    ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
      const n = document.querySelector(sel)
      if (n) n.style.visibility = 'hidden'
    })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
  })
  await I.moveCursorTo('body', 1, 1)
}

async function maskCiCd () {
  await I.executeScript(() => {
    ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
      const n = document.querySelector(sel)
      if (n) n.style.visibility = 'hidden'
    })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
  })
  await I.moveCursorTo('body', 1, 1)
}

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

  // Navigate + mask WITHOUT asserting — the storyboard step captures a masked
  // frame and asserts it against its own per-scenario baseline.
  async gotoAccessTokensAndMask (projectPath) {
    await this.navigateToAccessTokenSettings(projectPath)
    await I.waitForElement('body', 30)
    await maskAccessTokens()
  }

  async verifyVisualRegression (screenshotName) {
    await I.waitForElement('body', 30)
    await maskAccessTokens()
    await assertPageVisualMatch(I, screenshotName)
  }

  async gotoCiCdAndMask (projectPath) {
    await this.navigateToCiCdSettings(projectPath)
    await I.scrollTo('[data-testid="ci-variable-table"]')
    await I.wait(1)
    await maskCiCd()
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
    await maskCiCd()
    await assertPageVisualMatch(I, screenshotName)
  }
}

module.exports = GitLabAccessTokenPage
