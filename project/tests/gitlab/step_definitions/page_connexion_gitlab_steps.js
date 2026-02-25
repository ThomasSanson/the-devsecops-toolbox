/* global inject When Then */
const { GitLabLoginPage } = inject()

// ============================================
// WHEN - GitLab login actions
// ============================================

When('I log in to GitLab with root credentials', () => {
  GitLabLoginPage.navigateTo()
  GitLabLoginPage.login(process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD)
})

// ============================================
// THEN - GitLab login verifications
// ============================================

Then('the GitLab dashboard is displayed', () => {
  GitLabLoginPage.verifyDashboard()
})

Then('the GitLab dashboard page matches the visual reference', () => {
  GitLabLoginPage.verifyVisualRegression()
})
