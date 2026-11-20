Feature: Scanning a repository

  A scan reads a repository's code into scans, then runs the sensors and describers a person asked for.

  Scenario: A current repository is not extracted again
    Given a repository with Alpha files
    And its Alpha scan is current at the repository's commit
    When an incremental scan runs
    Then nothing is extracted
    And the scan finishes

  Scenario: A full scan extracts every detected language
    Given a repository with Alpha files and Beta files
    When a full scan runs
    Then Alpha and Beta are extracted
    And the Alpha scan is written to the cache
    And the Beta scan is written to the cache
    And the scan finishes

  Scenario: A language whose scanner fails fails the scan
    Given a repository with Alpha files and Beta files
    And an old Alpha scan is in the cache
    And the Alpha scanner fails
    When a full scan runs
    Then the Alpha entry is reported as failed
    And the old Alpha scan is removed
    And the Beta scan is written to the cache
    And the summary lists Alpha as failed and Beta as ok
    And the scan fails

  Scenario: A ticked sensor runs after extraction and an unticked one does not
    Given a repository with Alpha files
    And a Tally sensor and a Margin sensor are registered
    When a full scan runs ticking the Tally sensor
    Then the Tally sensor runs after Alpha is extracted
    And the Margin sensor does not run

  Scenario: A sensor that runs tests receives only the suites the request chose
    Given a repository with Alpha files
    And the suites "unit" and "slow" are configured
    And a Tally sensor that runs tests and a Margin sensor that does not are registered
    When a full scan runs ticking both sensors with the suite "unit" for the Tally sensor
    Then the Tally sensor receives only the suite "unit"
    And the Margin sensor receives no suites

  Scenario: A costly description asks first and describes nothing when declined
    Given a repository with Alpha files
    And a Quill describer is registered
    And describing would cost 8 dollars
    And the person declines to confirm
    When a full scan runs describing everything with confirmation above 5 dollars
    Then confirmation is asked
    And nothing is described
    And the scan finishes

  Scenario: A description under the limit is not asked about
    Given a repository with Alpha files
    And a Quill describer is registered
    And describing would cost 3 dollars
    When a full scan runs describing everything with confirmation above 5 dollars
    Then confirmation is not asked
    And every module is described
    And the scan finishes

  Scenario: A preflight gap refuses the scan before any sensor runs
    Given a repository with Alpha files
    And a Tally sensor is registered
    And the Tally sensor needs "pencil" and "ruler"
    When a full scan runs ticking the Tally sensor
    Then the scan is refused by preflight
    And the gaps "pencil" and "ruler" are reported
    And the Tally sensor does not run

  Scenario: A scan started while another runs is refused
    Given a repository with Alpha files
    And a Tally sensor is registered and held while it runs
    And a scan ticking the Tally sensor is running
    When a second scan starts
    Then the second scan is refused because another scan holds the lock
    And the first scan's lock is untouched
    And the status reports a scan running in the running phase

  Scenario: Stopping a scan stops the running sensor and releases the lock
    Given a repository with Alpha files
    And a Tally sensor is registered and held while it runs
    And a scan ticking the Tally sensor is running
    When the scan is stopped
    Then the Tally sensor's process is stopped
    And the lock is released
    And the scan ends stopped

  Scenario: The summary lists each phase that ran and the files removed
    Given a repository with Alpha files
    And an old Gamma scan is in the cache
    And a Tally sensor is registered
    When a full scan runs ticking the Tally sensor
    Then the summary lists the extract phase with the Alpha entry
    And the summary lists the sense phase with the Tally entry
    And the summary lists the old Gamma scan as removed
