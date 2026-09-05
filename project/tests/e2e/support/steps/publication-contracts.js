/* global inject Given Then After */
const assert = require('assert/strict')
const { preparePublicationContract, maskFixtureVolatility } = require('../helpers/publicationFixture')
const { renderPreFrame } = require('../helpers/capturedOutput')
const { storyboardStep } = require('../../../../../.config/codeceptjs/storyboard')
const { I } = inject()

const STORIES = [
  ['committed-bytes',
    'an approved source file with a local smudge filter',
    'export keeps the committed bytes despite the local smudge filter'],
  ['ignored-paths',
    'an approved tracked source file also matched by its ignore file',
    'publication includes every approved tracked path despite ignore rules'],
  ['option-path',
    'an approved source path whose directory starts with a dash',
    'export preserves a path that starts with a dash'],
  ['unsupported-symlink',
    'a candidate source entry that is a symbolic link',
    'the dry run names and rejects the symbolic link'],
  ['unsupported-lfs',
    'a candidate source file that contains an LFS pointer',
    'the dry run names and rejects the LFS pointer'],
  ['missing-floor',
    'a source commit missing the framework denylist',
    'the dry run refuses a missing framework denylist'],
  ['export-failure',
    'a Git blob reader that fails before scanning',
    'publication stops before scanning or pushing when export fails'],
  ['index-failure',
    'a Git blob reader that fails after a successful scan',
    'publication stops before pushing when a post-scan blob read fails'],
  ['disabled',
    'a publication explicitly disabled at runtime',
    'disabled publication neither contacts the forge nor creates a public commit'],
  ['manual-ci',
    'an automatic job environment configured for manual publication',
    'an automatic job does not publish in manual mode'],
  ['tag-ci',
    'a branch job environment configured for tag publication',
    'a branch job does not publish in tag mode'],
  ['offline-check',
    'a locally available source ready for an offline check',
    'the dry run succeeds without contacting the forge'],
  ['offline-missing-ref',
    'an offline check whose source ref is absent locally',
    'the dry run refuses the absent ref without fetching it'],
  ['unverified-scan',
    'a publication given an unsupported scan-done flag',
    'publication refuses a caller assertion that scanning is done'],
  ['unrelated-signoff',
    'an owner-resolved discussion unrelated to publication',
    'an unrelated discussion cannot approve publication'],
  ['stale-signoff',
    'an owner-resolved publication discussion for another manifest',
    'a stale manifest signature cannot approve publication'],
  ['edited-signoff',
    'a publication discussion edited after its owner resolved it',
    'an edited discussion refuses publication and requests a fresh owner decision'],
  ['approval-refresh',
    'an unchanged manifest with no publication sign-off',
    'approval can request an owner signature for the unchanged manifest'],
  ['api-failure',
    'an approval API that refuses every request',
    'approval reports failure when the forge refuses its request'],
  ['approval-thread-failure',
    'an approval API that refuses the sign-off thread',
    'approval reports failure when its sign-off thread cannot be created'],
  ['credentials-argv',
    'publication tools that record their process arguments',
    'publication keeps both credentials out of process arguments'],
  ['credential-url',
    'a publication target URL containing a fixture credential',
    'the dry run refuses the credential URL without printing its token'],
  ['init-token-failure',
    'setup whose replacement-token request is refused',
    'setup preserves the current token when its replacement fails'],
  ['init-variable-failure',
    'setup whose CI-variable update is refused',
    'setup preserves the working variable and token after an update failure'],
  ['init-settings',
    'setup started from an onboarding branch',
    'setup enables the discussion gate and schedules the default branch'],
  ['unchanged-release',
    'a first source release ready for repeated publication',
    'unchanged public bytes retain later releases without duplicating retries'],
  ['tag-conflict',
    'a first source release ready for a later public tag collision',
    'a conflicting public tag prevents the branch from moving'],
  ['late-tag',
    'an untagged source commit ready for publication',
    'a tag added later points to the existing public commit']
]

let pending

async function renderContractFrame (name, output) {
  // Chromium may change its fallback monospace font when capturing beyond the
  // viewport, after measuring the element. Keep the whole card in the viewport;
  // its screenshot still hugs the content. Eight-column tabs, 80-column wrapping
  // and 24px rows conservatively cover the shared renderer's 14px/1.4 text.
  const rows = output.split('\n').reduce((count, line) =>
    count + Math.max(1, Math.ceil(line.replace(/\t/g, '        ').length / 80)), 0)
  await renderPreFrame(I, name, output, { colour: true, height: Math.max(640, 32 + rows * 24) })
}

// Each Given pauses its own fixture immediately before its first task. Then
// resumes that same fixture, preserving the relationship between both cards.
for (const [name, preparation, outcome] of STORIES) {
  storyboardStep(Given, preparation, async () => {
    assert.equal(pending, undefined, 'The preceding publication contract has not completed')
    pending = { name, ...await preparePublicationContract(name) }
    const output = maskFixtureVolatility(pending.setup.output, pending.setup)
    await renderContractFrame('publication-contract-' + name + '-setup', output)
  })
  storyboardStep(Then, outcome, async () => {
    assert.equal(pending.name, name, 'The result belongs to another publication fixture')
    pending.resume()
    let result
    try {
      result = await pending.result
    } finally {
      pending = undefined
    }
    const output = maskFixtureVolatility(result.proof, result)
    await renderContractFrame('publication-contract-' + name, output)
  })
}

After(async () => {
  if (!pending) return
  const interrupted = new Error('The scenario stopped before executing its prepared publication')
  pending.cancel(interrupted)
  try {
    await pending.result
  } catch (error) {
    if (error !== interrupted) throw error
  } finally {
    pending = undefined
  }
})
