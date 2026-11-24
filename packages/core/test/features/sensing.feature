Feature: Sensor selection, planning and rows

  Scenario: No sense request reads no manifest and selects nothing
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for no request
    Then no manifest was read
    And no sensor is selected

  Scenario: All selects every registered sensor in config order
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for all
    Then the selected sensors are "tally, margin"

  Scenario: All with none registered is refused
    Given a repository with a config and no sensors
    When sensors are selected for all
    Then the sensor request is refused with "no sensors are registered: name one, or add it to .recognizer/config.yaml"

  Scenario: Duplication is refused
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "duplication"
    Then the sensor request is refused with "duplication is part of structural analysis and runs with every scan"

  Scenario: An unknown name lists the registered and installed sensors
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "ghost"
    Then the sensor request is refused with "no such sensor: ghost | registered sensors: tally, margin | installed sensors: margin, tally"

  Scenario: A mix of registered, installed and unknown names is refused for the unknown one only
    Given a Tally sensor is registered and a Margin sensor is installed but not registered
    When sensors are selected for "tally, margin, ghost"
    Then the sensor request is refused with "no such sensor: ghost | registered sensors: tally | installed sensors: margin, tally"

  Scenario: An installed sensor that is not registered is refused after selection resolves it
    Given a Tally sensor is registered and a Margin sensor is installed but not registered
    When sensors are selected for "tally, margin"
    Then the sensor request is refused with "margin is not registered in .recognizer/config.yaml; register it with `recognizer plugin add margin`."

  Scenario: A registered installed command has its manifest read once even when unnamed
    Given a Tally sensor and a Margin sensor are installed and registered
    When sensors are selected for "tally, tally"
    Then the manifests read were "tally, margin"

  Scenario: A selection refusal wins over the unregistered check
    Given a Tally sensor is registered and a Margin sensor is installed but not registered
    When sensors are selected for "ghost, margin"
    Then the sensor request is refused with "no such sensor: ghost | registered sensors: tally | installed sensors: margin, tally"

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

  Scenario: Rows list installed sensors by display with the registered ones flagged
    Given a Zed sensor that runs tests with the display "Zed" is installed and registered
    And a Tally sensor is installed with the display "Alpha" and is not registered
    And a Margin sensor that is not listed is installed and registered
    And the suites "unit" is configured
    When the sensor rows are read
    Then the rows are "tally:false, zed:true"
    And the "zed" row carries the suite "unit"
    And the "tally" row carries no suites

  Scenario: A registered name that is not installed is appended in config order
    Given a Tally sensor is installed and registered
    And the config registers the uninstalled sensors "bespoke, custom"
    When the sensor rows are read
    Then the rows are "tally:true, bespoke:true, custom:true"

  Scenario: With no config only the installed rows appear unregistered
    Given a Tally sensor and a Margin sensor are installed and registered
    And the repository has no config
    When the sensor rows are read
    Then the rows are "margin:false, tally:false"

  Scenario: A custom command with a manifest is asked for exactly that manifest and receives the suites
    Given the suites "unit" and "slow" are configured
    And a Mine sensor that runs tests under its own command and manifest is registered
    When sensors are planned for "mine:unit"
    Then the "mine" sensor was asked for its manifest as "python3 sense.py manifest"
    And the "mine" sensor is planned as running tests
    And the "mine" sensor command ends with the suites "unit"

  Scenario: A custom command with no manifest declares nothing and receives no suites
    Given the suites "unit" and "slow" are configured
    And a Mine sensor that runs tests under its own command is registered without a manifest
    When sensors are planned for "mine:unit"
    Then no manifest was asked of any registered sensor
    And the "mine" sensor is planned as not running tests
    And the "mine" sensor command has no suites argument
