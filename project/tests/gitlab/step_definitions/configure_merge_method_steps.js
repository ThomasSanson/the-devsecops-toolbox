/* global inject Given When Then */
const { GitLabUserPage, GitLabProjectPage, GitLabMergeSettingsPage } = inject()

// ============================================
// GIVEN - Lambda user with a fresh project
// ============================================

Given('a lambda user with a fresh project {string}', async (projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER

  // Ensure lambda user exists
  await GitLabUserPage.ensureUserViaApi(baseUrl, rootUser, rootPassword, {
    email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
    username: lambdaUser,
    name: 'Lambda User',
    password: process.env.TASK_GITLAB_LAMBDA_PASSWORD
  })

  // Delete project if exists
  await GitLabProjectPage.deleteProjectIfExists(
    baseUrl, rootUser, rootPassword, `${lambdaUser}/${projectName}`
  )

  // Login as lambda user
  await GitLabUserPage.loginAs(lambdaUser, process.env.TASK_GITLAB_LAMBDA_PASSWORD)

  // Create fresh project
  await GitLabProjectPage.createBlankPublicProject(projectName)
})

// ============================================
// WHEN - Merge method configuration
// ============================================

When('the merge method is set to fast-forward for {string}', async (projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabMergeSettingsPage.setMergeMethodViaApi(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    `${lambdaUser}/${projectName}`
  )
})

// ============================================
// THEN - Merge method verification (includes visual regression)
// ============================================

Then('the merge request settings show fast-forward merge for {string}', async (projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabMergeSettingsPage.navigateToMergeSettings(`${lambdaUser}/${projectName}`)
  await GitLabMergeSettingsPage.verifyFastForwardEnabled()
  await GitLabMergeSettingsPage.verifyVisualRegression()
})
