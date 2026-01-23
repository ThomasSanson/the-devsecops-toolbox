# 🧪 Tests BDD avec CodeceptJS

## Vue d'ensemble

Suite de tests BDD organisée par **domaine métier**, avec une architecture modulaire inspirée des PageObjects.

## Structure

```text
project/tests/
├── codecept.conf.js              # Configuration CodeceptJS
├── entrypoint.js                 # Point d'entrée (hooks + chargement steps)
├── features/                     # Fichiers Gherkin par domaine
│   ├── ansible/
│   ├── copier/
│   ├── devsecops/
│   ├── gitlab/
│   └── renovate/
└── steps/
    ├── index.js                  # Charge tous les modules de steps
    ├── domains/                  # Steps spécifiques par domaine
    │   ├── ansible.js            # Tests .config/ansible
    │   ├── copier.js             # Tests template Copier
    │   ├── devsecops.js          # Tests project mode, phases
    │   ├── docker.js             # Tests container runtime Docker
    │   ├── gitlab.js             # Tests GitLab CI (tags, proxy)
    │   ├── podman.js             # Tests container runtime Podman
    │   └── renovate.js           # Tests config Renovate
    └── support/                  # Helpers et steps génériques
        ├── assertions.js         # Fonctions d'assertion
        ├── commands.js           # Exécution commandes shell
        ├── config.js             # Configuration centralisée
        ├── contentSteps.js       # Steps Then (fichiers, contenu)
        ├── copierSteps.js        # Steps Given/When (copier)
        ├── filesystem.js         # Opérations fichiers
        ├── tables.js             # Utilitaires tables Gherkin
        └── testContext.js        # Contexte de test
```

## Architecture

### `steps/domains/`
Steps Gherkin **spécifiques à un domaine métier**. Chaque fichier contient ses Given, When et Then.

### `steps/support/`
- **Fonctions utilitaires** : `assertions.js`, `commands.js`, `filesystem.js`, etc.
- **Steps génériques** : `copierSteps.js` (setup projet), `contentSteps.js` (assertions fichiers)

## Exécution

```bash
# Tous les tests
task test

# Par domaine
task test -- --grep "@ansible"
task test -- --grep "@copier"
task test -- --grep "@project"
task test -- --grep "@gitlab"
task test -- --grep "@renovate"

# Mode TDD (watch)
task test:tdd
```

## Ajouter un domaine

1. Créer `steps/domains/<domain>.js` avec une fonction `register()`
2. Ajouter le require dans `steps/index.js`
3. Créer `features/<domain>/<feature>.feature`

## Tags

| Tag         | Description           |
|-------------|-----------------------|
| `@ansible`  | Tests Ansible         |
| `@copier`   | Tests template Copier |
| `@project`  | Tests mode project    |
| `@gitlab`   | Tests GitLab CI       |
| `@renovate` | Tests Renovate        |
| `@docker`   | Tests runtime Docker  |
| `@podman`   | Tests runtime Podman  |
