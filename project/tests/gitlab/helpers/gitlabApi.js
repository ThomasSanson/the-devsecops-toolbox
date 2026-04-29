const { freshGet, freshPost, freshPut, freshDelete } = require('./http')

const BASE_URL = 'http://gitlab:80'

function getLambdaUsername () {
  return process.env.TASK_GITLAB_LAMBDA_USER
}

function projectPath (projectName) {
  return `${getLambdaUsername()}/${projectName}`
}

function encodedProjectPath (projectName) {
  return encodeURIComponent(projectPath(projectName))
}

async function getRootHeaders () {
  const tokenResponse = await freshPost(`${BASE_URL}/oauth/token`, {
    grant_type: 'password',
    username: process.env.TASK_GITLAB_ROOT_USER,
    password: process.env.TASK_GITLAB_ROOT_PASSWORD
  })
  return { Authorization: `Bearer ${tokenResponse.data.access_token}` }
}

async function getLambdaUserId (headers) {
  const usersResponse = await freshGet(
    `${BASE_URL}/api/v4/users?username=${getLambdaUsername()}`,
    headers
  )
  return usersResponse.data[0].id
}

async function createLambdaPersonalAccessToken (tokenName, scopes = ['api', 'write_repository'], headers) {
  const userId = await getLambdaUserId(headers)
  const tokenResponse = await freshPost(
    `${BASE_URL}/api/v4/users/${userId}/personal_access_tokens`,
    { name: tokenName, scopes },
    headers
  )
  return tokenResponse.data.token
}

async function readProjectVariable (projectName, variableName, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables/${variableName}`,
    headers
  )
}

async function updateProjectVariable (projectName, variableName, payload, headers) {
  return freshPut(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables/${variableName}`,
    payload,
    headers
  )
}

async function listProjectAccessTokens (projectName, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/access_tokens`,
    headers
  )
}

async function createProjectAccessToken (projectName, payload, headers) {
  return freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/access_tokens`,
    payload,
    headers
  )
}

async function revokeProjectAccessToken (projectName, tokenId, headers) {
  return freshDelete(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/access_tokens/${tokenId}`,
    headers
  )
}

async function rotateProjectAccessToken (projectName, tokenId, headers) {
  return freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/access_tokens/${tokenId}/rotate`,
    {},
    headers
  )
}

async function deleteProjectVariable (projectName, variableName, headers) {
  return freshDelete(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables/${variableName}`,
    headers
  )
}

async function createProjectVariable (projectName, payload, headers) {
  return freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables`,
    payload,
    headers
  )
}

module.exports = {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createLambdaPersonalAccessToken,
  readProjectVariable,
  updateProjectVariable,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  rotateProjectAccessToken,
  deleteProjectVariable,
  createProjectVariable
}
