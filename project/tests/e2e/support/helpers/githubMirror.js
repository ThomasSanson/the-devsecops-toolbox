/**
 * A GitHub mirror for the @github-mirror story, standing in for the Nexus of a
 * forge whose runners cannot reach GitHub: /github/<path> answers with
 * github.com/<path> and /raw/<path> with raw.githubusercontent.com/<path>. It
 * runs in the suite's own container, which reaches GitHub, and keeps every
 * path it served so the story can tell which downloads went through it.
 */
const http = require('http')
const { Readable } = require('stream')

const MIRROR_PORT = 8088
// The suite's container, as the scenario containers reach it on the compose network.
const MIRROR_URL = `http://codeceptjs:${MIRROR_PORT}` // DevSkim: ignore DS137138 -- Test mirror on the compose network; never a deployed endpoint.
const UPSTREAMS = { github: 'https://github.com', raw: 'https://raw.githubusercontent.com' }

function startGithubMirror () {
  const served = []
  const server = http.createServer(async (request, response) => {
    const [, repository, ...rest] = request.url.split('/')
    const upstream = UPSTREAMS[repository]
    if (!upstream) return response.writeHead(404).end()
    try {
      const answer = await fetch(`${upstream}/${rest.join('/')}`)
      served.push(`${repository}/${rest.join('/')}`)
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') || 'application/octet-stream' })
      if (!answer.body) return response.end()
      Readable.fromWeb(answer.body).pipe(response)
    } catch (error) {
      response.writeHead(502).end(String(error))
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(MIRROR_PORT, () => resolve({ served, close: () => server.close() }))
  })
}

module.exports = { MIRROR_URL, startGithubMirror }
