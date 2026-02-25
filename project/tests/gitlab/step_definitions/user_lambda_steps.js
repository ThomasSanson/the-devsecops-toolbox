/* global inject Given When Then */
const { GitLabUserPage } = inject()

// ============================================
// GIVEN - GitLab user setup
// ============================================

Given('a lambda user is created via the GitLab API', async () => {
  await GitLabUserPage.ensureUserViaApi(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    {
      email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
      username: process.env.TASK_GITLAB_LAMBDA_USER,
      name: 'Lambda User',
      password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
    }
  )
})

// ============================================
// WHEN - GitLab lambda user actions
// ============================================

When('I log in to GitLab as the lambda user', () => {
  GitLabUserPage.loginAs(
    process.env.TASK_GITLAB_LAMBDA_USER,
    process.env.TASK_GITLAB_LAMBDA_PASSWORD
  )
})

// ============================================
// THEN - GitLab lambda user verifications
// ============================================

Then('the GitLab homepage is displayed', () => {
  GitLabUserPage.verifyHomepage()
})

Then('the GitLab lambda user homepage matches the visual reference', () => {
  GitLabUserPage.verifyVisualRegression()
})
