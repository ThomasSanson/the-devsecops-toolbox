const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn, spawnSync, execFileSync } = require('child_process')
const { randomUUID } = require('crypto')

// Every displayed line comes from a command's stdout/stderr, including the
// shell's own command trace. No success summaries are composed for the cards.
function tracedCommand (command, args, options, allowed = [0]) {
  const result = spawnSync('sh', ['-xc', 'exec "$@"', 'publication-proof', command, ...args], {
    ...options, encoding: 'utf8', timeout: 30000
  })
  if (result.error) throw result.error
  const output = (result.stderr || '') + (result.stdout || '')
  assert.ok(allowed.includes(result.status), output)
  return { output, stdout: result.stdout || '' }
}

function fixtureRefuses (request, state) {
  if (state.apiFailure) return true
  const rules = [
    [state.threadFailure, ['POST'], '/discussions'],
    [state.tokenFailure, ['POST'], '/access_tokens'],
    [state.variableFailure, ['POST', 'PUT'], '/variables']
  ]
  return rules.some(([enabled, methods, endpoint]) =>
    enabled && methods.includes(request.method) && request.url.includes(endpoint))
}

function discussionResponse (state, git) {
  const marker = 'Publication-manifest: ' +
    (state.signoff === 'stale' ? '0'.repeat(40) : git('rev-parse', 'HEAD:.config/publication/manifest'))
  return [{
    id: 'publication-thread',
    individual_note: false,
    notes: [{
      id: 7,
      system: false,
      resolvable: true,
      resolved: true,
      updated_at: state.signoff === 'edited' ? '2026-09-04T12:00:00.200Z' : '2026-09-04T12:00:00.000Z',
      resolved_at: '2026-09-04T12:00:00.100Z',
      body: state.signoff === 'unrelated'
        ? 'The spelling looks good.'
        : 'Do these paths become public? Resolve this thread to say yes. An owner has to be the one who does.\n\n' + marker,
      resolved_by: { username: 'publication-owner' }
    }]
  }]
}

const API_ROUTES = [
  ['/access_tokens', request => request.method === 'GET'
    ? [{ id: 42, name: 'TASK_RENOVATE_TOKEN', revoked: false }]
    : { id: 43, token: 'fixture-new-token' }],
  ['/variables', request => ({ key: request.url.split('/').pop() })],
  ['/pipeline_schedules', request => request.method === 'GET' ? [] : { id: 6 }],
  ['/discussions', (request, state, git) => discussionResponse(state, git)],
  ['/merge_requests', (request, state, git) => {
    const mr = { iid: 1, state: 'merged', target_branch: 'main', merge_commit_sha: git('rev-parse', 'HEAD') }
    return request.url.includes('/repository/commits/') ? [mr] : mr
  }]
]

function respondToFixtureRequest (request, response, state, git, settingsFile) {
  // The setup card cats this file. These are the actual settings the fixture
  // server reads, not a second description of what it is supposed to do.
  const settings = fs.existsSync(settingsFile)
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    : state
  if (fixtureRefuses(request, settings)) {
    response.writeHead(403, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ message: 'Fixture API refusal' }))
    return
  }
  const route = API_ROUTES.find(([endpoint]) => request.url.includes(endpoint))
  const body = route ? route[1](request, settings, git) : {}
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

// Real Git repositories and the shipped tasks. GitLab API responses are a
// fixture here; the separate source-publication journey uses GitLab itself.
async function publicationFixture (repo = '/workspace') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-contract-'))
  const source = path.join(root, 'source')
  const target = path.join(root, 'public.git')
  const settingsFile = path.join(root, 'api-fixture.json')
  fs.mkdirSync(source)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', FORCE_COLOR: '1' }
  for (const key of Object.keys(env)) {
    if (key.startsWith('TASK_PUBLICATION_') || key.startsWith('CI_')) delete env[key]
  }
  const proof = []
  let recordMutations = false
  const commandOptions = { cwd: source, env }
  const git = (...args) => {
    const result = tracedCommand('git', args, commandOptions)
    if (recordMutations && ['tag', 'commit', 'checkout'].includes(args[0])) proof.push(result.output)
    return result.stdout.trimEnd()
  }
  const write = (name, content) => {
    const file = path.join(source, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Publication reviewer')
  git('config', 'user.email', 'reviewer@example.invalid')
  git('init', '--bare', '--quiet', '--initial-branch=main', target)
  fs.cpSync(path.join(repo, '.config/publication'), path.join(source, '.config/publication'), { recursive: true })
  write('src/message.txt', 'committed public source\n')
  write('.gitignore', 'src/*.txt\n')
  write('.config/publication/allowlist', '/src/**\n/.gitignore\n')
  write('.config/publication/denylist', '# Project exclusions\n')
  write('.config/publication/manifest', '.gitignore\nsrc/message.txt\n')
  write('.config/publication/owners', 'publication-owner\n')
  write('Taskfile.yml', [
    "version: '3'", 'includes:',
    '  publication: .config/publication/Taskfile.yml', 'tasks:',
    '  project:test:publication:export:', '    silent: true', '    cmds:',
    '      - sh .config/publication/publish.sh export ../snapshot', ''
  ].join('\n'))
  const commit = () => { git('add', '--force', '.'); git('commit', '--quiet', '-m', 'test: publication fixture') }
  commit()
  git('remote', 'add', 'origin', 'https://example.invalid/team/private.git')
  const state = { signoff: 'current', calls: [], requests: [] }
  const server = http.createServer((request, response) => {
    state.calls.push(request.url)
    const recorded = { method: request.method, url: request.url, body: '' }
    state.requests.push(recorded)
    request.setEncoding('utf8')
    request.on('data', chunk => { recorded.body += chunk })
    request.on('end', () => respondToFixtureRequest(request, response, state, git, settingsFile))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  Object.assign(env, {
    TASK_PUBLICATION_ENABLED: 'true',
    TASK_PUBLICATION_SOURCE_REF: 'main',
    TASK_PUBLICATION_TARGET_URL: target,
    TASK_PUBLICATION_TOKEN: 'fixture-target-token',
    TASK_PUBLICATION_SOURCE_TOKEN: 'fixture-source-token',
    TASK_PUBLICATION_PROJECT_PATH: 'team/private',
    TASK_PUBLICATION_API_URL: 'http://127.0.0.1:' + server.address().port + '/api/v4',
    TASK_PUBLICATION_SCAN: 'off'
  })
  const run = (task, overrides = {}) => new Promise((resolve, reject) => {
    recordMutations = true
    const child = spawn('sh', ['-xc', 'exec task --silent "$@"', 'publication-contract', task], {
      cwd: source, env: { ...env, ...overrides }, timeout: 30000
    })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', reject)
    child.on('close', code => {
      proof.push(output)
      resolve({ code, output, command: 'task --silent ' + task })
    })
  })
  return {
    root,
    source,
    target,
    env,
    state,
    git,
    write,
    commit,
    run,
    proof,
    settingsFile,
    read: name => fs.readFileSync(path.join(source, name), 'utf8'),
    inspect: (command, args, overrides = {}, allowed) =>
      tracedCommand(command, args, { ...commandOptions, env: { ...env, ...overrides } }, allowed).output,
    targetGit: (...args) => {
      const result = tracedCommand('git', ['--git-dir=../public.git', ...args], commandOptions)
      proof.push(result.output)
      return result.stdout.trimEnd()
    },
    close: async () => {
      await new Promise(resolve => server.close(resolve))
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

const SETUP_COMMANDS = {
  'committed-bytes': [['cat', ['.gitattributes']], ['git', ['config', '--get', 'filter.private.smudge']]],
  'ignored-paths': [['git', ['show', 'HEAD:.gitignore']]],
  'missing-floor': [['git', ['show', '--stat', '--format=', 'HEAD', '--', '.config/publication/denylist.base']]],
  'unsupported-symlink': [['git', ['ls-files', '--stage', '--', 'src/host']]],
  'unsupported-lfs': [['git', ['show', 'HEAD:src/large.txt']]],
  'unchanged-release': [['git', ['tag', '--list']]],
  'late-tag': [['git', ['tag', '--list']]],
  'tag-conflict': [['git', ['tag', '--list']]],
  'credentials-argv': [['cat', ['../bin/git']]],
  'export-failure': [['cat', ['../bin/git', '../bin/betterleaks']]],
  'index-failure': [['cat', ['../bin/git', '../bin/betterleaks']]],
  'option-path': [['git', ['show', 'HEAD:-public/message.txt']]],
  'init-settings': [['git', ['branch', '--show-current']]],
  'offline-missing-ref': [['git', ['remote', 'get-url', 'origin']]]
}
const API_SETUP_CONTRACTS = new Set([
  'unrelated-signoff', 'stale-signoff', 'edited-signoff', 'approval-refresh', 'api-failure',
  'approval-thread-failure', 'init-token-failure', 'init-variable-failure', 'init-settings'
])
const SIGNOFF_CONTRACTS = new Set(['unrelated-signoff', 'stale-signoff', 'edited-signoff', 'approval-refresh'])

function describeFixture (f, name, overrides) {
  const settings = Object.fromEntries(
    ['signoff', 'apiFailure', 'threadFailure', 'tokenFailure', 'variableFailure']
      .filter(key => f.state[key] !== undefined).map(key => [key, f.state[key]])
  )
  fs.writeFileSync(f.settingsFile, JSON.stringify(settings, null, 2) + '\n')
  const commands = [
    ['git', ['ls-files', '--stage', '--', '.gitignore', 'src', '-public']],
    ['git', ['show', 'HEAD:.config/publication/manifest']]
  ]
  const settingsKeys = ['TASK_PUBLICATION_ENABLED', 'TASK_PUBLICATION_SOURCE_REF',
    'TASK_PUBLICATION_SCAN', 'TASK_PUBLICATION_ON', 'CI', 'CI_JOB_MANUAL', 'CI_COMMIT_TAG']
  if (name === 'credential-url') settingsKeys.push('TASK_PUBLICATION_TARGET_URL')
  const effective = { ...f.env, ...overrides }
  for (const key of settingsKeys.filter(key => effective[key] !== undefined)) {
    commands.push(['printenv', [key]])
  }
  commands.push(...(SETUP_COMMANDS[name] || []))
  if (API_SETUP_CONTRACTS.has(name)) commands.push(['cat', ['../api-fixture.json']])
  if (SIGNOFF_CONTRACTS.has(name)) {
    fs.writeFileSync(path.join(f.root, 'approval-response.json'),
      JSON.stringify(discussionResponse(settings, f.git), null, 2) + '\n')
    commands.push(['git', ['rev-parse', 'HEAD:.config/publication/manifest']])
    commands.push(['cat', ['../approval-response.json']])
  }
  return commands.map(([command, args]) => f.inspect(command, args, overrides)).join('\n')
}

function proofOfResult (f, name) {
  fs.writeFileSync(path.join(f.root, 'api-requests.json'), JSON.stringify(f.state.requests, null, 2) + '\n')
  const reads = [
    ['git', ['--git-dir=../public.git', 'rev-list', '--all', '--count']],
    ['git', ['--git-dir=../public.git', 'tag', '--list']]
  ]
  const count = f.git('--git-dir', f.target, 'rev-list', '--all', '--count')
  if (Number(count) > 0) {
    reads.push(['git', ['-c', 'color.ui=always', '--git-dir=../public.git', 'log', '--oneline', '--decorate', '--all']])
  }
  if (API_SETUP_CONTRACTS.has(name) || ['disabled', 'offline-check', 'offline-missing-ref'].includes(name)) {
    reads.push(['cat', ['../api-requests.json']])
  }
  if (['export-failure', 'index-failure'].includes(name)) reads.push(['wc', ['-l', '../scan.log']])
  const output = f.proof.concat(reads.map(([command, args]) => f.inspect(command, args)))
  if (name === 'credentials-argv') {
    output.push(f.inspect('grep', ['-Fc', f.env.TASK_PUBLICATION_TOKEN, '../argv.log'], {}, [0, 1]))
    output.push(f.inspect('grep', ['-Fc', f.env.TASK_PUBLICATION_SOURCE_TOKEN, '../argv.log'], {}, [0, 1]))
  }
  return output.join('\n')
}

function fixtureCommits (f) {
  return {
    source: f.git('rev-list', '--all').split('\n').filter(Boolean),
    public: f.git('--git-dir', f.target, 'rev-list', '--all').split('\n').filter(Boolean)
  }
}

async function signoffContract (f, name) {
  f.state.signoff = name === 'unrelated-signoff' ? 'unrelated' : 'stale'
  const result = await f.run('publication:publish')
  assert.notEqual(result.code, 0, 'An unrelated or stale discussion approved the current manifest')
  assert.equal(f.targetGit('rev-list', '--all', '--count'), '0')
  return result
}

const CONTRACT_HANDLERS = {
  'committed-bytes': async f => {
    f.write('.gitattributes', 'src/message.txt filter=private\n')
    f.git('config', 'filter.private.smudge', "printf 'UNCOMMITTED CONTENT\\n'")
    const result = await f.run('project:test:publication:export')
    assert.equal(result.code, 0, result.output)
    const actual = fs.readFileSync(path.join(f.root, 'snapshot/src/message.txt'), 'utf8')
    assert.equal(actual, 'committed public source\n', 'An uncommitted smudge filter changed the published bytes')
    f.proof.push(f.inspect('cat', ['../snapshot/src/message.txt']))
    return result
  },
  'missing-floor': async f => {
    fs.rmSync(path.join(f.source, '.config/publication/denylist.base'))
    f.commit()
    const result = await f.run('publication:check')
    assert.notEqual(result.code, 0, 'The dry run accepted a missing framework denylist')
    assert.match(result.output, /denylist\.base/)
    return result
  },
  'unsupported-symlink': async f => {
    fs.symlinkSync('/etc/hostname', path.join(f.source, 'src/host'))
    f.commit()
    const result = await f.run('publication:check')
    assert.notEqual(result.code, 0, 'The dry run advertised a symlink as a publishable file')
    assert.match(result.output, /src\/host/)
    return result
  },
  disabled: async f => {
    const result = await f.run('publication:publish', { TASK_PUBLICATION_ENABLED: 'false' })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /disabled/i)
    assert.equal(f.state.calls.length, 0, 'Disabled publication contacted the forge')
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0')
    return result
  },
  'manual-ci': async f => {
    const result = await f.run('publication:publish', { CI: 'true', TASK_PUBLICATION_ON: 'manual' })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /manual/i)
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0', 'An automatic CI job published in manual mode')
    return result
  },
  'unrelated-signoff': signoffContract,
  'stale-signoff': signoffContract,
  'edited-signoff': async f => {
    f.state.signoff = 'edited'
    const result = await f.run('publication:publish')
    assert.notEqual(result.code, 0, 'A discussion edited after its owner resolution approved publication')
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0')
    const refreshed = await f.run('publication:approve')
    assert.equal(refreshed.code, 0, refreshed.output)
    assert.ok(f.state.requests.some(r => r.method === 'POST' && r.url.endsWith('/discussions')), 'An edited approval could not request a fresh owner decision')
    return refreshed
  },
  'ignored-paths': async f => {
    const result = await f.run('publication:publish')
    assert.equal(result.code, 0, result.output)
    assert.equal(f.targetGit('ls-tree', '-r', '--name-only', 'main'), '.gitignore\nsrc/message.txt', 'The public tree differs from the approved manifest')
    assert.equal(f.targetGit('show', 'main:src/message.txt'), 'committed public source')
    return result
  },
  'unchanged-release': async f => {
    f.git('tag', '1.0.0')
    const first = await f.run('publication:publish')
    assert.equal(first.code, 0, first.output)
    f.git('commit', '--quiet', '--allow-empty', '-m', 'test: second release')
    f.git('tag', '1.0.1')
    const result = await f.run('publication:publish')
    assert.equal(result.code, 0, result.output)
    assert.equal(f.targetGit('tag', '--list'), '1.0.0\n1.0.1', 'A release with unchanged public source lost its tag')
    assert.equal(f.targetGit('rev-list', '--count', 'main'), '2')
    const repeated = await f.run('publication:publish')
    assert.equal(repeated.code, 0, repeated.output)
    assert.equal(f.targetGit('rev-list', '--count', 'main'), '2', 'Retrying the same release created another commit')
    return result
  },
  'unverified-scan': async f => {
    const result = await f.run('publication:publish', { TASK_PUBLICATION_SCAN: 'done' })
    assert.notEqual(result.code, 0, 'A caller-provided done flag bypassed the required scan')
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0')
    return result
  },
  'credentials-argv': async f => {
    const bin = path.join(f.root, 'bin')
    const log = path.join(f.root, 'argv.log')
    fs.mkdirSync(bin)
    fs.writeFileSync(log, '')
    for (const tool of ['curl', 'sed', 'git', 'jq']) {
      const executable = execFileSync('which', [tool], { encoding: 'utf8' }).trim()
      fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\nprintf '%s\\n' "$@" >> "$PUBLICATION_ARGV_LOG"\nexec '${executable}' "$@"\n`, { mode: 0o755 })
    }
    const result = await f.run('publication:publish', { PATH: `${bin}:${f.env.PATH}`, PUBLICATION_ARGV_LOG: log })
    assert.equal(result.code, 0, result.output)
    const argv = fs.readFileSync(log, 'utf8')
    assert.ok(!argv.includes(f.env.TASK_PUBLICATION_TOKEN), 'The destination token appeared in process arguments')
    assert.ok(!argv.includes(f.env.TASK_PUBLICATION_SOURCE_TOKEN), 'The source token appeared in process arguments')
    return result
  },
  'api-failure': async f => {
    f.state.apiFailure = true
    f.write('src/new.txt', 'new public candidate\n')
    f.commit()
    const result = await f.run('publication:approve')
    assert.notEqual(result.code, 0, 'Approval reported success after the forge rejected its API calls')
    return result
  },
  'unsupported-lfs': async f => {
    f.write('src/large.txt', 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 10000\n')
    f.commit()
    const result = await f.run('publication:check')
    assert.notEqual(result.code, 0, 'The dry run advertised an LFS pointer as publishable source')
    assert.match(result.output, /src\/large\.txt/)
    return result
  },
  'offline-check': async f => {
    const result = await f.run('publication:check')
    assert.equal(result.code, 0, result.output)
    assert.equal(f.state.calls.length, 0, 'The offline dry run contacted the forge')
    return result
  },
  'credential-url': async f => {
    const target = new URL('https://example.invalid/public.git')
    target.username = 'fixture-user'
    target.password = randomUUID()
    f.generatedCredential = target.password
    const result = await f.run('publication:check', { TASK_PUBLICATION_TARGET_URL: target.toString() })
    assert.notEqual(result.code, 0, 'A target URL carrying a credential was accepted')
    assert.ok(!result.output.includes(target.password), 'The target URL credential was printed')
    return result
  },
  'tag-conflict': async f => {
    f.git('tag', '1.0.0')
    const first = await f.run('publication:publish')
    assert.equal(first.code, 0, first.output)
    const before = f.targetGit('rev-parse', 'main')
    f.targetGit('tag', '1.0.1')
    f.write('src/message.txt', 'second public source\n')
    f.commit()
    f.git('tag', '1.0.1')
    const result = await f.run('publication:publish')
    assert.notEqual(result.code, 0, 'A conflicting public tag was silently ignored')
    assert.equal(f.targetGit('rev-parse', 'main'), before, 'The branch moved despite a tag conflict')
    return result
  },
  'offline-missing-ref': async f => {
    f.git('remote', 'set-url', 'origin', f.env.TASK_PUBLICATION_API_URL + '/private.git')
    const result = await f.run('publication:check', { TASK_PUBLICATION_SOURCE_REF: 'absent' })
    assert.notEqual(result.code, 0, 'The dry run accepted an unavailable ref')
    assert.equal(f.state.calls.length, 0, 'The offline dry run fetched an unavailable ref')
    return result
  },
  'tag-ci': async f => {
    const result = await f.run('publication:publish', { CI: 'true', TASK_PUBLICATION_ON: 'tag' })
    assert.equal(result.code, 0, result.output)
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0', 'A branch pipeline published in tag-only mode')
    return result
  },
  'approval-refresh': async f => {
    f.state.signoff = 'unrelated'
    const result = await f.run('publication:approve')
    assert.equal(result.code, 0, result.output)
    assert.ok(f.state.requests.some(r => r.method === 'POST' && r.url.endsWith('/discussions')), 'An unsigned existing manifest could not request its owner signature')
    return result
  },
  'approval-thread-failure': async f => {
    f.state.threadFailure = true
    f.write('src/new.txt', 'new public candidate\n')
    f.commit()
    const result = await f.run('publication:approve')
    assert.notEqual(result.code, 0, 'Approval reported success although its sign-off thread was refused')
    return result
  },
  'init-token-failure': async f => {
    f.state.tokenFailure = true
    const result = await f.run('publication:init')
    assert.notEqual(result.code, 0, 'Setup accepted a refused replacement token')
    assert.ok(!f.state.requests.some(r => r.method === 'DELETE' && r.url.endsWith('/access_tokens/42')), 'Setup revoked the working token before obtaining its replacement')
    assert.ok(!f.read('.env.dist').includes('TASK_PUBLICATION_ENABLED=true'), 'Incomplete setup enabled publication')
    return result
  },
  'init-variable-failure': async f => {
    f.state.variableFailure = true
    const result = await f.run('publication:init')
    assert.notEqual(result.code, 0, 'Setup accepted a refused variable update')
    assert.ok(!f.state.requests.some(r => r.method === 'DELETE' && r.url.includes('/variables/')), 'Setup deleted a working CI variable before storing its replacement')
    assert.ok(!f.state.requests.some(r => r.method === 'DELETE' && r.url.endsWith('/access_tokens/42')), 'Setup revoked the token still used by CI')
    return result
  },
  'init-settings': async f => {
    f.git('checkout', '--quiet', '-b', 'onboarding')
    const result = await f.run('publication:init')
    assert.equal(result.code, 0, result.output)
    assert.ok(f.state.requests.some(r => r.method === 'PUT' && r.body.includes('only_allow_merge_if_all_discussions_are_resolved')), 'Setup did not enable the forge discussion merge gate')
    const schedule = f.state.requests.find(r => r.method === 'POST' && r.url.endsWith('/pipeline_schedules'))
    assert.equal(JSON.parse(schedule.body).ref, 'main', 'Setup scheduled the onboarding branch instead of the default branch')
    return result
  },
  'late-tag': async f => {
    const first = await f.run('publication:publish')
    assert.equal(first.code, 0, first.output)
    const before = f.targetGit('rev-parse', 'main')
    f.git('tag', '1.0.0')
    const result = await f.run('publication:publish')
    assert.equal(result.code, 0, result.output)
    assert.equal(f.targetGit('rev-parse', 'refs/tags/1.0.0'), before,
      'Adding a source tag did not tag the existing public commit')
    assert.equal(f.targetGit('rev-list', '--count', 'main'), '1',
      'Adding a tag to an already published source created another public commit')
    return result
  },
  'option-path': async f => {
    f.write('-public/message.txt', 'source in an option-like directory\n')
    f.write('.config/publication/allowlist', f.read('.config/publication/allowlist') + '/-public/**\n')
    f.write('.config/publication/manifest', f.read('.config/publication/manifest') + '-public/message.txt\n')
    f.commit()
    const result = await f.run('project:test:publication:export')
    assert.equal(result.code, 0, result.output)
    assert.equal(fs.readFileSync(path.join(f.root, 'snapshot/-public/message.txt'), 'utf8'),
      'source in an option-like directory\n', 'An option-like path lost its committed file bytes')
    f.proof.push(f.inspect('cat', ['../snapshot/-public/message.txt']))
    return result
  },
  'index-failure': async f => {
    const bin = path.join(f.root, 'bin')
    const log = path.join(f.root, 'scan.log')
    fs.mkdirSync(bin)
    const executable = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(bin, 'git'), [
      '#!/bin/sh',
      'if [ "$1" = cat-file ] && [ "$2" = blob ] && [ -e "$PUBLICATION_SCAN_LOG" ]; then',
      '  exit 74',
      'fi',
      "exec '" + executable + "' \"$@\"", ''
    ].join('\n'), { mode: 0o755 })
    fs.writeFileSync(path.join(bin, 'betterleaks'),
      '#!/bin/sh\nprintf "scan passed\\n" > "$PUBLICATION_SCAN_LOG"\n', { mode: 0o755 })
    const result = await f.run('publication:publish', {
      PATH: bin + ':' + f.env.PATH, TASK_PUBLICATION_SCAN: 'required', PUBLICATION_SCAN_LOG: log
    })
    assert.equal(fs.readFileSync(log, 'utf8'), 'scan passed\n', 'The fixture must reach a successful scan')
    assert.notEqual(result.code, 0, 'Publication accepted a failed Git blob read after scanning')
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0', 'A failed index read reached the public repository')
    return result
  },
  'export-failure': async f => {
    const bin = path.join(f.root, 'bin')
    const log = path.join(f.root, 'scan.log')
    fs.mkdirSync(bin)
    fs.writeFileSync(log, '')
    const executable = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(bin, 'git'),
      '#!/bin/sh\nif [ "$1" = cat-file ] && [ "$2" = blob ]; then exit 73; fi\nexec ' +
      "'" + executable + "'" + ' "$@"\n', { mode: 0o755 })
    fs.writeFileSync(path.join(bin, 'betterleaks'),
      '#!/bin/sh\nprintf "scan\\n" >> "$PUBLICATION_SCAN_LOG"\n', { mode: 0o755 })
    const result = await f.run('publication:publish', {
      PATH: bin + ':' + f.env.PATH, TASK_PUBLICATION_SCAN: 'required', PUBLICATION_SCAN_LOG: log
    })
    assert.notEqual(result.code, 0, 'Publication accepted a failed Git blob export')
    assert.equal(fs.readFileSync(log, 'utf8'), '', 'The scanner ran after a failed Git blob export')
    assert.equal(f.targetGit('rev-list', '--all', '--count'), '0', 'A failed export reached the public repository')
    return result
  }
}

const CONTRACTS = Object.keys(CONTRACT_HANDLERS)

async function runPublicationContract (name, repo, onSetup) {
  assert.ok(CONTRACT_HANDLERS[name], 'Unknown publication contract: ' + name)
  const f = await publicationFixture(repo)
  const run = f.run
  let setup
  let result
  f.run = async (task, overrides = {}) => {
    if (setup === undefined) {
      setup = describeFixture(f, name, overrides)
      if (onSetup) await onSetup({ output: setup, root: f.root, commits: fixtureCommits(f), generatedCredential: f.generatedCredential })
    }
    return run(task, overrides)
  }
  try {
    result = await CONTRACT_HANDLERS[name](f, name)
    return { setup, ...result, proof: proofOfResult(f, name), root: f.root, commits: fixtureCommits(f) }
  } catch (error) {
    error.message += result ? '\n' + result.output : ''
    throw error
  } finally {
    await f.close()
  }
}

async function preparePublicationContract (name) {
  let resolveSetup
  let rejectSetup
  let resume
  let cancel
  const setup = new Promise((resolve, reject) => { resolveSetup = resolve; rejectSetup = reject })
  const gate = new Promise((resolve, reject) => { resume = resolve; cancel = reject })
  const result = runPublicationContract(name, undefined, async evidence => {
    resolveSetup(evidence)
    await gate
  })
  // Preparation errors must reject the Given step too. The original result
  // remains awaited by Then, so contract assertion failures still fail it.
  result.then(undefined, rejectSetup)
  return { setup: await setup, result, resume, cancel }
}

function maskFixtureVolatility (output, evidence) {
  let text = output.split(evidence.root).join('<fixture>')
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<port>')
    // The real request and assertions keep the expiry; only its displayed date
    // varies between runs. Preserve every other date and request field.
    .replace(/(\\?"expires_at\\?":\s*\\?")\d{4}-\d{2}-\d{2}/g, '$1<token-expiry-date>')
  // Only the preparation evidence carries this random value. The contract
  // checks the unmasked command output before its result can reach a card.
  if (evidence.generatedCredential) text = text.split(evidence.generatedCredential).join('<generated-test-credential>')
  for (const [kind, commits] of Object.entries(evidence.commits)) {
    for (const [index, commit] of commits.entries()) {
      const label = '<' + kind + '-commit-' + (index + 1) + '>'
      text = text.split(commit).join(label).split(commit.slice(0, 7)).join(label)
    }
  }
  return text
}

module.exports = { CONTRACTS, publicationFixture, runPublicationContract, preparePublicationContract, maskFixtureVolatility }
