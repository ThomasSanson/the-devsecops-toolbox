const http = require('http')

// HTTP request with a fresh TCP connection (no keep-alive pool).
// Avoids EPIPE / socket-hang-up after a long execSync that lets
// idle connections die while axios still holds them in its pool.
function freshRequest (method, url, { body, headers = {}, retries = 5, delay = 3000 } = {}) {
  const parsed = new URL(url)
  const data = body ? JSON.stringify(body) : null
  const reqHeaders = data
    ? { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    : headers

  const attempt = () => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
      agent: false
    }, (res) => {
      let respBody = ''
      res.on('data', chunk => { respBody += chunk })
      res.on('end', () => {
        if (!respBody.trim()) {
          resolve({ data: null, status: res.statusCode })
          return
        }
        try {
          resolve({ data: JSON.parse(respBody), status: res.statusCode })
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${respBody}`))
        }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })

  return (async () => {
    for (let i = 1; i <= retries; i++) {
      try {
        return await attempt()
      } catch (err) {
        if (i === retries) throw err
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  })()
}

function freshGet (url, headers, opts) {
  return freshRequest('GET', url, { headers, ...opts })
}

function freshPost (url, body, headers, opts) {
  return freshRequest('POST', url, { body, headers, ...opts })
}

function freshPut (url, body, headers, opts) {
  return freshRequest('PUT', url, { body, headers, ...opts })
}

function freshDelete (url, headers, opts) {
  return freshRequest('DELETE', url, { headers, ...opts })
}

module.exports = { freshGet, freshPost, freshPut, freshDelete }
