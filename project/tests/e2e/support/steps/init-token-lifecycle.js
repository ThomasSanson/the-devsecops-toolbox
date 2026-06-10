/* global Given When Then */
/**
 * Token-lifecycle damage steps — external mutations between two init runs
 * (revocation, variable tampering, duplicate tokens). The healing assertions
 * reuse init-baseline.js' existing steps (token id capture/differ, single
 * active token, variable existence, real git clone).
 */
const {
  getRootHeaders,
  listProjectAccessTokens,
  createProjectAccessToken,
  revokeProjectAccessToken,
  updateProjectVariable,
  readProjectVariable
} = require('../helpers/gitlabApi')

const TAMPERED_VALUE = 'tampered-by-e2e'

async function findActiveToken (projectName, tokenName, headers) {
  const tokens = await listProjectAccessTokens(projectName, headers)
  const token = (tokens.data || []).find(t => t.name === tokenName && t.active && !t.revoked)
  if (!token) {
    throw new Error(`No active token "${tokenName}" found for ${projectName}`)
  }
  return token
}

Given('the project access token {string} is revoked externally for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const token = await findActiveToken(projectName, tokenName, headers)
  const res = await revokeProjectAccessToken(projectName, token.id, headers)
  if (res.status >= 400) {
    throw new Error(`Failed to revoke token ${token.id} (${res.status}): ${JSON.stringify(res.data)}`)
  }
})

When('the CI\\/CD variable {string} is tampered for project {string}', async (variableName, projectName) => {
  const headers = await getRootHeaders()
  const res = await updateProjectVariable(projectName, variableName, { value: TAMPERED_VALUE }, headers)
  if (res.status >= 400) {
    throw new Error(`Failed to tamper variable ${variableName} (${res.status}): ${JSON.stringify(res.data)}`)
  }
})

When('a duplicate project access token {string} is created for project {string}', async (tokenName, projectName) => {
  const headers = await getRootHeaders()
  const expiresAt = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const res = await createProjectAccessToken(projectName, {
    name: tokenName,
    scopes: ['api', 'write_repository'],
    access_level: 40,
    expires_at: expiresAt
  }, headers)
  if (res.status >= 400) {
    throw new Error(`Failed to create duplicate token (${res.status}): ${JSON.stringify(res.data)}`)
  }
})

Then('the CI\\/CD variable {string} for project {string} must not have value {string}', async (variableName, projectName, forbidden) => {
  const headers = await getRootHeaders()
  const variable = await readProjectVariable(projectName, variableName, headers)
  const value = variable.data && variable.data.value
  if (!value) {
    throw new Error(`CI/CD variable ${variableName} is empty/missing for ${projectName}`)
  }
  if (value === forbidden) {
    throw new Error(`CI/CD variable ${variableName} still carries the tampered value for ${projectName}`)
  }
})
