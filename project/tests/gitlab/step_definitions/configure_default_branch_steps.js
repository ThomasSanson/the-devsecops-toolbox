/* global inject When Then */
const { GitLabRepositorySettingsPage } = inject()

// ============================================
// WHEN - Default branch configuration
// ============================================

When('the default branch is set to {string} for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabRepositorySettingsPage.setDefaultBranchViaApi(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    `${lambdaUser}/${projectName}`,
    branch
  )
})

// ============================================
// THEN - Default branch verification (includes visual regression)
// ============================================

Then('the repository settings show {string} as the default branch for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabRepositorySettingsPage.navigateToRepositorySettings(`${lambdaUser}/${projectName}`)
  await GitLabRepositorySettingsPage.verifyDefaultBranch(branch)
  await GitLabRepositorySettingsPage.verifyVisualRegression()
})
