Feature: Sensor selection, planning and rows

  Scenario: No sense request reads no manifest and selects nothing
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for no request
    Then no manifest was read
    And no sensor is selected

  Scenario: All selects every registered sensor in name order
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for all
    Then the selected sensors are "margin, tally"

  Scenario: All with none registered is refused
    Given a repository with a config and no sensors
    When sensors are selected for all
    Then the sensor request is refused with "no sensors are registered: register one with recognizer plugin register <program|path>"

  Scenario: Duplication is refused
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "duplication"
    Then the sensor request is refused with "duplication is part of structural analysis and runs with every scan"

  Scenario: An unknown name lists the registered sensors
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "ghost"
    Then the sensor request is refused with "no such sensor: ghost | registered sensors: margin, tally"

  Scenario: A mix of registered and unknown names is refused for the unknown one only
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "tally, margin, ghost"
    Then the sensor request is refused with "no such sensor: ghost | registered sensors: margin, tally"

  Scenario: A registered installed command has its manifest read once even when unnamed
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "tally, tally"
    Then the manifests read were "tally, margin"

  Scenario: With no suites file a tests-running sensor chooses every suite and gets no suites argument
    Given the suites "unit" and "slow" are configured
    And a Tally sensor that runs tests is installed and registered
    When sensors are planned for "tally"
    Then the "tally" sensor chooses "unit, slow"
    And the "tally" sensor command has no suites argument

  Scenario: A suites file naming a subset chooses it in configured order
    Given the suites "unit" and "slow" are configured
    And a Tally sensor that runs tests is installed and registered
    And a suites file {"tally":["slow","unit","slow"]}
    When sensors are planned for "tally"
    Then the "tally" sensor chooses "unit, slow"
    And the "tally" sensor command ends with the suites "unit, slow"

  Scenario: A suites file naming one suite of one configured chooses that suite
    Given the suites "unit" is configured
    And a Tally sensor that runs tests is installed and registered
    And a suites file {"tally":["unit"]}
    When sensors are planned for "tally"
    Then the "tally" sensor chooses "unit"

  Scenario: A per-sensor request fills in where the file is silent and the file wins where it speaks
    Given the suites "unit" and "slow" are configured
    And a Tally sensor that runs tests is installed and registered
    And a Gauge sensor that runs tests is installed and registered
    And a suites file {"tally":["slow"]}
    When sensors are planned for "tally:unit, gauge:unit"
    Then the "tally" sensor chooses "slow"
    And the "gauge" sensor chooses "unit"

  Scenario: A modules file is appended as an absolute path to a scoped sensor only
    Given a Tally sensor that is scoped is installed and registered
    And a Margin sensor and a Gauge sensor are installed and registered
    And a modules file "modules.json"
    When sensors are planned for "tally, margin"
    Then the "tally" sensor command ends with "--modules /abs/modules.json"
    And the "margin" sensor command has no modules argument

  Scenario Outline: A bad suites file is refused with its message
    Given the suites "unit" and "slow" are configured
    And a Tally sensor that runs tests is installed and registered
    And a Margin sensor and a Gauge sensor are installed and registered
    And a suites file <file>
    When sensors are planned for "tally, margin"
    Then the sensor request is refused with "<message>"

    Examples:
      | file                         | message                                                                                |
      | []                           | --suites file must be a JSON object from sensor name to an array of suite names        |
      | {"other":["unit"]}           | --suites names other, which is not selected                                            |
      | {"margin":["unit"]}          | --suites names margin, which runs no tests                                             |
      | {"tally":"unit"}             | --suites tally must be an array of non-empty suite names                               |
      | {"tally":[""]}               | --suites tally must be an array of non-empty suite names                               |
      | {"tally":[]}                 | --suites tally must name at least one suite                                            |
      | {"tally":["nope"]}           | --suites tally: no such suite: nope \| configured suites: unit, slow                   |

  Scenario: An unreadable suites file is refused with the reason
    Given a Tally sensor that runs tests is installed and registered
    And a suites file that cannot be read
    When sensors are planned for "tally"
    Then the sensor request is refused with "cannot read --suites file missing.json: ENOENT"

  Scenario: Rows list registered sensors by display, every one flagged registered
    Given a Zed sensor that runs tests with the display "Zed" is installed and registered
    And a Tally sensor is installed with the display "Alpha" and is registered
    And a Margin sensor that is not listed is installed and registered
    And the suites "unit" is configured
    When the sensor rows are read
    Then the rows are "tally:true, zed:true"
    And the "zed" row carries the suite "unit"
    And the "tally" row carries no suites

  Scenario: With no config the registered rows still appear
    Given a Tally sensor and a Margin sensor are installed and registered
    And the repository has no config
    When the sensor rows are read
    Then the rows are "margin:true, tally:true"

  Scenario: A custom command with a manifest is asked for exactly that manifest and receives the suites
    Given the suites "unit" and "slow" are configured
    And a Mine sensor that runs tests under its own command and manifest is registered
    When sensors are planned for "mine:unit"
    Then the "mine" sensor was asked for its manifest as "python3 sense.py manifest"
    And the "mine" sensor is planned as running tests
    And the "mine" sensor command ends with the suites "unit"

