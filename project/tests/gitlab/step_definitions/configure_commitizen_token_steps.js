/* global inject Given When Then */
const { GitLabAccessTokenPage } = inject()
const { freshGet, freshPost } = require('../helpers/http')

Then('a Commitizen token {string} must exist with Maintainer role for {string}', async (tokenName, projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const projectPath = `${lambdaUser}/${projectName}`
  const encodedPath = encodeURIComponent(projectPath)
  const baseUrl = 'http://gitlab:80'

  const tokenResponse = await freshPost(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const tokensResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`, headers
  )
  const matchingToken = tokensResponse.data.find(t => t.name === tokenName && t.active && !t.revoked)

  if (!matchingToken) {
    throw new Error(`Commitizen token '${tokenName}' not found for project '${projectPath}'`)
  }
  if (matchingToken.access_level < 40) {
    throw new Error(`Commitizen token '${tokenName}' has access_level=${matchingToken.access_level}, expected >= 40`)
  }

  await GitLabAccessTokenPage.navigateToAccessTokenSettings(projectPath)
  await GitLabAccessTokenPage.verifyTokenWithMaintainerRole(tokenName)
})

Then('the Commitizen token must be present in the project CI\\/CD variables for {string}', async (projectName) => {
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const projectPath = `${lambdaUser}/${projectName}`
  const encodedPath = encodeURIComponent(projectPath)
  const baseUrl = 'http://gitlab:80'

  const tokenResponse = await freshPost(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  const headers = { Authorization: `Bearer ${tokenResponse.data.access_token}` }

  const varResponse = await freshGet(
    `${baseUrl}/api/v4/projects/${encodedPath}/variables/TASK_COMMITIZEN_TOKEN`, headers
  )
  if (!varResponse.data || !varResponse.data.key) {
    throw new Error(`CI/CD variable 'TASK_COMMITIZEN_TOKEN' not found for project '${projectPath}'`)
  }

  await GitLabAccessTokenPage.navigateToCiCdSettings(projectPath)
  await GitLabAccessTokenPage.verifyCiCdVariable('TASK_COMMITIZEN_TOKEN')
})

When('the Commitizen access token {string} is revoked from project {string}', async (tokenName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const tokensResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`, headers
  )

  for (const token of tokensResponse.data) {
    if (token.name === tokenName && token.active && !token.revoked) {
      await I.sendDeleteRequest(
        `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens/${token.id}`, headers
      )
    }
  }
})

Given('a duplicate Commitizen token {string} is created for project {string}', async (tokenName, projectName) => {
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  await I.sendPostRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`,
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
  const baseUrl = 'http://gitlab:80'
  const rootUser = process.env.TASK_GITLAB_ROOT_USER
  const rootPassword = process.env.TASK_GITLAB_ROOT_PASSWORD
  const lambdaUser = process.env.TASK_GITLAB_LAMBDA_USER
  const I = inject().I

  const tokenResponse = await I.sendPostRequest(`${baseUrl}/oauth/token`, {
    grant_type: 'password',
    username: rootUser,
    password: rootPassword
  })
  const rootToken = tokenResponse.data.access_token
  const headers = { Authorization: `Bearer ${rootToken}` }

  const encodedPath = encodeURIComponent(`${lambdaUser}/${projectName}`)
  const tokensResponse = await I.sendGetRequest(
    `${baseUrl}/api/v4/projects/${encodedPath}/access_tokens`, headers
  )

  const activeTokens = tokensResponse.data.filter(
    t => t.name === tokenName && t.active && !t.revoked
  )
  if (activeTokens.length !== 1) {
    throw new Error(`Expected exactly 1 active Commitizen token named '${tokenName}', found ${activeTokens.length}`)
  }
})
