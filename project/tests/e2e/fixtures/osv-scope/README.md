# OSV ownership fixture

`vulnerable-lock.json` pins lodash 4.17.20. The test copies it into disposable
framework and project directories as `package-lock.json`; it installs no package.

`GHSA-35jh-r3h4-6jhm.json` is the unmodified advisory downloaded from the
[public OSV API](https://api.osv.dev/v1/vulns/GHSA-35jh-r3h4-6jhm) on 2026-09-30.
The test puts that record into an offline npm database. This small snapshot proves
path selection with a real vulnerability without querying a changing database.

The test runs the pinned MegaLinter through `task megalinter`, with OSV as its
only selected scanner. Production keeps the full linter suite and live database.
