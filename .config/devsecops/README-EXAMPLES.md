# Exemples de Configuration Copier

Ce dossier contient plusieurs exemples de fichiers `.copier-answers.yml` pour différents types de projets et stacks technologiques.

## Fichiers d'exemple disponibles

### 1. `.copier-answers.yml.example` - Ansible (Stack unique)

Configuration pour un projet **Ansible pur** (collection, role ou playbook).

**Utilisation** :
```bash
cp .config/devsecops/.copier-answers.yml.example .config/devsecops/.copier-answers.yml
copier update --force
```

**Configuration** :
- Stack primaire : `ansible`
- Stacks additionnelles : Aucune
- Tests : Molecule avec matrice Java
- Déploiement : Ansible Galaxy

### 2. `.copier-answers.yml.example-python` - Python (Stack unique)

Configuration pour un projet **Python pur** (package, application, API ou CLI).

**Utilisation** :
```bash
cp .config/devsecops/.copier-answers.yml.example-python .config/devsecops/.copier-answers.yml
copier update --force
```

**Configuration** :
- Stack primaire : `python`
- Stacks additionnelles : Aucune
- Tests : pytest avec coverage
- Déploiement : PyPI

### 3. `.copier-answers.yml.example-nodejs` - Node.js (Stack unique)

Configuration pour un projet **Node.js pur** (application, API ou library).

**Utilisation** :
```bash
cp .config/devsecops/.copier-answers.yml.example-nodejs .config/devsecops/.copier-answers.yml
copier update --force
```

**Configuration** :
- Stack primaire : `nodejs`
- Stacks additionnelles : Aucune
- Tests : Jest
- Déploiement : Container Registry ou NPM

### 4. `.copier-answers.yml.example-multi-stack` - Multi-technos (Ansible + Python)

Configuration pour un projet **multi-technologie**.

**Cas d'usage** : Ansible Collection avec modules Python personnalisés et tests Python.

**Utilisation** :
```bash
cp .config/devsecops/.copier-answers.yml.example-multi-stack .config/devsecops/.copier-answers.yml
copier update --force
```

**Configuration** :
- Stack primaire : `ansible`
- Stacks additionnelles : `['python']`
- Tests : Molecule **ET** pytest
- Déploiement : Galaxy **ET** Container Registry

## Comment utiliser le support multi-stack

### Concept

Le système supporte **une stack primaire** et **des stacks additionnelles** :

```yaml
stack_primary: ansible     # Stack principale du projet
stack_additional:          # Stacks secondaires (liste YAML)
  - python                 # Python utilisé pour modules/tests
  - nodejs                 # Node.js utilisé pour frontend/outils
```

### Comportement

Lorsque vous activez plusieurs stacks :

1. **Les outils universels** restent actifs (Gitleaks, Commitizen, MegaLinter, etc.)
2. **Les outils spécifiques** de chaque stack sont activés automatiquement
3. **Les tests** de toutes les stacks sont configurés
4. **Le déploiement** peut cibler plusieurs destinations

### Exemples de combinaisons

#### Ansible + Python

Cas d'usage : Collection Ansible avec modules Python.

```yaml
stack_primary: ansible
stack_additional: ['python']

# Active automatiquement :
# - Molecule (Ansible)
# - pytest (Python)
# - Galaxy deploy (Ansible)
# - Container Registry (les deux)
```

#### Python + Node.js

Cas d'usage : API Python avec frontend Node.js.

```yaml
stack_primary: python
stack_additional: ['nodejs']

# Active automatiquement :
# - pytest (Python)
# - Jest (Node.js)
# - PyPI deploy (Python)
# - NPM deploy (Node.js optionnel)
```

#### Go + Python

Cas d'usage : Service Go avec scripts Python pour ops/tooling.

```yaml
stack_primary: golang
stack_additional: ['python']

# Active automatiquement :
# - go test (Go)
# - pytest (Python pour scripts)
# - Container Registry (Go API)
```

### Configuration générée

Le fichier `.env.devsecops` contiendra les variables pour **toutes** les stacks activées :

```bash
# Stack info
PROJECT_STACK_PRIMARY=ansible
PROJECT_STACK_ADDITIONAL=python

# Ansible
TASK_MOLECULE_ENABLED=true
PROJECT_ANSIBLE_TYPE=collection

# Python
TASK_PYTEST_ENABLED=true
PROJECT_PYTHON_TYPE=package

# Déploiement multi-cible
TASK_DEPLOY_GALAXY_ENABLED=true
TASK_DEPLOY_REGISTRY_ENABLED=true
```

## Créer votre propre exemple

1. **Partir d'un exemple existant** :
   ```bash
   cp .config/devsecops/.copier-answers.yml.example .config/devsecops/.copier-answers.yml
   ```

2. **Personnaliser** :
   - Changer `project_name`, `project_version`, etc.
   - Ajuster `stack_primary` et `stack_additional`
   - Activer/désactiver les stages DevSecOps
   - Configurer les outils spécifiques

3. **Générer** :
   ```bash
   copier update --force
   ```

4. **Vérifier** :
   ```bash
   cat .env.devsecops      # Vérifier les variables générées
   cat .gitlab-ci.yml      # Vérifier la CI générée
   ```

## Cas d'usage courants

| Projet | stack_primary | stack_additional | Tests | Deploy |
|--------|---------------|------------------|-------|--------|
| Ansible Collection | `ansible` | `[]` | Molecule | Galaxy |
| Ansible + Python modules | `ansible` | `['python']` | Molecule + pytest | Galaxy |
| Python Package | `python` | `[]` | pytest | PyPI |
| Python API | `python` | `[]` | pytest | Container |
| Node.js API | `nodejs` | `[]` | Jest | Container |
| Full-stack (Backend + Frontend) | `python` | `['nodejs']` | pytest + Jest | Multi |
| Go Service + Python ops | `golang` | `['python']` | go test + pytest | Container |
| Container-only | `container` | `[]` | Generic | Registry |

## Support

Pour plus d'informations :
- [COPIER-FIRST.md](../../docs/guidelines/COPIER-FIRST.md) - Documentation complète
- [MULTI-STACK-SUPPORT.md](../../docs/guidelines/MULTI-STACK-SUPPORT.md) - Guide multi-stack
- [README.md](../../README.md) - Vue d'ensemble du plugin
