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

// Idempotent: on a virgin GitLab (a fresh CI instance), the scenario asking
// for the lambda user's id may be the first one to need it at all, racing
// whichever scenario would normally have created it first via
// GitLabUserPage.ensureUserViaApi. Create-if-missing here too, mirroring that
// same payload, so callers never depend on run order.
async function getLambdaUserId (headers) {
  const username = getLambdaUsername()
  const usersResponse = await freshGet(`${BASE_URL}/api/v4/users?username=${username}`, headers)
  if (usersResponse.data.length > 0) return usersResponse.data[0].id
  await freshPost(`${BASE_URL}/api/v4/users`, {
    email: process.env.TASK_GITLAB_LAMBDA_EMAIL,
    username,
    name: 'Lambda User',
    password: process.env.TASK_GITLAB_LAMBDA_PASSWORD,
    skip_confirmation: true,
    force_random_password: false,
    reset_password: false
  }, headers)
  const retryResponse = await freshGet(`${BASE_URL}/api/v4/users?username=${username}`, headers)
  return retryResponse.data[0].id
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

// Mint a runner scoped to ONE project (not instance-wide): a project runner only
// picks up that project's jobs, so it never drains the shared backlog of every
// other test project. Needs the admin Bearer from getRootHeaders(); returns
// { id, token: 'glrt-...' }.
async function createProjectRunner (projectId, headers, tagList = []) {
  // Tags are fixed at creation for authentication-token (glrt-) runners, not at
  // `register`; a job that carries a tag is only picked up by a runner that
  // advertises it, so tag_list must be set here.
  return freshPost(
    `${BASE_URL}/api/v4/user/runners`,
    { runner_type: 'project_type', project_id: projectId, run_untagged: true, tag_list: tagList },
    headers
  )
}

async function deleteRunner (runnerId, headers) {
  return freshDelete(`${BASE_URL}/api/v4/runners/${runnerId}`, headers)
}

async function triggerProjectPipeline (projectName, ref, headers) {
  return freshPost(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/pipeline`,
    { ref },
    headers
  )
}

async function listProjectPipelines (projectName, headers, query = '') {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/pipelines${query}`,
    headers
  )
}

async function getPipeline (projectName, pipelineId, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/pipelines/${pipelineId}`,
    headers
  )
}

async function listPipelineJobs (projectName, pipelineId, headers) {
  return freshGet(
    `${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}/pipelines/${pipelineId}/jobs`,
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
  lintProjectCi,
  createProjectRunner,
  deleteRunner,
  triggerProjectPipeline,
  listProjectPipelines,
  getPipeline,
  listPipelineJobs
}
