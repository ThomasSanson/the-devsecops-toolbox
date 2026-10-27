/* global inject Given Then After */
const { I, GitLabUserPage } = inject()
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { gitlabFrame, gitlabUrl } = require('../helpers/gitlabCard')
const { assertPipelineGraphIds } = require('../helpers/deployOnlyGraphFixture')
const fixture = require('../helpers/deployOnlyReleaseFixture')
let state

After(async test => {
  if (!test?.tags?.includes('@deploy-only-release-order')) return
  await fixture.teardown(state)
  state = null
})

async function card (name, pipeline) {
  await assertPipelineGraphIds(state.pub, pipeline.id)
  await gitlabFrame(I, name, gitlabUrl.pipeline(state.pub.projectName, pipeline.id), {
    projectNames: [state.pub.projectName], waitText: 'release', height: 950
  })
}

storyboardStep(Given, 'a default branch pipeline with independent plan and release runners', async () => {
  state = await fixture.setup()
  await GitLabUserPage.loginAs(process.env.TASK_GITLAB_LAMBDA_USER, process.env.TASK_GITLAB_LAMBDA_PASSWORD)
  await fixture.held(state, state.pipeline)
  await card('release-waits', state.pipeline)
})

storyboardStep(Then, 'release advances the branch only after plan succeeds', async () => {
  await fixture.finish(state, state.pipeline, 0)
  await fixture.obsoletePlan(state, state.pipeline.sha)
  await card('plan-succeeded', state.pipeline)
})

storyboardStep(Then, 'release also runs after plan fails without hiding that failure', async () => {
  state.failed = await fixture.trigger(state)
  await fixture.held(state, state.failed)
  await fixture.finish(state, state.failed, 1)
  await card('plan-failed', state.failed)
})

storyboardStep(Then, 'release keeps its behavior for merge requests without plan and staging tags', async () => {
  const pipeline = await fixture.withoutPlan(state)
  await fixture.staging(state)
  await card('release-without-plan', pipeline)
})

storyboardStep(Then, 'web and scheduled pipelines wait too and concurrent plans are serialized', async () => {
  const web = await fixture.web(state)
  await fixture.held(state, web)
  await fixture.serialization(state, web)
  for (const flag of ['RUN_ALL_SCHEDULE', 'RUN_RELEASE_SCHEDULE']) {
    const scheduled = await fixture.scheduled(state, flag)
    await fixture.held(state, scheduled)
    await fixture.finish(state, scheduled, 0)
    state.scheduled = scheduled
  }
  await card('scheduled-release', state.scheduled)
})
