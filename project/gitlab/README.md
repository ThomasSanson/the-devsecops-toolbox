# Service GitLab CE (Test)

Ce dossier contient la configuration Docker Compose pour exécuter une instance [GitLab CE](https://about.gitlab.com/) dans les environnements de développement et test.

> ⚠️ **Ce service est exclusivement destiné aux tests** et ne fait pas partie du template final (exclu de `copier.yml`).

## Services

| Service  | Description                                                                                    | Ports                        |
|----------|------------------------------------------------------------------------------------------------|------------------------------|
| `gitlab` | GitLab CE (`gitlab/gitlab-ce:17.8.7-ce.0`). Instance minimale avec services lourds désactivés. | `${TASK_GITLAB_WEB_PORT}:80` |

- Les volumes `gitlab_config`, `gitlab_logs` et `gitlab_data` assurent la persistance entre les redéploiements.
- Le `healthcheck` probe `/users/sign_in` avec un `start_period` de 300s (GitLab est lent au démarrage).
- Le service est attaché aux profils `debug`, `dev`, `local` pour éviter tout lancement accidentel en production.

## Variables d'environnement

| Variable                    | Rôle                                            |
|-----------------------------|-------------------------------------------------|
| `TASK_GITLAB_WEB_PORT`      | Port hôte exposé pour GitLab (8929 par défaut). |
| `TASK_GITLAB_ROOT_PASSWORD` | Mot de passe root initial (min. 8 caractères).  |

## Optimisations

Les services suivants sont désactivés via `GITLAB_OMNIBUS_CONFIG` pour réduire la consommation de ressources :

- Prometheus, Grafana, AlertManager, node_exporter
- Container Registry, GitLab KAS
- Puma workers réduit à 2, Sidekiq concurrency à 5

## Utilisation via Task

```bash
task deploy
```

Accéder à GitLab : `http://localhost:${TASK_GITLAB_WEB_PORT}` (par défaut `8929`).

Identifiants : `root` / `${TASK_GITLAB_ROOT_PASSWORD}`.
