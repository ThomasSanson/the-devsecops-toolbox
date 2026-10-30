@e2e
Feature: The test engine rejects oversized collections before parsing their elements
  The toolbox ships Zod with its test engine. Its collection size limits must
  reject oversized inputs before walking their members, while accepted inputs
  must still be validated.

  @zod-size-bound
  Scenario: The installed Zod rejects oversized arrays, sets and maps before visiting their elements
    # Note: The real regression test counts element validations. For arrays, sets and maps, an oversized collection must be rejected with no element visited. A collection inside the limit must still validate its member and preserve its value.
    # Copy: cat project/tests/unit/zod-size-bound.test.js
    Given the test engine has a regression for collection size limits and accepted values
    # Note: The task runs the regression against the Zod installed in this test image. The passing test proves both rejection before element traversal and validation of accepted values. Only measured execution times are hidden.
    # Copy: task -x project:test:codeceptjs:dependencies
    Then the installed test engine passes the collection size regression
