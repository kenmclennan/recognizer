Feature: Scan panel
  What a scan senses and describes follows what is ticked in the Scan panel and the mode chosen.

  Background:
    Given the installed sensors Coverage and Breakage both run the test suites
    And a repository with the test suites unit and web
    And the files a.py and b.py have descriptions and c.py has none
    And Descriptions is ticked

  Scenario: A ticked sensor is sensed by the next scan only
    Given Breakage is ticked
    When a scan runs
    And another scan runs
    Then the scan senses nothing

  Scenario: Ticking a suite inside an unticked sensor's fold turns the sensor on
    When the suite unit is ticked under Breakage
    And a scan runs
    Then the scan senses Breakage
    And Breakage runs only the suite unit

  Scenario: A plan shown before a sensor is unticked does not sense it
    Given Breakage is ticked
    And the panel shows its plan
    And Breakage is unticked
    When a scan runs
    Then the scan senses nothing

  Scenario Outline: What a scan senses and describes
    Given <ticked> is ticked
    And <unticked> is unticked
    And the mode is <mode>
    When a scan runs
    Then the scan senses <senses>
    And the scan describes <describes>

    Examples:
      | ticked                | unticked              | mode        | senses                | describes          |
      | Coverage              | Breakage              | Incremental | Coverage              | changed files only |
      | Breakage              | Coverage              | Incremental | Breakage              | changed files only |
      | Coverage and Breakage | nothing               | Full        | Coverage and Breakage | all files          |
      | nothing               | Coverage and Breakage | Full        | nothing               | all files          |
