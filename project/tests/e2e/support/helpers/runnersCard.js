/* global document window MutationObserver */
/**
 * Settings > CI/CD of a project, its Runners section open and brought to the
 * top: the page where a maintainer sees which runners take the project's jobs.
 * Needs a logged-in maintainer.
 *
 *   await runnersFrame(I, 'project-runners', project, { waitText: 'Docker jobs' })
 *
 * The lambda user maintains every test project, so GitLab also offers it the
 * runners of the OTHER test projects ("Other available project runners"):
 * that list depends on whichever story runs next door, so it never reaches a
 * card. The runner ids and token prefixes, contact times and IP addresses are
 * new on every registration and go too.
 */
const { gitlabFrame, gitlabUrl, settlePage } = require('./gitlabCard')

const SECTION = '#js-runners-settings'
const RUNNER_MASKS = [
  [/#\d+ \([A-Za-z0-9_-]+\)/g, ''],
  [/^\s*\([A-Za-z0-9_-]{6,}\)\s*$/g, ''],
  [/\b\d{1,3}(\.\d{1,3}){3}\b/g, '']
]

async function runnersFrame (I, frameName, project, { waitText, height = 900, projectNames = null, textMasks = [] } = {}) {
  await gitlabFrame(I, frameName, gitlabUrl.ciSettings(project), {
    height,
    projectNames,
    textMasks: [...RUNNER_MASKS, ...textMasks],
    prepare: async () => {
      await I.waitForElement(SECTION, 60)
      const open = `${SECTION}.expanded`
      if (!await I.grabNumberOfVisibleElements(open)) await I.click('Expand', SECTION)
      await I.waitForElement(open, 30)
      if (waitText) await I.waitForText(waitText, 60, SECTION)
      // Only what THIS project chose: the runners other projects could lend
      // it are a neighbour's business, whatever their number. Its tab is
      // marked again whenever Vue redraws the tab list.
      await I.executeScript((section) => {
        const root = document.querySelector(section)
        const own = el => Array.from(el.childNodes).some(n => n.nodeType === 3 && /Other available project runners/.test(n.nodeValue))
        const hideOthers = () => Array.from(root.querySelectorAll('*')).filter(own).forEach(el => {
          const tab = el.closest('[role="tab"]')
          const target = tab ? (tab.closest('li') || tab) : el
          if (!target.hasAttribute('data-e2e-mask')) target.setAttribute('data-e2e-mask', '')
        })
        hideOthers()
        new MutationObserver(hideOthers).observe(root, { childList: true, subtree: true, characterData: true })
      }, SECTION)
    },
    scrollTo: async () => {
      await I.executeScript((section) => {
        window.scrollTo(0, 0)
        document.querySelector(section).scrollIntoView({ block: 'start' })
      }, SECTION)
      await settlePage(I, { quietMs: 300 })
    }
  })
}

module.exports = { runnersFrame }
