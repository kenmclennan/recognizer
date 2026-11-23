import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { planSensors } from "../../src/application/sensing/plan-sensors.js";
import { readSensorRows } from "../../src/application/sensing/read-sensor-rows.js";
import { selectSensors } from "../../src/application/sensing/select-sensors.js";
import {
  InvalidRequest,
  type SensorRequest,
  shippedCommand,
} from "../../src/index.js";
import type { ScanWorld } from "../fakes/world.js";

const ROOT = "/work/repository";
const SUITES_FILE = "suites.json";

function names(text: string): string[] {
  return text.split(",").map((one) => one.trim());
}

function request(text: string): "all" | SensorRequest[] {
  return text === "all"
    ? "all"
    : names(text).map((one) => {
        const [name, suite] = one.split(":") as [string, string | undefined];

        return suite === undefined ? { name } : { name, suites: [suite] };
      });
}

function ports(world: ScanWorld) {
  const { sensors, config, clock, catalog, files } = world.fakes;

  return { sensors, config, clock, catalog, files };
}

function attempt(world: ScanWorld, work: () => void): void {
  try {
    work();
  } catch (error) {
    if (!(error instanceof InvalidRequest)) {
      throw error;
    }

    world.trial.refused = error.messages;
  }
}

function limits(world: ScanWorld) {
  return world.fakes.process.limits();
}

function select(world: ScanWorld): void {
  attempt(world, () => {
    const config = world.fakes.config.run();

    world.trial.selection = selectSensors(ports(world), {
      root: ROOT,
      config,
      limits: limits(world),
      sense: world.trial.sense,
    });
  });
}

function install(
  world: ScanWorld,
  name: string,
  more: {
    runsTests?: boolean;
    scoped?: boolean;
    registered?: boolean;
    display?: string;
    listed?: boolean;
  } = {},
): void {
  world.fakes.sensors.installed.set(name, {
    name,
    runsTests: more.runsTests ?? false,
    needs: [],
    held: false,
    ...(more.scoped === undefined ? {} : { scoped: more.scoped }),
    ...(more.registered === undefined ? {} : { registered: more.registered }),
    ...(more.display === undefined ? {} : { display: more.display }),
    ...(more.listed === undefined ? {} : { listed: more.listed }),
  });
}

Given(
  "a Tally sensor and a Margin sensor are installed and registered",
  function (this: ScanWorld) {
    install(this, "tally");
    install(this, "margin");
  },
);

Given(
  "a Tally sensor that runs tests is installed and registered",
  function (this: ScanWorld) {
    install(this, "tally", { runsTests: true });
  },
);

Given(
  "a Tally sensor that is scoped is installed and registered",
  function (this: ScanWorld) {
    install(this, "tally", { scoped: true });
  },
);

Given(
  "a Margin sensor and a Gauge sensor are installed and registered",
  function (this: ScanWorld) {
    install(this, "margin");
    install(this, "gauge", { runsTests: true });
  },
);

Given(
  "a Gauge sensor that runs tests is installed and registered",
  function (this: ScanWorld) {
    install(this, "gauge", { runsTests: true });
  },
);

Given(
  "a Tally sensor is registered and a Margin sensor is shipped but not registered",
  function (this: ScanWorld) {
    install(this, "tally");
    install(this, "margin", { registered: false });
  },
);

Given("a repository with a config and no sensors", function (this: ScanWorld) {
  this.fakes.config.present = true;
});

Given("the repository has no config", function (this: ScanWorld) {
  this.fakes.config.present = false;
});

Given("a Tally sensor is installed and registered", function (this: ScanWorld) {
  install(this, "tally");
});

Given(
  "a Zed sensor that runs tests with the display {string} is installed and registered",
  function (this: ScanWorld, display: string) {
    install(this, "zed", { runsTests: true, display });
  },
);

Given(
  "a Tally sensor is installed with the display {string} and is not registered",
  function (this: ScanWorld, display: string) {
    install(this, "tally", { display, registered: false });
  },
);

Given(
  "a Margin sensor that is not listed is installed and registered",
  function (this: ScanWorld) {
    install(this, "margin", { listed: false });
  },
);

Given(
  "the config registers the unshipped sensors {string}",
  function (this: ScanWorld, list: string) {
    this.fakes.config.unshipped = names(list);
  },
);

Given(
  "the suites {string} is configured",
  function (this: ScanWorld, suite: string) {
    this.fakes.sensors.suites.push(suite);
  },
);

Given("a suites file {word}", function (this: ScanWorld, text: string) {
  this.fakes.files.files.set(SUITES_FILE, text);
  this.trial.suitesFile = SUITES_FILE;
});

Given("a suites file that cannot be read", function (this: ScanWorld) {
  this.trial.suitesFile = "missing.json";
});

Given("a modules file {string}", function (this: ScanWorld, file: string) {
  this.trial.modulesFile = file;
});

When("sensors are selected for no request", function (this: ScanWorld) {
  this.trial.sense = null;
  select(this);
});

When("sensors are selected for all", function (this: ScanWorld) {
  this.trial.sense = "all";
  select(this);
});

When(
  "sensors are selected for {string}",
  function (this: ScanWorld, text: string) {
    this.trial.sense = request(text);
    select(this);
  },
);

When(
  "sensors are planned for {string}",
  function (this: ScanWorld, text: string) {
    this.trial.sense = request(text);
    select(this);

    if (this.trial.selection === undefined) {
      return;
    }

    const selection = this.trial.selection;

    attempt(this, () => {
      this.trial.plan = planSensors(ports(this), {
        selection,
        sense: this.trial.sense,
        config: this.fakes.config.run(),
        suitesFile: this.trial.suitesFile,
        modulesFile: this.trial.modulesFile,
      });
    });
  },
);

When("the sensor rows are read", function (this: ScanWorld) {
  this.trial.rows = readSensorRows(ports(this), ROOT);
});

Then("no manifest was read", function (this: ScanWorld) {
  assert.deepEqual(this.fakes.catalog.reads, []);
});

Then("no sensor is selected", function (this: ScanWorld) {
  assert.deepEqual(this.trial.selection?.selected, []);
});

Then(
  "the selected sensors are {string}",
  function (this: ScanWorld, list: string) {
    assert.deepEqual(
      this.trial.selection?.selected.map((one) => one.name),
      names(list),
    );
  },
);

Then(
  "the {string} sensor runs the shipped command",
  function (this: ScanWorld, name: string) {
    const one = this.trial.selection?.selected.find((s) => s.name === name);

    assert.deepEqual(
      one?.command.slice(0, 1),
      shippedCommand(name, {}).slice(0, 1),
    );
    assert.ok(one?.command.includes("--repository"));
  },
);

Then(
  "the sensor request is refused with {string}",
  function (this: ScanWorld, text: string) {
    assert.deepEqual(
      this.trial.refused,
      text.split(" | ").map((one) => one.replaceAll("\\|", "|")),
    );
  },
);

Then(
  "the manifests read were {string}",
  function (this: ScanWorld, list: string) {
    assert.deepEqual(this.fakes.catalog.reads, [names(list)]);
  },
);

function planned(world: ScanWorld, name: string) {
  const one = world.trial.plan?.selected.find((s) => s.name === name);

  assert.ok(one, `${name} is planned`);

  return one;
}

Then(
  "the {string} sensor chooses {string}",
  function (this: ScanWorld, name: string, list: string) {
    assert.deepEqual(this.trial.plan?.chosen[name], names(list));
  },
);

Then(
  "the {string} sensor command has no suites argument",
  function (this: ScanWorld, name: string) {
    assert.ok(!planned(this, name).command.includes("--suites"));
  },
);

Then(
  "the {string} sensor command ends with the suites {string}",
  function (this: ScanWorld, name: string, list: string) {
    assert.deepEqual(planned(this, name).command.slice(-2), [
      "--suites",
      JSON.stringify(names(list)),
    ]);
  },
);

Then(
  "the {string} sensor command ends with {string}",
  function (this: ScanWorld, name: string, tail: string) {
    assert.deepEqual(planned(this, name).command.slice(-2), tail.split(" "));
  },
);

Then(
  "the {string} sensor command has no modules argument",
  function (this: ScanWorld, name: string) {
    assert.ok(!planned(this, name).command.includes("--modules"));
  },
);

Then("the rows are {string}", function (this: ScanWorld, list: string) {
  assert.deepEqual(
    this.trial.rows?.map((row) => `${row.name}:${row.registered}`),
    names(list),
  );
});

Then(
  "the {string} row carries the suite {string}",
  function (this: ScanWorld, name: string, suite: string) {
    assert.deepEqual(
      this.trial.rows?.find((row) => row.name === name)?.suites,
      [{ name: suite, language: "python" }],
    );
  },
);

Then(
  "the {string} row carries no suites",
  function (this: ScanWorld, name: string) {
    assert.equal(
      this.trial.rows?.find((row) => row.name === name)?.suites,
      undefined,
    );
  },
);
