@e2e
Feature: The storyboard-coverage gate keeps every product change honest
  As a maintainer who must trust that no framework change ever ships without a
  visible proof, whatever agent or human authored it
  I want a merge-request gate that fails when product files change with no
  storyboard card, and passes the moment a card is added
  So that this repo's key principle ("prove it in a storyboard") has teeth,
  not just a paragraph in a rules file that a rushed agent can ignore

  # ONE story told against the REAL guard
  # (.config/devsecops/scripts/check-storyboard-coverage.sh), driven through its
  # documented STORYBOARD_COVERAGE_FILES test seam so it needs no git and stays
  # fully deterministic. ONE Gherkin sentence = ONE card = ONE pixel baseline,
  # asserted in-step (tolerance: 0); every card twins its <pre> frame with the
  # guard's REAL exit code and verdict string, so a regression fails loud even
  # without eyes. This IS the storyboard proof for the gate itself: the gate
  # touches .config/**, so by its own rule it must show its result right here.
  # A discriminating triple — the gate must STOP the unproven change, LET the
  # proven one through, and WAIVE only the visibly-exempted one.
  @test-discipline
  Scenario: The gate stops an unproven product change, passes a proven one, and waives only a visibly-exempted one
    # Note: A merge request whose only change is a product file (.config/**) with no storyboard card. This is exactly the miss the gate exists to catch — a framework fix shipped with no visible proof. The guard fails red and names the unproven file.
    # Copy: BASE=origin/main STORYBOARD_COVERAGE_FILES='.config/gitlab/ci/devsecops/release.yml' bash .config/devsecops/scripts/check-storyboard-coverage.sh
    Given a product file changes with no storyboard card, the gate stops the merge request
    # Note: The same product change, now paired with a storyboard card under project/tests/e2e/. The proof exists, so the guard goes green and names the card that satisfied it.
    # Copy: BASE=origin/main STORYBOARD_COVERAGE_FILES='.config/gitlab/ci/devsecops/release.yml project/tests/e2e/features/02-daily-work/release-window.feature' bash .config/devsecops/scripts/check-storyboard-coverage.sh
    When a storyboard card is added beside the same change, the gate lets it through
    # Note: The escape hatch, deliberately visible: a genuinely invisible product change carries a Storyboard-exempt trailer. The guard waives itself and prints the waiver for the reviewer to see — a silent bypass is impossible.
    # Copy: BASE=origin/main STORYBOARD_EXEMPT=1 STORYBOARD_COVERAGE_FILES='.config/gitlab/ci/devsecops/release.yml' bash .config/devsecops/scripts/check-storyboard-coverage.sh
    Then a deliberately invisible change is waived only by a visible Storyboard-exempt trailer
