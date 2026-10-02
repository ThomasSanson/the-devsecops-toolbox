# OSV ownership fixture

`vulnerable-lock.json` pins lodash 4.17.20. The test copies it into disposable
framework and project directories as `package-lock.json`; it installs no package.

`GHSA-35jh-r3h4-6jhm.json` is the unmodified advisory downloaded from the
[public OSV API](https://api.osv.dev/v1/vulns/GHSA-35jh-r3h4-6jhm) on 2026-09-30.
The test puts that record into an offline npm database. This small snapshot proves
path selection with a real vulnerability without querying a changing database.

The test runs `task megalinter` locally, then the generated `code:megalinter`
job in the test GitLab. `megalinter-ci.yml` includes the generated job definition
and selects it for this fixture; it adds no scanner command or diagnostic script.
OSV is the only selected scanner in this test. Production keeps the full linter
suite and live database.

The screenshots show the actual OSV job logs in GitLab, including the scanner's
verdict, vulnerable package, advisory and dependency paths:

- Vulnerable framework tools only: **Passed**.
- A vulnerable project dependency, including a custom `.config/` tool: **Failed**.

Concurrent scans can print file paths in a different order. The screenshots sort
those original rows and the informational reporter rows, keeping every message.
The assertions read the unmodified CI reports.

The assertions also check the native CI reports, the toolbox's own scan, and a
Copier update. Nothing under `project/tests/` ships to generated projects.
