Feature: Planning a scan

  A plan says which phases and files a scan would run, without running anything.

  Scenario: A rescan plans every ticked phase over the whole scope
    Given a planned repository with three files
    And Tally and Margin sensors are registered and ticked
    When a rescan is planned
    Then the plan names Tally and Margin
    And the plan covers 3 files

  Scenario: A bring plan names only what has a gap
    Given a planned repository with three files
    And Tally and Margin sensors are registered and ticked
    And Tally is current on every file
    And Margin is out of date on one file
    When a bring is planned
    Then the plan names Margin
    And the plan does not name Tally

  Scenario: A sensor never run here is planned even with no gap
    Given a planned repository with no files
    And Tally and Margin sensors are registered and ticked
    When a bring is planned
    Then the plan names Tally and Margin
    And the plan lists Tally and Margin as never run

  Scenario: A ticked name no sensor registers is dropped and reported
    Given a planned repository with three files
    And Tally and Margin sensors are registered and ticked
    And Ghost is ticked but no sensor registers it
    When a rescan is planned
    Then the plan names Tally and Margin
    And Ghost is dropped

  Scenario: Nothing out of date plans nothing and is idle
    Given a planned repository with three files
    And Tally and Margin sensors are registered and ticked
    And Tally is current on every file
    And Margin is current on every file
    When a bring is planned
    Then the plan names no sensor
    And the plan is idle
