/* global inject Given When Then */
const { GitLabProjectPage } = inject()

Given('the test project is deleted if it exists', async () => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  await GitLabProjectPage.deleteProjectIfExists(
    'http://gitlab:80',
    process.env.TASK_GITLAB_ROOT_USER,
    process.env.TASK_GITLAB_ROOT_PASSWORD,
    `${lambdaUser}/public-test-project`
  )
})

When('I create a new public test project', async () => {
  await GitLabProjectPage.createBlankPublicProject('public-test-project')
})

Then('the new public project page is displayed', async () => {
  await GitLabProjectPage.verifyProjectCreated('public-test-project')
})

Then('the new public project page matches the visual reference', async () => {
  await GitLabProjectPage.verifyVisualRegression('public-test-project')
})
