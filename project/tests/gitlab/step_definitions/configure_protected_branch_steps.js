/* global inject When Then */
const { GitLabProtectedBranchPage } = inject()

// ============================================
// WHEN - Protected branch configuration
// ============================================

When('the branch {string} is protected for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabProtectedBranchPage.protectBranchViaApi(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    `${lambdaUser}/${projectName}`,
    branch
  )
})

// ============================================
// THEN - Protected branch verification (includes visual regression)
// ============================================

Then('the repository settings show {string} as protected for {string}', async (branch, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabProtectedBranchPage.navigateToRepositorySettings(`${lambdaUser}/${projectName}`)
  await GitLabProtectedBranchPage.verifyProtectedBranch(branch)
  await GitLabProtectedBranchPage.verifyVisualRegression()
})
