/**
 * The publication contracts' world: throwaway source repositories inside ONE
 * terminal container, and a stand-in for GitLab's API that the test controls.
 *
 * The repositories are built off camera by FIXTURE_SCRIPT, one directory per
 * contract under the bootstrap user's home, each with its own `.env` (the
 * settings a developer keeps there) and its own bare public repository next
 * to it (`~/<name>-public.git`). The cards then type the shipped tasks into the
 * live terminal.
 *
 * The stand-in forge runs in the test runner and answers the container as
 * http://fixture-forge:8080. It is a stand-in on purpose: a real GitLab cannot
 * refuse one endpoint on demand, and these contracts are about what the
 * publication does when it does. Typed on camera, it says what it was told and
 * what it was asked:
 *   curl -s -d 'POST /discussions' fixture-forge:8080/fixture/refuse
 *   curl -s fixture-forge:8080/fixture/requests
 * The source-publication journey covers the real GitLab API.
 */
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const { execFileSync } = require('child_process')
const {
  shellEscape,
  runCommand,
  containerName,
  execInContainer,
  execInContainerAsUser,
  removeContainer,
  waitForTtyd
} = require('./docker')
const {
  getRootHeaders,
  createProject,
  deleteProject,
  createLambdaPersonalAccessToken,
  revokePersonalAccessToken
} = require('./gitlabApi')

const FORGE_HOST = 'fixture-forge'
const FORGE_PORT = 8080
const HOME = '/home/bootstrap'
const OWNER = 'publication-owner'
// What every contract's manifest approves, unless the contract adds to it.
const MANIFEST = '.gitignore\nsrc/message.txt\n'
const PUBLIC_PROJECT_RE = /e2e-publication-[0-9a-f]+/g

// The object id `git hash-object` gives a file: the marker a sign-off names.
function blobHash (content) {
  return crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex')
}

const question = marker => `Do these paths become public?\n\nPublication-manifest: ${marker}`
function ownerAnswer (id, body, updatedAt) {
  return {
    id,
    individual_note: false,
    notes: [{
      id,
      system: false,
      resolvable: true,
      resolved: true,
      body,
      resolved_by: { username: OWNER },
      resolved_at: '2026-09-04T12:00:00.100Z',
      updated_at: updatedAt
    }]
  }
}
// The owner's answer on the merge request that brought the manifest in.
const SIGNED_OFF = [ownerAnswer('sign-off', question(blobHash(MANIFEST)), '2026-09-04T12:00:00.000Z')]
// Three answers by the same owner that must not count: a thread about
// something else, the list before this one, and this list's question edited
// after the owner resolved it (GitLab keeps the old resolution on an edit).
const NOT_SIGNED_OFF = [
  ownerAnswer('spelling', 'The spelling looks good.', '2026-09-04T12:00:00.000Z'),
  ownerAnswer('older-list', question('0'.repeat(40)), '2026-09-04T12:00:00.000Z'),
  ownerAnswer('edited', question(blobHash(MANIFEST)), '2026-09-04T12:00:00.200Z')
]
// The forge's discussions, per project path as it appears in the API URL.
const DISCUSSIONS = { 'team%2Fapproval': NOT_SIGNED_OFF }

function apiResponse (method, url) {
  if (url.includes('/access_tokens')) {
    return method === 'GET' ? [{ id: 42, name: 'TASK_RENOVATE_TOKEN', revoked: false }] : { id: 43, token: 'fixture-new-token' }
  }
  if (url.includes('/variables')) return { key: url.split('?')[0].split('/').pop() }
  if (url.includes('/pipeline_schedules')) return method === 'GET' ? [] : { id: 6 }
  if (url.includes('/discussions')) {
    if (method !== 'GET') return { id: 'new-question' }
    const project = (url.match(/\/projects\/([^/]+)\//) || [])[1]
    return DISCUSSIONS[project] || SIGNED_OFF
  }
  if (url.includes('/merge_requests')) {
    const mr = { iid: 1, state: 'merged', target_branch: 'main' }
    return url.includes('/repository/commits/') ? [mr] : mr
  }
  return {}
}

/**
 * Start the stand-in forge on 0.0.0.0:FORGE_PORT. Every API request is
 * recorded with its status and body (the twins read `forge.requests`); a
 * refusal rule, set on camera through /fixture/refuse, answers 403 the way
 * GitLab does. `reset()` clears both between cards.
 */
async function startFixtureForge () {
  const forge = { requests: [], refuse: null }
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const reply = (status, payload) => {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
        response.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json' })
        response.end(text)
      }
      const { method, url } = request
      if (method === 'POST' && url === '/fixture/refuse') {
        const [methods, fragment] = body.trim().split(/\s+/)
        forge.refuse = { methods: methods.split(','), fragment }
        return reply(200, `refusing ${methods} ${fragment}\n`)
      }
      if (url === '/fixture/requests') {
        return reply(200, forge.requests.map(r => `${r.status} ${r.method} ${r.url}\n`).join(''))
      }
      const rule = forge.refuse
      const refused = Boolean(rule && (rule.methods.includes('*') || rule.methods.includes(method)) && url.includes(rule.fragment))
      forge.requests.push({ method, url, body, status: refused ? 403 : 200 })
      if (refused) return reply(403, { message: '403 Forbidden' })
      reply(200, apiResponse(method, url))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(FORGE_PORT, '0.0.0.0', resolve)
  })
  forge.reset = () => { forge.requests = []; forge.refuse = null }
  forge.close = () => new Promise(resolve => server.close(() => resolve()))
  // What the publication itself receives, for the twin of a displayed copy.
  forge.discussions = project => DISCUSSIONS[project] || SIGNED_OFF
  return forge
}

// The runner's address on a network it shares with the container, for the
// container's /etc/hosts: a fixed name keeps every URL on the cards the same
// from run to run.
function runnerAddress (container) {
  const toInt = ip => ip.split('.').reduce((n, byte) => ((n << 8) | Number(byte)) >>> 0, 0)
  const theirs = runCommand(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' ${shellEscape(container)}`)
    .split(/\s+/).filter(Boolean).map(toInt)
  const mine = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .find(i => theirs.some(ip => ((ip & toInt(i.netmask)) >>> 0) === ((toInt(i.address) & toInt(i.netmask)) >>> 0)))
  if (!mine) throw new Error(`publication contracts: the runner shares no IPv4 network with ${container} for the stand-in forge`)
  return mine.address
}

// Built off camera, as the bootstrap user, in $HOME. Dates are pinned so the
// fixture commits are the same on every run (the cards still mask their ids:
// they hash the working branch's .config/publication).
const FIXTURE_SCRIPT = String.raw`
set -eu
export GIT_AUTHOR_DATE=2026-01-01T00:00:00Z GIT_COMMITTER_DATE=2026-01-01T00:00:00Z
git config --global user.name 'Publication reviewer'
git config --global user.email 'reviewer@example.invalid'
git config --global init.defaultBranch main
git config --global core.pager cat
cd "$HOME"

# The base: one approved source file that the ignore file also matches.
mkdir -p source/src source/.config
cp -R /tmp/publication source/.config/publication
cd source
git init -q
printf 'committed public source\n' > src/message.txt
printf 'src/*.txt\n' > .gitignore
printf '/src/**\n/.gitignore\n' > .config/publication/allowlist
printf '# Project exclusions\n' > .config/publication/denylist
printf '.gitignore\nsrc/message.txt\n' > .config/publication/manifest
printf '${OWNER}\n' > .config/publication/owners
cat > Taskfile.yml <<'EOF'
version: '3'
dotenv: ['.env', '.env.dev', '.env.dist']
includes:
  publication: .config/publication/Taskfile.yml
tasks:
  project:test:publication:export:
    silent: true
    cmds:
      - sh .config/publication/publish.sh export ../snapshot
EOF
git add --force .
git commit -q -m 'chore: approve the public source'
git remote add origin https://example.invalid/team/private.git
cat > .env <<'EOF'
TASK_PUBLICATION_ENABLED=true
TASK_PUBLICATION_SOURCE_REF=main
TASK_PUBLICATION_TARGET_URL=../source-public.git
TASK_PUBLICATION_TOKEN=fixture-target-token
TASK_PUBLICATION_SOURCE_TOKEN=fixture-source-token
TASK_PUBLICATION_API_URL=http://${FORGE_HOST}:${FORGE_PORT}/api/v4
TASK_PUBLICATION_SCAN=off
EOF
cd "$HOME"
git init -q --bare source-public.git

# One copy of the base per contract, each publishing to its own public repository.
variant () {
  cp -a source "$1"
  sed -i "s#^TASK_PUBLICATION_TARGET_URL=.*#TASK_PUBLICATION_TARGET_URL=../$1-public.git#" "$1/.env"
  git init -q --bare "$1-public.git"
}

variant bytes
cd bytes
mkdir -- -public
printf 'source in a folder whose name starts with a dash\n' > -public/message.txt
printf '/-public/**\n' >> .config/publication/allowlist
printf '%s\n' -public/message.txt >> .config/publication/manifest
git add --force -- -public .config/publication
git commit -q -m 'feat: publish a folder whose name starts with a dash'
printf 'src/message.txt filter=private\n' > .gitattributes
git config filter.private.smudge "printf 'UNCOMMITTED CONTENT\n'"
rm src/message.txt
git checkout -- src/message.txt
cd "$HOME"

variant symlink
cd symlink
ln -s /etc/hostname src/host
git add src/host
git commit -q -m 'feat: link src/host to a file outside the repository'
cd "$HOME"

variant lfs
cd lfs
printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize 10000\n' "$(printf 'a%.0s' $(seq 64))" > src/large.txt
git add --force src/large.txt
git commit -q -m 'feat: add a large file through Git LFS'
cd "$HOME"

variant no-floor
cd no-floor
git rm -q .config/publication/denylist.base
git commit -q -m 'chore: drop the framework denylist'
cd "$HOME"

# Its origin is the stand-in forge: a fetch would show up in its request log.
variant offline
git -C offline remote set-url origin http://${FORGE_HOST}:${FORGE_PORT}/team/private.git

for name in export-fails index-fails; do
  variant "$name"
  sed -i 's/^TASK_PUBLICATION_SCAN=.*/TASK_PUBLICATION_SCAN=required/' "$name/.env"
  mkdir "$name/bin"
  : > "$name/scan.log"
  printf '#!/bin/sh\necho "scan passed" >> %s\n' "$HOME/$name/scan.log" > "$name/bin/betterleaks"
done
cat > export-fails/bin/git <<'EOF'
#!/bin/sh
# Every read of a file's contents fails.
if [ "$1 $2" = "cat-file blob" ]; then exit 73; fi
exec /usr/bin/git "$@"
EOF
cat > index-fails/bin/git <<EOF
#!/bin/sh
# Reads of a file's contents fail once the scanner has written its log.
if [ "\$1 \$2" = "cat-file blob" ] && [ -s $HOME/index-fails/scan.log ]; then exit 74; fi
exec /usr/bin/git "\$@"
EOF
chmod +x export-fails/bin/* index-fails/bin/*

variant approval
git -C approval remote set-url origin https://example.invalid/team/approval.git

variant new-path
cd new-path
printf 'new public candidate\n' > src/new.txt
git add --force src/new.txt
git commit -q -m 'feat: add src/new.txt'
cd "$HOME"

# Every tool the publication hands a token to records its arguments.
variant credentials
mkdir credentials/bin
: > credentials/argv.log
for tool in curl sed git jq; do
  cat > "credentials/bin/$tool" <<EOF
#!/bin/sh
printf '%s\n' "\$@" >> $HOME/credentials/argv.log
exec $(command -v "$tool") "\$@"
EOF
done
chmod +x credentials/bin/*

variant setup
variant onboarding
git -C onboarding checkout -q -b onboarding
variant release
`

/**
 * The terminal container: a plain Ubuntu shell (no GitLab clone), the
 * runner's own `task`, the working branch's .config/publication, the fixture
 * repositories, the stand-in forge's name, and ttyd rooted in $HOME.
 * Returns the container name (the caller removes it).
 */
function setupPublicationTerminal () {
  const name = containerName()
  runCommand(`cd /workspace/project && docker compose run -d --name ${shellEscape(name)} ubuntu`, { timeout: 300000 })
  try {
    const task = fs.realpathSync(runCommand('command -v task').trim())
    runCommand(`docker cp ${shellEscape(task)} ${shellEscape(`${name}:/usr/local/bin/task`)}`)
    runCommand(`docker cp /workspace/.config/publication ${shellEscape(`${name}:/tmp/publication`)}`)
    const root = execInContainer(name, [
      `echo ${shellEscape(`${runnerAddress(name)} ${FORGE_HOST}`)} >> /etc/hosts`,
      'chown -R bootstrap:bootstrap /tmp/publication'
    ].join(' && '), { user: 'root' })
    if (root.exitCode !== 0) throw new Error(`Could not prepare the publication terminal:\n${root.output}`)
    const fixture = execInContainerAsUser(name, 'bootstrap', FIXTURE_SCRIPT, { timeout: 120000 })
    if (fixture.exitCode !== 0) throw new Error(`Could not build the publication fixtures:\n${fixture.output}`)
    writeContainerFile(name, `${HOME}/approval/discussions.json`, JSON.stringify(NOT_SIGNED_OFF, null, 2) + '\n')
    const ttyd = execInContainerAsUser(name, 'bootstrap',
      `cd ${HOME} && nohup ttyd -p 7681 -W -t scrollback=5000 -t rendererType=dom bash >/tmp/ttyd.log 2>&1 &\nsleep 1`)
    if (ttyd.exitCode !== 0) throw new Error(`Could not start ttyd:\n${ttyd.output}`)
    waitForTtyd(name, 30000)
    return name
  } catch (error) {
    removeContainer(name)
    throw error
  }
}

// Through stdin, never through a command line: a file may carry a token.
function writeContainerFile (container, file, content) {
  execFileSync('docker', ['exec', '-i', '-u', 'bootstrap', container, 'sh', '-c', `cat > ${shellEscape(file)}`],
    { input: content, stdio: ['pipe', 'ignore', 'pipe'] })
}

// A read in the container, the twin of what a card shows. Quiet: the cards
// read the repositories often, and their ids have no place in the job log.
function inContainer (container, script) {
  try {
    return execFileSync('docker', ['exec', '-u', 'bootstrap', '-e', `HOME=${HOME}`, '-w', HOME, container, 'sh', '-c', script],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`\`${script}\` failed in the publication terminal:\n${error.stdout || ''}${error.stderr || ''}`)
  }
}

/**
 * Every commit id the container's repositories hold, with the label a card
 * shows in its place: `<source-commit-N>` for the Nth commit of a source
 * repository, `<public-commit-N>` for the Nth of a public one (the
 * `*-public.git` repositories, and `publicCommits`, oldest first, for
 * GitLab's). The base
 * commit is the first of every source repository, so it reads the same on
 * every card.
 */
function commitLabels (container, publicCommits = []) {
  const listed = inContainer(container, [
    'for r in "$HOME"/*/; do [ -d "$r/.git" ] && git -C "$r" rev-list --all --topo-order --reverse | awk \'{print "source", NR, $1}\'; done',
    'for r in "$HOME"/*-public.git; do git --git-dir="$r" rev-list --all --topo-order --reverse 2>/dev/null | awk \'{print "public", NR, $1}\'; done',
    'true'
  ].join('\n'))
  const labels = new Map()
  for (const line of listed.split('\n').filter(Boolean)) {
    const [kind, index, sha] = line.trim().split(/\s+/)
    if (!labels.has(sha)) labels.set(sha, `<${kind}-commit-${index}>`)
  }
  publicCommits.forEach((sha, i) => labels.set(sha, `<public-commit-${i + 1}>`))
  return labels
}

/**
 * The masks of one card: each commit id on screen (whole or abbreviated)
 * becomes its label, and the public project's random name becomes "project".
 * Two different commits with the same label on one card would make the card
 * lie, so that throws.
 */
function commitMasks (screen, labels) {
  const masks = []
  const seen = new Map()
  for (const hex of new Set(screen.match(/\b[0-9a-f]{7,40}\b/g) || [])) {
    const sha = [...labels.keys()].find(s => s.startsWith(hex))
    if (!sha) continue
    const label = labels.get(sha)
    if (seen.has(label) && seen.get(label) !== sha) {
      throw new Error(`Two different commits would both read ${label} on one card: ${seen.get(label)} and ${sha}`)
    }
    seen.set(label, sha)
    masks.push([new RegExp(`\\b${hex}\\b`, 'g'), label])
  }
  return [...masks, [PUBLIC_PROJECT_RE, 'project']]
}

/**
 * An empty public project of the lambda user on the test GitLab, and a token
 * of that user that may push to it: the release chapter's destination.
 */
async function createPublicTarget () {
  const root = await getRootHeaders()
  const name = `e2e-publication-${crypto.randomBytes(4).toString('hex')}`
  const { token, id: tokenId } = await createLambdaPersonalAccessToken(`publish-${name}`, ['api', 'write_repository'], root)
  const headers = { 'PRIVATE-TOKEN': token }
  const created = await createProject({ name, visibility: 'public', initialize_with_readme: false, auto_devops_enabled: false }, headers)
  if (created.status >= 400) {
    await revokePersonalAccessToken(tokenId, root).catch(() => {})
    throw new Error(`creating the public project "${name}" returned ${created.status}: ${JSON.stringify(created.data)}`)
  }
  const projectName = created.data.path
  return {
    projectName,
    headers,
    token,
    url: `http://gitlab/${created.data.path_with_namespace}.git`, // DevSkim: ignore DS137138 -- Isolated test GitLab; never a deployed application endpoint.
    teardown: async () => {
      await deleteProject(projectName, root).catch(() => {})
      await revokePersonalAccessToken(tokenId, root).catch(() => {})
    }
  }
}

// The release directory's settings: the base ones, aimed at the real project.
function releaseEnv (target) {
  return [
    'TASK_PUBLICATION_ENABLED=true',
    'TASK_PUBLICATION_SOURCE_REF=main',
    `TASK_PUBLICATION_TARGET_URL=${target.url}`,
    `TASK_PUBLICATION_TOKEN_USERNAME=${process.env.TASK_GITLAB_LAMBDA_USER}`,
    `TASK_PUBLICATION_TOKEN=${target.token}`,
    'TASK_PUBLICATION_SOURCE_TOKEN=fixture-source-token',
    `TASK_PUBLICATION_API_URL=http://${FORGE_HOST}:${FORGE_PORT}/api/v4`,
    'TASK_PUBLICATION_SCAN=off',
    ''
  ].join('\n')
}

module.exports = {
  HOME,
  NOT_SIGNED_OFF,
  startFixtureForge,
  setupPublicationTerminal,
  writeContainerFile,
  inContainer,
  commitLabels,
  commitMasks,
  createPublicTarget,
  releaseEnv
}
