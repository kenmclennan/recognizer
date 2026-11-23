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

  Scenario: A command that is not a sense plugin invocation is ready and unchecked
    When the command "some-tool run" is checked as "other"
    Then the report of "other" is ready and unchecked
    And no program was run

  Scenario: A sensor whose manifest declares no readiness check is ready without a check call
    Given the sensor "alpha" declares no readiness check
    When the sensors "alpha" are checked
    Then the report of "alpha" is ready and checked
    And no check call was made

  Scenario: A shipped sensor whose program does not start reports it missing
    When the sensors "ghost" are checked
    Then the report of "ghost" has the gap "sensors-missing" reading "/bin/recognizer-sense-ghost is not installed"

  Scenario: A check that times out did not answer
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" times out
    When the sensors "alpha" are checked
    Then the report of "alpha" has the gap "check-failed" reading "the readiness check of alpha did not answer: it timed out"

  Scenario: A failed check relays the first stderr line
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "" and exits 3 with stderr "boom"
    When the sensors "alpha" are checked
    Then the report of "alpha" has the gap "check-failed" reading "the readiness check of alpha did not answer: boom"

  Scenario: A failed check with no stderr names the exit status
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "" and exits 3 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has the gap "check-failed" reading "the readiness check of alpha did not answer: exit status 3"

  Scenario: Junk on stdout is no readable answer
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "not json" and exits 0 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has the gap "check-failed" reading "the readiness check of alpha did not answer: it printed no readable gaps"

  Scenario: Three sensors give three reports in order
    Given the sensor "one" declares a readiness check
    And the sensor "two" declares a readiness check
    And the sensor "three" declares a readiness check
    And the check of "two" prints "{\"gaps\":[{\"code\":\"x\",\"suite\":null,\"line\":\"a gap\"}]}" and exits 0 with stderr ""
    And the check of "three" prints "junk" and exits 0 with stderr ""
    When the sensors "one,two,three" are checked
    Then the reports come in the order "one,two,three"
    And the report of "one" is ready and checked
    And the report of "two" has a gap with code "x"
    And the report of "three" has a gap with code "check-failed"

  Scenario: The default check has a ceiling and a run check has none
    Given the sensor "alpha" declares a readiness check
    When the sensors "alpha" are checked
    Then the check call has a timeout of 600000 ms

  Scenario: A run check omits the ceiling
    Given the sensor "alpha" declares a readiness check
    When the sensors "alpha" are checked with --run
    Then the check call has no timeout

  Scenario: A well-formed work answer is kept
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "{\"gaps\":[],\"work\":{\"unit\":\"modules\",\"to_perform\":4,\"reusable\":2}}" and exits 0 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has the work "modules" with 4 to perform and 2 reusable

  Scenario: A work answer of zero counts is kept
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "{\"gaps\":[],\"work\":{\"unit\":\"modules\",\"to_perform\":0,\"reusable\":0}}" and exits 0 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has the work "modules" with 0 to perform and 0 reusable

  Scenario: A work answer with an empty unit is dropped
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "{\"gaps\":[],\"work\":{\"unit\":\"\",\"to_perform\":1,\"reusable\":1}}" and exits 0 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has no work

  Scenario: A work answer with a negative count is dropped
    Given the sensor "alpha" declares a readiness check
    And the check of "alpha" prints "{\"gaps\":[],\"work\":{\"unit\":\"modules\",\"to_perform\":-1,\"reusable\":1}}" and exits 0 with stderr ""
    When the sensors "alpha" are checked
    Then the report of "alpha" has no work

  Scenario: With no name every registered sensor is checked in config order
    Given the repository registers the checkable sensors "b" and "a"
    When the sensors to check are chosen with name ""
    Then the sensors to check are "b,a"

  Scenario: A named shipped sensor that is not registered runs its shipped command
    Given the repository registers the checkable sensors "b" and "a"
    When the sensors to check are chosen with name "crap"
    Then the sensors to check are "crap"
    And the shipped sensor "crap" is run with its shipped command

  Scenario: An unknown sensor is refused with the registered and shipped names
    Given the repository registers the checkable sensors "b" and "a"
    When the sensors to check are chosen with name "nope"
    Then the request is refused with "no such sensor: nope"
    And the refusal lists "no such sensor: nope" before "registered sensors: b, a" before "shipped sensors: crap"

  Scenario: No registered sensors and no name is refused
    Given the repository registers no sensor
    When the sensors to check are chosen with name ""
    Then the request is refused with "no sensors are registered"

  Scenario: Choosing without suites does not read the tests list
    Given the repository registers the checkable sensors "b" and "a"
    When the sensors to check are chosen without suites
    Then the suites were read 0 times

  Scenario: Choosing with suites reads the tests list once
    Given the repository registers the checkable sensors "b" and "a"
    When the sensors to check are chosen with name ""
    Then the suites were read 1 times

  Scenario: The setup guide of a command that is not a sense plugin is empty
    When the setup guide of the command "some-tool run" is read
    Then the setup guide is empty

  Scenario: The setup guide of a program that does not start fails
    When the setup guide of the command "/bin/recognizer-sense-ghost run" is read
    Then the setup guide fails with "/bin/recognizer-sense-ghost is not installed"

  Scenario: The setup guide of a program that exits non-zero relays stderr
    Given the guide of "alpha" exits 2 with stderr "no guide here"
    When the setup guide of the command "/bin/recognizer-sense-alpha run" is read
    Then the setup guide fails with "no guide here"

  Scenario: The setup guide of a program that exits non-zero without stderr names the exit
    Given the guide of "alpha" exits 2 with stderr ""
    When the setup guide of the command "/bin/recognizer-sense-alpha run" is read
    Then the setup guide fails with "alpha exited 2"
