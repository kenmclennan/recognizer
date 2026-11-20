Feature: Scan panel
  What a scan senses and describes follows what is ticked in the Scan panel and the mode chosen.

  Background:
    Given a repository with the test suites unit and web
    And the files a.py and b.py have descriptions and c.py has none
    And Descriptions is ticked

  Scenario: An unticked sensor is not sensed even though its suites stay ticked
    Given Mutation is ticked
    When a scan runs
    And another scan runs
    Then the scan senses nothing

  Scenario: Ticking a suite inside an unticked sensor's fold turns the sensor on
    When the suite unit is ticked under Mutation
    And a scan runs
    Then the scan senses Mutation
    And Mutation runs only the suite unit

  Scenario: A plan shown before a sensor is unticked does not sense it
    Given Mutation is ticked
    And the panel shows its plan
    And Mutation is unticked
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
      | C.R.A.P.              | Mutation              | Incremental | C.R.A.P.              | changed files only |
      | Mutation              | C.R.A.P.              | Incremental | Mutation              | changed files only |
      | C.R.A.P. and Mutation | nothing               | Full        | C.R.A.P. and Mutation | all files          |
      | nothing               | C.R.A.P. and Mutation | Full        | nothing               | all files          |
