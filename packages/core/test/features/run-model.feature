Feature: Run model published as repository state

  Scenario: a long run with a plugin finishing mid-run keeps every registered plugin and every finished result
    Given three registered plugins in a run
    When the first plugin finishes with a result and the second starts
    Then every revision lists all three registered plugins
    And the first plugin's result is in the state
    And the plugin runs read finished, running and queued

  Scenario: a failed catalog read keeps every registered plugin
    Given three registered plugins in a run
    When the plugin catalog cannot be read
    Then the catalog reads unreadable
    And the state still lists all three registered plugins

  Scenario: a service restart rebuilds the same state
    Given three registered plugins in a run
    When the first plugin finishes with a result and the second starts
    And the service restarts
    Then the restarted state is revision 1 and equals the old state without its revision

  Scenario: a revision is published only on change
    Given three registered plugins in a run
    When the state is refreshed twice with nothing changed
    Then one revision was published
    When the second plugin reports a progress line
    Then the next revision was published

  Scenario: a killed run ends stopped once
    Given three registered plugins in a run
    When the run's owner is found gone
    Then the run ends stopped
    And both repositories settled the run once

  Scenario: a commit-scoped run keeps its results beside the working tree's
    Given three registered plugins in a commit-scoped run
    When the first plugin reports a result for the commit
    Then the working-tree result is unchanged
    And no findings document was saved for the commit

  Scenario: a commit's results persist beside the working tree's
    Given a commit's results were saved and the working tree's too
    When the state is held again from scratch
    Then the result set holds both and the working tree's is unchanged

  Scenario: a long run keeps the plugin's reported estimate across its stages
    Given three registered plugins in a run
    When the first plugin reports three stages and one estimate of 3 hours
    Then every revision carries the estimate of 10800000 and a stage index that never falls

