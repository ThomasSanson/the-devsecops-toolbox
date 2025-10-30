# Support Multi-Stack du Plugin DevSecOps

## Vue d'ensemble

Le plugin DevSecOps supporte maintenant **plusieurs stacks technologiques** grâce à un système de configuration conditionnelle basé sur Copier.

### Stacks supportées

| Stack | Code | Description | Exemple d'usage |
|-------|------|-------------|-----------------|
| **Ansible** | `ansible` | Collections, Roles, Playbooks | Automation, IaC |
| **Python** | `python` | Packages, Applications, APIs, CLIs | Libraries, Web apps |
| **Node.js** | `nodejs` | Applications, APIs, Libraries | Web services, Tools |
| **Go** | `golang` | Applications, CLIs, Services | Microservices, Tools |
| **Java** | `java` | Applications, Services | Enterprise apps |
| **Rust** | `rust` | Applications, Libraries | Performance-critical apps |
| **.NET** | `dotnet` | Applications, Services | Enterprise apps |
| **Container** | `container` | Docker images standalone | Container-only projects |
| **Static Site** | `static-site` | HTML/CSS/JS sites | Documentation, Landing pages |
| **Other** | `other` | Custom stack | Custom requirements |

## Architecture

### Configuration universelle

Les éléments suivants sont **identiques pour toutes les stacks** :

```yaml
# DevSecOps Stages (9 stages universels)
stages_plan_enabled: true
stages_code_enabled: true
stages_build_enabled: true
stages_test_enabled: true
stages_release_enabled: true
stages_deploy_enabled: true
stages_operate_enabled: false
stages_monitor_enabled: false
stages_feedback_enabled: false

# Code Tools (universels)
code_gitleaks_enabled: true
code_commitizen_enabled: true
code_commitlint_enabled: true
code_megalinter_enabled: true
code_lizard_enabled: true
code_renovate_enabled: true

# Build (universels)
build_docker_enabled: true
build_coverage_check_enabled: true

# Test génériques
test_unit_enabled: true
test_integration_enabled: true
test_e2e_enabled: false

# Runner (universel)
runner_container_image: registry.gitlab.com/...
runner_docker_socket: true
```

### Configuration conditionnelle par stack

Chaque stack a ses **outils spécifiques** qui n'apparaissent que pour cette stack :

#### Ansible

```yaml
stack_type: ansible
ansible_type: collection  # collection | role | playbook

# Tests Ansible
test_molecule_enabled: true
test_molecule_prefer_virtualenv: true
test_matrix_java_versions: ["17", "21"]
test_matrix_scenarios: ["default"]

# Déploiement Ansible
deploy_galaxy_enabled: true
deploy_galaxy_token_env: ANSIBLE_GALAXY_TOKEN
```

**Génère dans `.env.devsecops`** :

```bash
PROJECT_STACK_TYPE=ansible
PROJECT_ANSIBLE_TYPE=collection
TASK_MOLECULE_ENABLED=true
TASK_DEPLOY_GALAXY_ENABLED=true
```

**Génère dans `.gitlab-ci.yml`** :

```yaml
molecule:test:matrix:
  parallel:
    matrix:
      - JAVA_VERSION: ["17", "21"]
        MOLECULE_SCENARIO: ["default"]
```

#### Python

```yaml
stack_type: python
python_type: package  # package | application | api | cli

# Tests Python
test_pytest_enabled: true
test_coverage_threshold: "80"

# Déploiement Python
deploy_pypi_enabled: true
deploy_pypi_repository: pypi  # pypi | testpypi
```

**Génère dans `.env.devsecops`** :

```bash
PROJECT_STACK_TYPE=python
PROJECT_PYTHON_TYPE=package
TASK_PYTEST_ENABLED=true
TASK_COVERAGE_THRESHOLD=80
TASK_DEPLOY_PYPI_ENABLED=true
TASK_DEPLOY_PYPI_REPOSITORY=pypi
```

#### Node.js

```yaml
stack_type: nodejs

# Tests Node.js
test_jest_enabled: true

# Déploiement Node.js
deploy_npm_enabled: true  # Pour packages NPM
# OU
deploy_registry_enabled: true  # Pour containers d'APIs
```

**Génère dans `.env.devsecops`** :

```bash
PROJECT_STACK_TYPE=nodejs
TASK_JEST_ENABLED=true
TASK_DEPLOY_NPM_ENABLED=true
```

## Exemples de configuration

### Exemple 1 : Ansible Collection (votre cas)

```bash
# Utiliser l'exemple Ansible
cp .config/devsecops/.copier-answers.yml.example .config/devsecops/.copier-answers.yml

# Modifier si nécessaire
vim .config/devsecops/.copier-answers.yml

# Générer
copier update --force
```

**Configuration** :

```yaml
stack_type: ansible
ansible_type: collection
test_molecule_enabled: true
test_matrix_java_versions: ["17", "21"]
test_matrix_scenarios: ["default", "ha"]
deploy_galaxy_enabled: true
```

**Résultat** : CI/CD complète avec matrice Molecule et déploiement Galaxy.

### Exemple 2 : Python Package

```bash
# Utiliser l'exemple Python
cp .config/devsecops/.copier-answers.yml.example-python .config/devsecops/.copier-answers.yml

# Générer
copier update --force
```

**Configuration** :

```yaml
stack_type: python
python_type: package
test_pytest_enabled: true
test_coverage_threshold: "80"
deploy_pypi_enabled: true
deploy_pypi_repository: testpypi
build_docker_enabled: false  # Pas de container pour package
```

**Résultat** : CI/CD avec pytest, coverage, et déploiement PyPI.

### Exemple 3 : Node.js API

```bash
# Utiliser l'exemple Node.js
cp .config/devsecops/.copier-answers.yml.example-nodejs .config/devsecops/.copier-answers.yml

# Générer
copier update --force
```

**Configuration** :

```yaml
stack_type: nodejs
test_jest_enabled: true
test_e2e_enabled: true
build_docker_enabled: true
deploy_registry_enabled: true
deploy_npm_enabled: false  # API, pas package NPM
```

**Résultat** : CI/CD avec Jest, tests e2e, build Docker et déploiement registry.

## Ajouter une nouvelle stack

### 1. Ajouter le type de stack dans `copier.yml`

```yaml
stack_type:
  type: str
  default: ansible
  help: Technology stack for your project
  choices:
    - ansible
    - python
    - nodejs
    - golang
    - java
    - dotnet
    - rust
    - container
    - static-site
    - ruby        # ← NOUVEAU
    - other
```

### 2. Ajouter les questions spécifiques (optionnel)

```yaml
# Ruby-specific sub-type
ruby_type:
  type: str
  default: gem
  help: Type of Ruby project
  choices:
    - gem
    - rails
    - sinatra
  when: "{{ stack_type == 'ruby' }}"

# Ruby-Specific Test Configuration
test_rspec_enabled:
  type: bool
  default: true
  help: Enable RSpec for Ruby projects
  when: "{{ stages_test_enabled and stack_type == 'ruby' }}"

# Ruby-Specific Deploy Configuration
deploy_rubygems_enabled:
  type: bool
  default: false
  help: Enable deployment to RubyGems.org
  when: "{{ stages_deploy_enabled and stack_type == 'ruby' }}"
```

### 3. Mettre à jour `.env.devsecops.jinja`

```jinja
{% if stack_type == 'ruby' and test_rspec_enabled -%}
# Ruby RSpec Configuration
TASK_RSPEC_ENABLED={{ test_rspec_enabled | lower }}
{% endif %}

{% if stack_type == 'ruby' and deploy_rubygems_enabled -%}
# Ruby RubyGems Configuration
TASK_DEPLOY_RUBYGEMS_ENABLED={{ deploy_rubygems_enabled | lower }}
{% endif %}
```

### 4. Créer un exemple de configuration

```bash
cat > .config/devsecops/.copier-answers.yml.example-ruby << 'EOF'
# Ruby Gem Example
stack_type: ruby
ruby_type: gem
test_rspec_enabled: true
deploy_rubygems_enabled: true
# ...
EOF
```

## Déploiement universel : Container Registry

Toutes les stacks peuvent utiliser le **déploiement vers Container Registry** :

```yaml
deploy_registry_enabled: true
deploy_registry_type: gitlab  # gitlab | docker | github | artifactory | harbor | ecr
deploy_registry_auth: true
deploy_registry_project_id: "12345"  # GitLab specific
```

Ceci permet de déployer des images Docker quel que soit le langage :

- **Ansible** : Image avec collection + dépendances
- **Python** : Image avec app + dépendances
- **Node.js** : Image avec API
- **Go** : Image avec binaire compilé
- **Java** : Image avec JAR/WAR

## Tests génériques

Toutes les stacks ont accès aux **tests génériques** :

```yaml
test_unit_enabled: true          # Tests unitaires
test_integration_enabled: true   # Tests d'intégration
test_e2e_enabled: false          # Tests end-to-end
```

Chaque stack peut implémenter ces types de tests avec ses propres outils :

| Stack | Outil unit | Outil integration | Outil e2e |
|-------|-----------|-------------------|-----------|
| Ansible | molecule | molecule | molecule |
| Python | pytest | pytest | pytest + selenium |
| Node.js | jest | jest | jest + puppeteer |
| Go | go test | go test | go test |
| Java | JUnit | TestNG | Selenium |

## Bonnes pratiques

### ✅ DO

- **Choisir la stack appropriée** dès le début du projet
- **Utiliser les exemples** comme point de départ
- **Activer uniquement les outils pertinents** pour votre stack
- **Documenter les choix** dans le README du projet
- **Tester localement** avant de commit

### ❌ DON'T

- **Ne pas mélanger** les outils de stacks différentes sans raison
- **Ne pas activer** tous les outils "au cas où"
- **Ne pas oublier** de désactiver Docker si non nécessaire
- **Ne pas utiliser** `stack_type: other` si une stack spécifique existe

## Migration entre stacks

Si vous devez changer de stack (rare mais possible) :

```bash
# 1. Sauvegarder l'ancienne config
cp .config/devsecops/.copier-answers.yml .config/devsecops/.copier-answers.yml.backup

# 2. Modifier le stack_type
vim .config/devsecops/.copier-answers.yml
# Changer: stack_type: ansible → stack_type: python

# 3. Régénérer
copier update --force

# 4. Vérifier les changements
git diff .env.devsecops .gitlab-ci.yml

# 5. Adapter le code du projet
# (Les Taskfiles devront être adaptés pour la nouvelle stack)
```

## Conclusion

Le système multi-stack offre :

- ✅ **Flexibilité** : Support de multiples langages et frameworks
- ✅ **Simplicité** : Configuration conditionnelle automatique
- ✅ **Extensibilité** : Facile d'ajouter de nouvelles stacks
- ✅ **Maintenabilité** : Une seule source de vérité (answers)
- ✅ **Reproductibilité** : Configuration versionnable

Pour toute question ou ajout de stack, consultez [COPIER-FIRST.md](COPIER-FIRST.md).
