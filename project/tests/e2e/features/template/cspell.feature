# cspell:ignore Nelmio Caddyfile Zzunknownword
# (real project vocabulary from #162 the toolbox dictionaries do not know, plus an
#  unknown control word — the tests register the project words and prove the
#  control is flagged; cspell must not flag these in this file.)
@e2e @e2e-template-cspell
Feature: A generated project owns its cspell vocabulary across toolbox updates
  Issue #162 — .config/cspell/config.json was framework-owned yet the only place a
  generated project could register its own spelling vocabulary (Nelmio, Caddyfile,
  Grist…), so every `task copier:update` reverted it and `task code` went red. The
  framework splits the dictionary — config.json (structural) imports config.base.json
  (framework base, refreshed) and config.project.json (project words, skip-if-exists)
  — and a copier migration moves words an old project kept inline in config.json into
  config.project.json. Both halves are proven by running the project's REAL linter
  (`task megalinter`) and keeping MegaLinter's own coloured cspell verdict, contrasting
  the project's recognised word against an unknown control word that gets flagged.

  # Survival: a generated project registers its own word in the copier-preserved
  # override, the toolbox releases a new version, copier update applies it — and the
  # real linter still recognises the project's word. A control word, NOT registered,
  # is flagged alongside, so "recognised" is unambiguous (not "cspell ignores all").
  @e2e-template-cspell-project-words-survive-update
  Scenario: a project's own cspell word survives copier update
    Given a versioned working-branch template with releases "1.0.0" and "1.0.1"
    And a project generated from the template at release "1.0.0"
    And the project registers its own word "Nelmio" in its cspell override
    When the project is updated to template release "1.0.1"
    Then the project's surviving cspell override should visually match "template/cspell-project-word-survives-override"
    When MegaLinter runs on the updated project
    Then cspell should recognise the project word and flag only the control, matching "template/cspell-project-word-survives"

  # Upgrade path (auto-migration) told as a folder transformation — AVANT/PENDANT/APRÈS.
  # An EXISTING project kept its words inline in the old single-file config.json. The
  # update MOVES them into its own config.project.json while config.json becomes the
  # framework image. Proven by showing the .config/cspell folder before (one file, the
  # project word mixed into the framework's), the CLI announcing the migration actions
  # as it runs, the folder after (three files, the project word relocated intact,
  # config.json word-free), then the real linter still recognising the word.
  @e2e-template-cspell-upgrade-preserves-words
  Scenario: upgrading from the old single-file design moves a project's words into its override
    Given a versioned template upgrading cspell from old single-file to split
    And a project generated at the old version with its own word "Caddyfile" in config.json
    Then the cspell folder before the update should visually match "template/cspell-upgrade-before"
    When the project is updated to template release "22.7.1"
    Then the cspell migration announcement should visually match "template/cspell-upgrade-during"
    And the cspell folder after the update should visually match "template/cspell-upgrade-after"
    When MegaLinter runs on the updated project
    Then cspell should recognise the project word and flag only the control, matching "template/cspell-upgrade-recognised"
