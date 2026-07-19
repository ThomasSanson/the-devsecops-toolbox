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

async function createProject (payload, headers) {
  return freshPost(`${BASE_URL}/api/v4/projects`, payload, headers)
}

async function listProjectBranches (projectName, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/repository/branches`,
    headers
  )
}

async function listProjectMergeRequests (projectName, headers, query = '') {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/merge_requests${query}`,
    headers
  )
}

async function getMergeRequest (projectName, iid, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/merge_requests/${iid}`,
    headers
  )
}

async function mergeMergeRequest (projectName, iid, headers) {
  return freshPut(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/merge_requests/${iid}/merge`,
    {},
    headers
  )
}

async function updateProjectSettings (projectName, payload, headers) {
  return freshPut(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}`,
    payload,
    headers
  )
}

async function listRepositoryTree (projectName, headers, query = '') {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/repository/tree${query}`,
    headers
  )
}

async function deleteProject (projectName, headers) {
  return freshDelete(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}`,
    headers
  )
}

async function createLambdaPersonalAccessToken (tokenName, scopes = ['api', 'write_repository'], headers) {
  const userId = await getLambdaUserId(headers)
  const tokenResponse = await freshPost(
    `${BASE_URL}/api/v4/users/${userId}/personal_access_tokens`,
    { name: tokenName, scopes },
    headers
  )
  // Both the secret and the id are returned so the caller can revoke the PAT
  // in teardown — otherwise per-scenario tokens accumulate forever on the
  // persistent test GitLab volume.
  return { token: tokenResponse.data.token, id: tokenResponse.data.id }
}

async function revokePersonalAccessToken (tokenId, headers) {
  return freshDelete(`${BASE_URL}/api/v4/personal_access_tokens/${tokenId}`, headers)
}

async function readProjectVariable (projectName, variableName, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables/${variableName}`,
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

async function updateProjectVariable (projectName, variableName, payload, headers) {
  return freshPut(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/variables/${variableName}`,
    payload,
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

// Ask the embedded GitLab to statically validate the .gitlab-ci.yml that was
// pushed to `ref` — the way it would before running it. Project-scoped so the
// `local:` includes and the `spec:inputs` header resolve against the real tree;
// returns { valid, errors, warnings, merged_yaml }.
async function lintProjectCi (projectName, headers, ref = 'main') {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/ci/lint?ref=${ref}&dry_run=false`,
    headers
  )
}

module.exports = {
  BASE_URL,
  projectPath,
  encodedProjectPath,
  getRootHeaders,
  createProject,
  deleteProject,
  listProjectBranches,
  listProjectMergeRequests,
  getMergeRequest,
  mergeMergeRequest,
  updateProjectSettings,
  listRepositoryTree,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken,
  readProjectVariable,
  updateProjectVariable,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  rotateProjectAccessToken,
  lintProjectCi
}
