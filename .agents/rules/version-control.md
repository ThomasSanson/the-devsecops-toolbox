---
trigger: always_on
description: Agents commit and push on feature branches through merge or pull requests; humans alone merge
---

# Version Control

## Agents prepare the change

For work requested by the user, agents may:

- Inspect Git state and history.
- Create or switch to a dedicated feature branch.
- Stage and commit the changes within the requested scope.
- Push that feature branch and open or update its merge request or pull request.
- Read CI results and push corrections to the same request.

Commits and pushes are part of preparing a reviewable change. They are allowed
only through a merge-request or pull-request workflow. Use Conventional Commits
and preserve any unrelated work already present in the checkout.

## A human merges

- Never merge a merge request or pull request, including through an API or CLI.
- Never enable automatic merge or schedule a merge on the user's behalf.
- Never push directly to the default branch or a protected integration branch.
- Never skip CI to publish a change.
- Do not force-push, discard work or rewrite shared history without explicit
  permission.

A human reviews the change and performs the final merge. Permission to commit,
push or open a request is not permission to merge it.

## Verify and report

Run `task devsecops:code:verify` and `task devsecops:test:verify` before committing.
These tasks may use `git add -N` so their guards can inspect new files; they do
not commit or push anything.

Before reporting the request ready, verify the required CI jobs on the exact
pushed commit. State the tested commit, the actual results and any remaining
failure. A pending pipeline or a local pass is not a successful remote pipeline.
