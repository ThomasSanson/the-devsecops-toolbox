# Configuration Copier-First du Plugin DevSecOps

## Vue d'ensemble

Ce plugin DevSecOps utilise une approche **Copier-first** où le fichier `copier.yml` et ses réponses (answers) constituent la **source unique de vérité** pour toute la configuration du projet.

### Principes clés

1. **Copier answers pilote tout** : Les 9 stages DevSecOps, les outils, et la CI/CD
2. **Génération automatique** : `.env.devsecops` et `.gitlab-ci.yml` sont générés à partir des answers
3. **Taskfile consomme** : Les Taskfiles lisent `.env.devsecops` via dotenv pour activer/désactiver les tâches
4. **Aucune dépendance externe** : Pas de JSON Schema, CLI additionnelle ou complexité inutile
5. **Configuration simple** : Modifier les answers suffit à tout reconfigurer

> **Note** : Un CLI sera développé au-dessus de ce système pour faciliter la gestion, mais le système Copier reste la fondation.

## Architecture du système

```text
copier.yml (questions)
    ↓
.config/devsecops/.copier-answers.yml (réponses)
    ↓
    ├→ .env.devsecops.jinja → .env.devsecops
    │       ↓
    │   Taskfile.yml (dotenv: [".env.devsecops", ...])
    │       ↓
    │   TASK_*_ENABLED variables
    │
    └→ .gitlab-ci.yml.jinja → .gitlab-ci.yml
            ↓
        Includes conditionnels + matrice Molecule
```

## Configuration des stages DevSecOps

### 1. Les 9 stages disponibles

Chaque stage peut être activé/désactivé individuellement :

| Stage | Variable Copier | Variable ENV | Description |
|-------|----------------|--------------|-------------|
| **Plan** | `stages_plan_enabled` | `TASK_DEVSECOPS_PLAN_ENABLED` | Planification et design |
| **Code** | `stages_code_enabled` | `TASK_DEVSECOPS_CODE_ENABLED` | Qualité et sécurité du code |
| **Build** | `stages_build_enabled` | `TASK_DEVSECOPS_BUILD_ENABLED` | Compilation et packaging |
| **Test** | `stages_test_enabled` | `TASK_DEVSECOPS_TEST_ENABLED` | Tests unitaires, intégration, e2e |
| **Release** | `stages_release_enabled` | `TASK_DEVSECOPS_RELEASE_ENABLED` | Versioning et changelog |
| **Deploy** | `stages_deploy_enabled` | `TASK_DEVSECOPS_DEPLOY_ENABLED` | Déploiement vers registries |
| **Operate** | `stages_operate_enabled` | `TASK_DEVSECOPS_OPERATE_ENABLED` | Tâches opérationnelles |
| **Monitor** | `stages_monitor_enabled` | `TASK_DEVSECOPS_MONITOR_ENABLED` | Monitoring et observabilité |
| **Feedback** | `stages_feedback_enabled` | `TASK_DEVSECOPS_FEEDBACK_ENABLED` | Métriques et amélioration continue |

### 2. Outils du stage Code

Ces outils ne sont actifs que si `stages_code_enabled: true` :

| Outil | Variable Copier | Variable ENV |
|-------|----------------|-------------|
| **Gitleaks** | `code_gitleaks_enabled` | `TASK_GITLEAKS_ENABLED` |
| **Commitizen** | `code_commitizen_enabled` | `TASK_COMMITIZEN_ENABLED` |
| **Commitlint** | `code_commitlint_enabled` | `TASK_COMMITLINT_ENABLED` |
| **MegaLinter** | `code_megalinter_enabled` | `TASK_MEGALINTER_ENABLED` |
| **Lizard** | `code_lizard_enabled` | `TASK_LIZARD_ENABLED` |
| **Renovate** | `code_renovate_enabled` | `TASK_RENOVATE_ENABLED` |

### 3. Configuration Molecule

La matrice de test Molecule est entièrement configurable :

```yaml
test_molecule_enabled: true
test_molecule_prefer_virtualenv: true
test_matrix_java_versions:
  - "17"
  - "21"
test_matrix_scenarios:
  - default
  - custom-scenario
```

Ceci génère automatiquement une matrice dans `.gitlab-ci.yml` :

```yaml
molecule:test:matrix:
  parallel:
    matrix:
      - JAVA_VERSION: ["17", "21"]
        MOLECULE_SCENARIO: ["default", "custom-scenario"]
```

**Résultat** : 4 jobs parallèles (2 versions Java × 2 scénarios)

### 4. Configuration du Runner

```yaml
runner_container_image: registry.gitlab.com/digital-commons/devsecops/tools/the-devsecops-plugin:14.1.6
runner_docker_socket: true
runner_proxies_from_env: false
runner_cache_enabled: true
runner_artifacts_enabled: true
```

Génère dans `.env.devsecops` :

```bash
DEVSECOPS_IMAGE=registry.gitlab.com/digital-commons/devsecops/tools/the-devsecops-plugin:14.1.6
DOCKER_SOCK=true
RUNNER_PROXIES_FROM_ENV=false
RUNNER_CACHE_ENABLED=true
RUNNER_ARTIFACTS_ENABLED=true
```

### 5. Configuration du déploiement

#### Ansible Galaxy

```yaml
deploy_galaxy_enabled: true
deploy_galaxy_token_env: ANSIBLE_GALAXY_TOKEN
```

#### Container/Package Registry

```yaml
deploy_registry_enabled: true
deploy_registry_type: gitlab  # gitlab | docker | github | artifactory
deploy_registry_auth: true
deploy_registry_project_id: "12345"  # Pour GitLab uniquement
```

## Utilisation

### Première initialisation

1. **Créer ou mettre à jour le projet avec Copier** :

   ```bash
   copier copy . /chemin/vers/nouveau-projet
   # OU pour mettre à jour
   copier update
   ```

2. **Répondre aux questions interactives** :
   - Copier vous demandera pour chaque variable définie dans `copier.yml`
   - Les réponses sont sauvegardées dans `.config/devsecops/.copier-answers.yml`

3. **Vérifier les fichiers générés** :
   - `.env.devsecops` : Variables d'environnement pour Task
   - `.gitlab-ci.yml` : Configuration CI/CD avec stages conditionnels

### Modifier la configuration

#### Option 1 : Mise à jour interactive

```bash
copier update
```

Copier vous repose les questions et met à jour les fichiers générés.

#### Option 2 : Édition manuelle du fichier answers

1. **Éditer** `.config/devsecops/.copier-answers.yml` :

   ```yaml
   # Désactiver le stage Monitor
   stages_monitor_enabled: false
   
   # Changer les versions Java pour les tests
   test_matrix_java_versions:
     - "17"
     - "21"
     - "23"
   
   # Ajouter un scénario Molecule
   test_matrix_scenarios:
     - default
     - ha-cluster
     - minimal
   ```

2. **Régénérer les fichiers** :

   ```bash
   task devsecops:code:sync-templates
   # OU directement
   copier update --force
   ```

3. **Vérifier les changements** :
   - `.env.devsecops` est mis à jour avec `TASK_DEVSECOPS_MONITOR_ENABLED=false`
   - `.gitlab-ci.yml` n'inclut plus `monitor.yml`
   - La matrice Molecule a maintenant 9 jobs (3 Java × 3 scénarios)

### Profils disponibles

```yaml
profile: ansible-collection  # ansible-collection | ansible-role | python-package | container-image
```

Le profil influence :

- Les outils activés par défaut
- Les options de déploiement disponibles
- La structure de projet générée

## Exemples de configuration

### Exemple 1 : Projet Ansible Collection complet

```yaml
# .config/devsecops/.copier-answers.yml
profile: ansible-collection

# Tous les stages activés
stages_plan_enabled: true
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
stages_release_enabled: true
stages_deploy_enabled: true
stages_operate_enabled: true
stages_monitor_enabled: true
stages_feedback_enabled: true

# Tous les outils de code activés
code_gitleaks_enabled: true
code_commitizen_enabled: true
code_commitlint_enabled: true
code_megalinter_enabled: true
code_lizard_enabled: true
code_renovate_enabled: true

# Molecule avec matrice étendue
test_molecule_enabled: true
test_molecule_prefer_virtualenv: true
test_matrix_java_versions: ["17", "21"]
test_matrix_scenarios: ["default", "ha"]

# Déploiement vers Galaxy
deploy_galaxy_enabled: true
deploy_galaxy_token_env: ANSIBLE_GALAXY_TOKEN
```

### Exemple 2 : Projet minimal pour CI rapide

```yaml
# .config/devsecops/.copier-answers.yml
profile: ansible-role

# Stages essentiels seulement
stages_plan_enabled: false
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
stages_release_enabled: false
stages_deploy_enabled: false
stages_operate_enabled: false
stages_monitor_enabled: false
stages_feedback_enabled: false

# Outils de code minimalistes
code_gitleaks_enabled: true
code_commitizen_enabled: false
code_commitlint_enabled: true
code_megalinter_enabled: false
code_lizard_enabled: false
code_renovate_enabled: false

# Molecule simple
test_molecule_enabled: true
test_matrix_java_versions: ["17"]
test_matrix_scenarios: ["default"]
```

### Exemple 3 : Container image avec Registry privé

```yaml
# .config/devsecops/.copier-answers.yml
profile: container-image

stages_plan_enabled: false
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
stages_release_enabled: true
stages_deploy_enabled: true
stages_operate_enabled: false
stages_monitor_enabled: false
stages_feedback_enabled: false

# Build Docker
build_docker_enabled: true

# Déploiement vers registry privé
deploy_galaxy_enabled: false
deploy_registry_enabled: true
deploy_registry_type: gitlab
deploy_registry_auth: true
deploy_registry_project_id: "12345"
```

## Variables générées

### Dans .env.devsecops

Toutes les variables sont automatiquement générées à partir des answers :

```bash
# Stages
TASK_DEVSECOPS_PLAN_ENABLED=true
TASK_DEVSECOPS_CODE_ENABLED=true
# ... etc

# Outils
TASK_GITLEAKS_ENABLED=true
TASK_COMMITIZEN_ENABLED=true
# ... etc

# Runner
DEVSECOPS_IMAGE=registry.gitlab.com/...
DOCKER_SOCK=true

# Metadata
PROJECT_NAME=my-project
PROJECT_VERSION=0.1.0
PROJECT_PROFILE=ansible-collection
```

### Dans .gitlab-ci.yml

```yaml
image: {{ runner_container_image }}

include:
  # Base (toujours)
  - local: .config/gitlab/ci/before_script.yml
  # ...
  
  # Stages (conditionnels)
  {% if stages_code_enabled %}
  - local: .config/gitlab/ci/devsecops/code.yml
  {% endif %}
  # ...

# Matrice Molecule (si activée)
{% if test_molecule_enabled %}
molecule:test:matrix:
  parallel:
    matrix:
      - JAVA_VERSION: {{ test_matrix_java_versions | tojson }}
        MOLECULE_SCENARIO: {{ test_matrix_scenarios | tojson }}
{% endif %}
```

## Commandes utiles

### Synchroniser les templates

```bash
# Via Task (recommandé)
task devsecops:code:sync-templates

# Via Copier directement
copier update --force
```

### Vérifier la configuration actuelle

```bash
# Voir les variables d'environnement chargées
cat .env.devsecops

# Voir les answers Copier
cat .config/devsecops/.copier-answers.yml

# Tester qu'une tâche est activée
task --dry devsecops:code
```

### Réinitialiser à la configuration par défaut

```bash
# Supprimer les answers et régénérer
rm .config/devsecops/.copier-answers.yml
copier update
```

## Extensibilité

### Ajouter un nouveau stage

1. **Ajouter dans `copier.yml`** :

   ```yaml
   stages_security_enabled:
     type: bool
     default: true
     help: Enable Security stage (security scanning and auditing)
   ```

2. **Ajouter dans `.env.devsecops.jinja`** :

   ```jinja
   TASK_DEVSECOPS_SECURITY_ENABLED={{ stages_security_enabled | lower }}
   ```

3. **Ajouter dans `.gitlab-ci.yml.jinja`** :

   ```jinja
   {% if stages_security_enabled %}
   - local: .config/gitlab/ci/devsecops/security.yml
   {% endif %}
   ```

4. **Créer le Taskfile** : `.config/devsecops/Taskfile.security.yml`

5. **Créer le fichier CI** : `.config/gitlab/ci/devsecops/security.yml`

### Ajouter un nouvel outil

1. **Ajouter dans `copier.yml`** :

   ```yaml
   code_trivy_enabled:
     type: bool
     default: true
     help: Enable Trivy for vulnerability scanning
     when: "{{ stages_code_enabled }}"
   ```

2. **Ajouter dans `.env.devsecops.jinja`** :

   ```jinja
   TASK_TRIVY_ENABLED={{ code_trivy_enabled | lower }}
   ```

3. **Créer le Taskfile** : `.config/trivy/Taskfile.yml`

4. **Référencer dans le stage Code** : `.config/devsecops/Taskfile.code.yml`

## Bonnes pratiques

### ✅ DO

- **Versionner** `.config/devsecops/.copier-answers.yml`
- **Ignorer** `.env.devsecops` (généré)
- **Utiliser** `task devsecops:code:sync-templates` après modification des answers
- **Documenter** les valeurs spécifiques au projet dans le README
- **Tester** après chaque modification de configuration

### ❌ DON'T

- **Ne pas éditer** `.env.devsecops` manuellement
- **Ne pas éditer** `.gitlab-ci.yml` si généré par template
- **Ne pas versionner** `.env.devsecops`
- **Ne pas dupliquer** la configuration entre answers et fichiers manuels
- **Ne pas contourner** Copier pour la configuration

## Dépannage

### Les variables ne sont pas chargées

```bash
# Vérifier que .env.devsecops existe
ls -la .env.devsecops

# Régénérer si nécessaire
task devsecops:code:sync-templates

# Vérifier l'ordre de chargement dotenv dans Taskfile.yml
grep "dotenv:" Taskfile.yml
# Doit afficher: dotenv: [".env.devsecops", ".env", ".env.dev", ".env.dist"]
```

### La matrice Molecule ne se génère pas

```bash
# Vérifier les answers
grep -A5 "test_matrix" .config/devsecops/.copier-answers.yml

# Les listes doivent être au format YAML:
test_matrix_java_versions:
  - "17"
  - "21"
test_matrix_scenarios:
  - default

# Régénérer .gitlab-ci.yml
task devsecops:code:sync-templates
```

### Un stage reste actif alors qu'il est désactivé

```bash
# Vérifier .env.devsecops
grep "TASK_DEVSECOPS.*_ENABLED" .env.devsecops

# Vérifier que le Taskfile charge bien .env.devsecops
cat Taskfile.yml | grep dotenv

# Forcer la régénération
copier update --force
```

## Évolution future : CLI

Un CLI sera développé au-dessus de ce système pour :

- Faciliter la configuration interactive
- Valider les answers avant génération
- Proposer des presets de configuration
- Gérer les migrations de configuration
- Fournir des commandes de diagnostic

Le système Copier restera la fondation technique, tandis que le CLI offrira une expérience utilisateur améliorée.

## Conclusion

Ce système Copier-first offre :

- ✅ **Simplicité** : Une seule source de vérité (answers)
- ✅ **Reproductibilité** : Configuration versionnable et partageable
- ✅ **Flexibilité** : Activation/désactivation fine des stages et outils
- ✅ **Maintenabilité** : Pas de duplication, génération automatique
- ✅ **Extensibilité** : Facile d'ajouter de nouveaux stages/outils

Modifier la configuration est aussi simple que :

```bash
vim .config/devsecops/.copier-answers.yml
task devsecops:code:sync-templates
git commit -am "chore: update DevSecOps configuration"
```
