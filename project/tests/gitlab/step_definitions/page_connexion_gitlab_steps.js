/* global inject When Then */
const { GitLabLoginPage } = inject()

// ============================================
// WHEN - Actions connexion GitLab
// ============================================

When('je me connecte à GitLab avec les identifiants root', () => {
  GitLabLoginPage.navigateTo()
  GitLabLoginPage.login(process.env.TASK_GITLAB_ROOT_USER, process.env.TASK_GITLAB_ROOT_PASSWORD)
})

// ============================================
// THEN - Vérifications connexion GitLab
// ============================================

Then('le tableau de bord GitLab est affiché', () => {
  GitLabLoginPage.verifyDashboard()
})

Then('la page du tableau de bord GitLab correspond à la référence visuelle', () => {
  GitLabLoginPage.verifyVisualRegression()
})
