Feature: Setting up a repository

  Setup surveys a repository through its plugins, applies the chosen changes all or nothing and rehearses them without leaving a trace.

  Scenario: A survey lists the runner a plugin answers
    Given a repository holding the file "engine/package.json"
    And a plugin answers a vitest runner for "engine"
    When the repository is surveyed
    Then the survey lists the runner "engine" from "engine/package.json"
    And the survey has no note

  Scenario: An apply whose second step fails leaves the files byte-identical
    Given a repository set up for a change run
    And the second step of the run fails
    When the changes are applied
    Then the apply fails
    And the files are byte-identical to before

  Scenario: A try that passes leaves the files byte-identical
    Given a repository set up for a change run
    When the changes are tried
    Then the try passes
    And the files are byte-identical to before
