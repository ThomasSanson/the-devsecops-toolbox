/* global NodeFilter */
/**
 * Shared runner + pipeline helpers for the stories that need a REAL pipeline to
 * run on the in-repo test GitLab: @install-complete (the framework MR builds and
 * merges) and @daily-contribution (an everyday change rides an MR and main
 * releases it). Both register a project-scoped, privileged docker-executor runner
 * inside the SAME gitlab-runner compose service, wait a pipeline to a terminal
 * state, mask the volatile pipeline chrome for tolerance:0, and tear their own
 * runner down surgically.
 *
 * Isolation contract (why the teardown is surgical): in CI each shard boots its
 * own compose stack, but a LOCAL full-suite run shares one gitlab-runner service
 * between these two stories. concurrent=1 (config.toml default) serialises their
 * jobs so their docker:dind services never collide; the teardown therefore
 * unregisters ONLY its own runner token — never --all-runners, never rm
 * config.toml, never a restart — so the other scenario's registration and its
 * running job survive.
 */
const { runCommandWithResult } = require('./docker')
const {
  BASE_URL,
  encodedProjectPath,
  createProjectRunner,
  deleteRunner,
  getPipeline,
  cancelPipeline
} = require('./gitlabApi')
const { freshGet } = require('./http')

const RUNNER_TAG = 'saas-linux-medium-amd64'
const RUNNER_NET = 'the-devsecops-toolbox_the-devsecops-toolbox'
// The full generated pipeline runs ~17 jobs on ONE runner (megalinter pulls its
// image); a wide budget covers the slower nested dind in CI without touching any
// global timeout.
const PIPELINE_TIMEOUT_MS = 1500000

async function projectId (projectName, headers) {
  const res = await freshGet(`${BASE_URL}/api/v4/projects/${encodedProjectPath(projectName)}`, headers)
  return res.data && res.data.id
}

// Register a project-scoped, privileged docker-executor runner inside the blank
// gitlab-runner compose service (project/gitlab/docker-compose.yml). Scoped so it
// only ever runs THIS project's jobs; privileged + /certs/client so the generated
// pipeline's docker:dind service works. SIGHUP (not restart) reloads the freshly
// written config.toml so the new runner starts picking jobs WITHOUT aborting a job
// the shared service may already be running for the other scenario. Returns a
// descriptor the caller keeps for teardownScopedRunner.
async function registerScopedRunner (I, projectName, rootHeaders) {
  const id = await projectId(projectName, rootHeaders)
  const runner = await createProjectRunner(id, rootHeaders, [RUNNER_TAG])
  if (runner.status >= 400) {
    throw new Error(`createProjectRunner failed (${runner.status}): ${JSON.stringify(runner.data)}`)
  }
  const runnerId = runner.data.id
  const glrt = runner.data.token
  const found = runCommandWithResult('docker ps --format "{{.Names}}" --filter "name=gitlab-runner"')
  const svc = (found.stdout || found.output || '').trim().split('\n').filter(Boolean)[0]
  if (!svc) throw new Error('gitlab-runner compose service is not running')
  // ONE job slot, deliberately: every docker-using job spawns a dind service
  // named 'docker' on the SHARED network, so two concurrent services collide (a
  // job reaches the other job's dind and fails TLS: x509 unknown authority).
  // Purge only STALE (exited) job containers from an aborted run — never a live
  // one, which would belong to the other scenario sharing this service. The
  // anchored pattern can never match the compose service itself (its name starts
  // with the project prefix).
  runCommandWithResult("docker ps -a --filter status=exited --format '{{.Names}}' | grep -E '^runner-' | xargs -r docker rm -f")
  const reg = runCommandWithResult(
    `docker exec ${svc} gitlab-runner register --non-interactive ` +
    `--url http://gitlab --token ${glrt} --executor docker ` +
    `--docker-image alpine:3.20 --docker-network-mode ${RUNNER_NET} ` +
    '--docker-privileged --docker-volumes /certs/client'
  )
  if (reg.exitCode !== 0) throw new Error(`gitlab-runner register failed: ${reg.stdout || ''}${reg.stderr || ''}`)
  // Graceful reload of the freshly written config.toml: the new runner starts
  // polling, any job already running for the other scenario keeps going.
  runCommandWithResult(`docker kill -s HUP ${svc}`)
  await I.wait(6)
  return { runnerId, runnerToken: glrt, svc }
}

// Surgical teardown: unregister ONLY this runner's token (NEVER --all-runners,
// NEVER rm config.toml, NEVER restart) so a scenario sharing the compose service
// keeps its own registration and its running job, then delete the runner on
// GitLab. All best-effort so a failing scenario still tidies up.
async function teardownScopedRunner (runner, rootHeaders) {
  if (!runner) return
  if (runner.svc && runner.runnerToken) {
    try {
      runCommandWithResult(
        `docker exec ${runner.svc} gitlab-runner unregister --url http://gitlab --token ${runner.runnerToken}`
      )
    } catch (_) {}
  }
  if (runner.runnerId) {
    try { await deleteRunner(runner.runnerId, rootHeaders) } catch (_) {}
  }
}

// Cancel every non-terminal pipeline of the project EXCEPT keepPid. A branch push
// with an open MR, or a still-pending bootstrap pipeline, otherwise interleaves
// with the one we wait on and doubles the single-slot wall-clock.
async function cancelRedundantPipelines (projectName, keepPid, rootHeaders) {
  try {
    const encoded = encodedProjectPath(projectName)
    const all = await freshGet(`${BASE_URL}/api/v4/projects/${encoded}/pipelines`, rootHeaders)
    for (const p of (all.data || [])) {
      if (p.id !== keepPid && !['success', 'failed', 'canceled', 'skipped'].includes(p.status)) {
        await cancelPipeline(projectName, p.id, rootHeaders)
      }
    }
  } catch (e) {
    console.log(`redundant pipeline cancel skipped: ${e.message}`)
  }
}

// Poll the MR's pipeline (merge_request_event, created when the push landed on a
// branch with an open MR) until it reaches a terminal state. Cancels the
// redundant branch pipeline the same push may have spawned. Returns { pid, status }.
async function waitMergeRequestPipeline (I, projectName, mrIid, headers) {
  const encoded = encodedProjectPath(projectName)
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let pid = null
  let last = ''
  while (Date.now() < deadline) {
    if (!pid) {
      const mp = await freshGet(`${BASE_URL}/api/v4/projects/${encoded}/merge_requests/${mrIid}/pipelines`, headers)
      if (mp.data && mp.data.length) pid = mp.data[0].id
      if (pid) await cancelRedundantPipelines(projectName, pid, headers)
    }
    if (pid) {
      const pipe = await getPipeline(projectName, pid, headers)
      const status = pipe.data.status
      if (status !== last) { console.log(`MR pipeline ${pid}: ${status}`); last = status }
      if (['success', 'failed', 'canceled', 'skipped'].includes(status)) return { pid, status }
    }
    await I.wait(10)
  }
  return { pid, status: 'timeout' }
}

// Poll the newest pipeline on `ref` (e.g. main after a merge) to a terminal
// state on the same single-slot runner. Returns { pid, status }.
async function waitRefPipeline (I, projectName, ref, headers) {
  const encoded = encodedProjectPath(projectName)
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS
  let pid = null
  let last = ''
  while (Date.now() < deadline) {
    if (!pid) {
      const mp = await freshGet(
        `${BASE_URL}/api/v4/projects/${encoded}/pipelines?ref=${encodeURIComponent(ref)}&order_by=id&sort=desc`,
        headers
      )
      if (mp.data && mp.data.length) pid = mp.data[0].id
    }
    if (pid) {
      const pipe = await getPipeline(projectName, pid, headers)
      const status = pipe.data.status
      if (status !== last) { console.log(`${ref} pipeline ${pid}: ${status}`); last = status }
      if (['success', 'failed', 'canceled', 'skipped'].includes(status)) return { pid, status }
    }
    await I.wait(10)
  }
  return { pid, status: 'timeout' }
}

// Print the trace tails of the failed jobs NOW: the After cleanup deletes the
// project, so this is the only moment the evidence still exists. Shared by every
// pipeline wait.
function dumpFailedTraces (projectName, jobs, rootHeaders, svc) {
  const failed = jobs.filter(j => j.status === 'failed')
  const encoded = encodedProjectPath(projectName)
  for (const j of failed.slice(0, 3)) {
    // The trace endpoint returns raw text, not JSON — curl it directly.
    const auth = rootHeaders.Authorization
    const tail = runCommandWithResult(
      `curl -s -H 'Authorization: ${auth}' '${BASE_URL}/api/v4/projects/${encoded}/jobs/${j.id}/trace' | tail -40`
    )
    console.log(`── trace tail of ${j.stage}/${j.name} (#${j.id}):\n${tail.stdout || tail.output || tail.stderr || ''}`)
  }
  if (svc) console.log(runCommandWithResult(`docker logs --tail 40 ${svc} 2>&1`).output || '')
}

// The pipeline page carries a lot of volatile chrome: the pipeline id (#123),
// per-job durations (0:42, 00:01:07), the commit SHA, the trigger time, the
// runner name and avatars. Neutralise ALL of it in the DOM so the "every job
// green" graph is the only thing that varies between runs — the REST twin has
// already proven status=success with each job's real state. Also used for the
// tags page (same volatile dates/SHAs) and any masked pipeline/tag view.
async function maskPipelinePage (I, projectName, { keepContext = false } = {}) {
  await I.waitForElement('body', 30)
  await I.wait(3)
  await I.executeScript((args) => {
    const projectName = args.projectName
    const keepContext = args.keepContext
    const PLACEHOLDER = '—'
    const VOLATILE_RE = [
      /^[A-Za-z]{3,9} \d{1,2}, \d{4}$/, //           "Jul 20, 2026"
      /^\d{4}-\d{2}-\d{2}$/, //                       "2026-07-20"
      /\b\d+ (second|minute|hour|day|week|month|year)s? ago\b/,
      /\bjust now\b/i,
      /^[0-9a-f]{7,40}$/i, //                          commit SHA
      /^#\d+$/, //                                     pipeline / job id badge (#123)
      /^\d{1,2}:\d{2}(:\d{2})?$/, //                   job duration 0:42 / 00:01:07
      /^\d+ (second|minute|hour)s?$/ //                "42 seconds"
    ]

    // Top app bar: it carries the project breadcrumb, which tells the reader
    // where they are, but also the GLOBAL user counters that other parallel
    // scenarios move. keepContext keeps the bar and blanks the counters instead.
    if (keepContext) {
      // Keep the breadcrumb, drop everything else the top bar carries: the
      // search box, the create menu and the user avatar all belong to the
      // SESSION, and their counters move whenever a parallel scenario opens a
      // merge request. Hiding by structure (every top-bar child that does not
      // contain the breadcrumb) survives GitLab moving its own test ids.
      const CRUMB = '[data-testid="breadcrumb-links"], nav[aria-label="Breadcrumb"], .gl-breadcrumbs, .breadcrumbs'
      ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
        document.querySelectorAll(sel).forEach(bar => {
          const crumb = bar.querySelector(CRUMB)
          if (!crumb) { bar.style.visibility = 'hidden'; return }
          Array.from(bar.children).forEach(child => {
            if (!child.contains(crumb)) child.style.visibility = 'hidden'
          })
        })
      })
    } else {
      ;['header', '.super-topbar', '[data-testid="top-bar"]', 'nav.navbar'].forEach(sel => {
        const n = document.querySelector(sel)
        if (n) n.style.visibility = 'hidden'
      })
    }

    // Action buttons (retry/cancel) on the job graph: controls, not proof,
    // and their icon rendering drifts between environments.
    document.querySelectorAll('[data-testid*="retry"], [aria-label*="Retry"], [aria-label*="Run again"], button.retry').forEach(el => {
      el.style.visibility = 'hidden'
    })
    document.querySelectorAll('img').forEach(el => { el.style.visibility = 'hidden' })
    document.querySelectorAll('.gl-avatar, .avatar, [data-testid*="avatar"], [class*="avatar"]').forEach(el => {
      el.style.visibility = 'hidden'
    })
    document.querySelectorAll('time, .js-timeago').forEach(el => { el.textContent = PLACEHOLDER })

    // Leaf text nodes that carry a volatile value (id/duration/sha/date).
    document.querySelectorAll('a, span, strong, li, b, td, div, code, small').forEach(el => {
      if (el.children.length !== 0) return
      const text = el.textContent.trim()
      if (VOLATILE_RE.some(re => re.test(text))) el.textContent = PLACEHOLDER
    })

    // Durations embedded in composed sentences ("8 minutes 4 seconds, queued
    // for 51 seconds") never equal a whole leaf — substitute them in place.
    const SUBSTITUTE_RE = [
      /\d+ minutes? \d+ seconds?/g,
      /queued for \d+ (seconds?|minutes?)/g,
      // A duration that lands on a round minute renders as "1 minute," with no
      // seconds part, which the pair above cannot match — it drifted a
      // @release-window baseline by 0.0177%. Keep this AFTER the pair so a
      // "8 minutes 4 seconds" is still replaced in one go.
      /\b\d+ minutes?\b/g,
      /\b\d+ seconds?\b/g,
      /\b\d{2}:\d{2}:\d{2}\b/g, //          duration clock (00:01:16) in mixed nodes
      // The job page names the runner that took the job: "#113 (7ulK8s5G) null".
      // Both the id and the short token are new on every registration.
      /#\d+ \([^)]*\)(\s+null)?/g
    ]
    const subWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const subNodes = []
    while (subWalker.nextNode()) subNodes.push(subWalker.currentNode)
    subNodes.forEach(n => {
      let v = n.nodeValue
      SUBSTITUTE_RE.forEach(re => { v = v.replace(re, PLACEHOLDER) })
      if (v !== n.nodeValue) n.nodeValue = v
    })

    // The per-run random project name, wherever it appears (breadcrumb, title).
    // A story whose project name is FIXED keeps it: the reader sees the real
    // project, and the two page kinds of one storyboard stay consistent.
    if (keepContext) return
    const NAME_RE = projectName
      ? new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : /e2e-journey-[0-9a-f]+/g
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    textNodes.forEach(n => {
      if (NAME_RE.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(NAME_RE, 'project')
    })
  }, { projectName, keepContext })
  await I.moveCursorTo('body', 1, 1)
  await I.wait(0.5)
}

module.exports = {
  RUNNER_TAG,
  RUNNER_NET,
  PIPELINE_TIMEOUT_MS,
  registerScopedRunner,
  teardownScopedRunner,
  cancelRedundantPipelines,
  waitMergeRequestPipeline,
  waitRefPipeline,
  dumpFailedTraces,
  maskPipelinePage
}
