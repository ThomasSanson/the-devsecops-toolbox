@install-scripts @cross-platform
Feature: Install scripts cross-platform compatibility
  As a DevSecOps engineer
  I want my install scripts to work on multiple Linux distributions
  So that the toolbox is portable across environments

  @timeout(600000)
  Scenario Outline: <tool> installs successfully on <os>
    Given a "<os>" container is running
    When I run ".config/<tool>/install.sh" in the container
    Then the command should exit with code 0
    And "<verify_cmd>" should succeed in the container

    @jq-cross-platform
    Examples:
      | tool | os            | verify_cmd   |
      | jq   | ubuntu:24.04  | jq --version |
      | jq   | debian:12     | jq --version |
      | jq   | alpine:3.19   | jq --version |
      | jq   | fedora:40     | jq --version |
      | jq   | homebrew/brew | jq --version |

    @glab-cross-platform
    Examples:
      | tool | os            | verify_cmd     |
      | glab | ubuntu:24.04  | glab --version |
      | glab | debian:12     | glab --version |
      | glab | alpine:3.19   | glab --version |
      | glab | fedora:40     | glab --version |
      | glab | homebrew/brew | glab --version |
