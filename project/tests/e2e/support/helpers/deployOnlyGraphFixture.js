const assert = require('assert/strict')
const fs = require('fs')
const { write } = require('./deployOnlyFixture')
const { publishToGitLab } = require('./gitlabProject')
const { BASE_URL, getPipeline, listProjectPipelines } = require('./gitlabApi')
const { freshGet, freshPost } = require('./http')

let primed = false
const PRIMER_JOBS = 32

async function primePipelineGraphIds () {
  if (primed) return
  // GitLab 19.4.2's DetailedStatus cache key omits the parent type. On a fresh
  // database a stage and a job can share it, exchanging their cancel actions.
  // Real disposable records separate pipeline/stage/job sequences (1/2/32).
  const dir = fs.mkdtempSync('/tmp/e2e-graph-ids-')
  let pub
  try {
    write(dir, '.gitlab-ci.yml', 'stages: [first, second]\n' +
      Array.from({ length: PRIMER_JOBS }, (_, index) =>
        `primer-${index}:\n  stage: ${index % 2 ? 'second' : 'first'}\n  script: 'true'\n`).join(''))
    pub = await publishToGitLab(dir, { project: { shared_runners_enabled: false } })
    const deadline = Date.now() + 120000
    do {
      const pipelines = await listProjectPipelines(pub.projectName, pub.headers)
      assert.equal(pipelines.status, 200)
      if (pipelines.data.length) {
        const jobs = await freshGet(`${BASE_URL}/api/v4/projects/${pub.projectId}/pipelines/${pipelines.data[0].id}/jobs?per_page=100`, pub.headers)
        assert.equal(jobs.status, 200)
        if (jobs.data.length === PRIMER_JOBS) {
          primed = true
          return
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    } while (Date.now() < deadline)
    throw new Error('The pipeline graph primer must create all disposable jobs')
  } finally {
    if (pub) await pub.teardown()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function assertPipelineGraphIds (pub, pipelineId) {
  const pipeline = await getPipeline(pub.projectName, pipelineId, pub.headers)
  assert.equal(pipeline.status, 200)
  const response = await freshPost(`${BASE_URL}/api/graphql`, {
    query: `query($path: ID!, $iid: ID!) {
      project(fullPath: $path) { pipeline(iid: $iid) {
        detailedStatus { id }
        stages { nodes { name detailedStatus { id } jobs { nodes { name detailedStatus { id } } } } }
      } }
    }`,
    variables: { path: `${process.env.TASK_GITLAB_LAMBDA_USER}/${pub.projectName}`, iid: String(pipeline.data.iid) }
  }, pub.headers)
  assert.equal(response.status, 200)
  assert.equal(response.data.errors, undefined, JSON.stringify(response.data.errors))
  const graph = response.data.data.project.pipeline
  assert.ok(graph.stages.nodes.length, 'The graph must contain real stages')
  const owners = new Map()
  const unique = (status, owner) => {
    assert.ok(status?.id, `${owner} must have a cache identity`)
    assert.ok(!owners.has(status.id), `GitLab graph cache collision: ${owner} and ${owners.get(status.id)} share ${status.id}`)
    owners.set(status.id, owner)
  }
  unique(graph.detailedStatus, 'pipeline')
  for (const stage of graph.stages.nodes) {
    unique(stage.detailedStatus, `stage ${stage.name}`)
    for (const job of stage.jobs.nodes) unique(job.detailedStatus, `job ${job.name}`)
  }
}

module.exports = { primePipelineGraphIds, assertPipelineGraphIds }
