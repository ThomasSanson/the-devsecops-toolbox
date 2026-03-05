/* global inject Given When Then */
const { GitLabAccessTokenPage } = inject()
const {
  projectPath,
  getRootHeaders,
  readProjectVariable,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken
} = require('../helpers/gitlabApi')

Then('a Commitizen token {string} must exist with Maintainer role for {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`Commitizen token '${tokenName}' not found for project '${projectPath(projectName)}'`)
  }
  if (matchingToken.access_level < 40) {
    throw new Error(`Commitizen token '${tokenName}' has access_level=${matchingToken.access_level}, expected >= 40`)
  }

  await GitLabAccessTokenPage.navigateToAccessTokenSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole(tokenName)
})

Then('the Commitizen token must be present in the project CI\\/CD variables for {string}', async (projectName) => {
  const headers = await getRootHeaders()
  const variableResponse = await readProjectVariable(projectName, 'TASK_COMMITIZEN_TOKEN', headers)
  if (!variableResponse.data || !variableResponse.data.key) {
    throw new Error(`CI/CD variable 'TASK_COMMITIZEN_TOKEN' not found for project '${projectPath(projectName)}'`)
  }

  await GitLabAccessTokenPage.navigateToCiCdSettings(projectPath(projectName))
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_COMMITIZEN_TOKEN')
})

When('the Commitizen access token {string} is revoked from project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)

  for (const token of tokensResponse.data) {
    if (token.name === tokenName && token.active && !token.revoked) {
      await revokeProjectAccessToken(projectName, token.id, headers)
    }
  }
})

Given('a duplicate Commitizen token {string} is created for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  await createProjectAccessToken(
    projectName,
    {
      name: tokenName,
      scopes: ['api', 'write_repository'],
      access_level: 40,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    },
    headers
  )
})

Then('only one active Commitizen token named {string} must exist for {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const tokensResponse = await listProjectAccessTokens(projectName, headers)
  const activeTokens = tokensResponse.data.filter(
    t => t.name === tokenName && t.active && !t.revoked
  )

  if (activeTokens.length !== 1) {
    throw new Error(`Expected exactly 1 active Commitizen token named '${tokenName}', found ${activeTokens.length}`)
  }
})
