Feature: Managing plugins

  Plugins are found on the PATH, judged by their manifest, registered in a repository and diagnosed by the doctor.

  Scenario: Discovery finds a sensor and a describer in directory order
    Given the PATH holds /first and /second
    And /first holds the sensor "alpha" with a valid manifest
    And /second holds the describer "beta" with a valid manifest
    When plugins are discovered
    Then the discovery lists the sensor "alpha" then the describer "beta"
    And nothing is unreadable

  Scenario: A manifest of the wrong kind is unreadable with today's text
    Given the PATH holds /first
    And /first holds a program "recognizer-sense-alpha" whose manifest says it is a describer called "alpha"
    When plugins are discovered
    Then the discovery lists no plugin
    And the unreadable entry for "/first/recognizer-sense-alpha" says "manifest kind is describer, not sensor"

  Scenario: A manifest of the wrong name is unreadable with today's text
    Given the PATH holds /first
    And /first holds a program "recognizer-sense-alpha" whose manifest says it is a sensor called "gamma"
    When plugins are discovered
    Then the unreadable entry for "/first/recognizer-sense-alpha" says "manifest name is gamma, not alpha"

  Scenario: A plugin on the previous protocol is judged previous
    Given the PATH holds /first
    And /first holds the sensor "alpha" on protocol 1
    When plugins are discovered
    Then the plugin "alpha" is judged "previous"

  Scenario: A mixed PATH reports one plugin and two unreadable entries
    Given the PATH holds /first
    And /first holds the sensor "alpha" with a valid manifest
    And /first holds a program "recognizer-sense-broken" that prints no manifest
    And /first holds a program "recognizer-sense-mismatch" whose manifest says it is a sensor called "other"
    When plugins are discovered
    Then the discovery lists exactly 1 plugin
    And the discovery has 2 unreadable entries
    And the unreadable commands are "/first/recognizer-sense-broken" and "/first/recognizer-sense-mismatch"

  Scenario: Registering a sensor writes through the registry once
    Given the PATH holds /first
    And /first holds the sensor "alpha" with a valid manifest
    When the sensor "alpha" is registered twice
    Then the registry holds one write for "alpha"
    And the second registration says it is already registered

  Scenario: A second describer is refused while another is registered
    Given the PATH holds /first
    And /first holds the describer "beta" with a valid manifest
    And a different describer "other" is already registered
    When the describer "beta" is registered
    Then the registration is refused naming "other"

  Scenario: The doctor reports an uninstalled sensor's install line
    Given the PATH holds /first
    And /first holds the sensor "alpha" with a valid manifest
    And the repository registers the sensors "alpha" and "missing" with install line "brew install missing"
    When the doctor runs
    Then the sensors area has a plugin-missing problem for "missing" fixed by "brew install missing"
    And the sensors area has no problem for "alpha"

  Scenario: A plugin check fails a program that prints junk on stdout
    Given a program "recognizer-sense-junk" that prints "not json" on stdout
    When the plugin check runs on "recognizer-sense-junk"
    Then the check result "clean-output" fails
