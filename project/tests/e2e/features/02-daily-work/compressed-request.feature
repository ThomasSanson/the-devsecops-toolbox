@e2e
Feature: The test engine survives late bytes after a compressed request body
  The toolbox ships body-parser with its test engine. A finished gzip decoder
  must not crash its process when the remaining request bytes arrive.

  @body-parser-trailing
  Scenario: A compressed JSON value remains valid when late trailing bytes arrive
    # Note: The real parser receives a valid gzip frame and then invalid trailing bytes after parsing finishes. Assertions check that the accepted value is preserved and the entire request stream ends. An uncaught decoder error must fail the regression.
    # Copy: cat project/tests/unit/fixtures/body-parser-trailing.js
    Given the test engine has a regression for late compressed request bytes
    # Note: The task runs the real parser in a child process and requires exit code zero, accepted JSON and consumed trailing bytes. Only measured execution times are hidden.
    # Copy: task -x project:test:codeceptjs:body-parser
    Then the installed test engine survives the late compressed request bytes
