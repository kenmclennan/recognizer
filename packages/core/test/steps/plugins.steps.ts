import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  type Discovery,
  diagnose,
  discoverPlugins,
  InvalidRequest,
  type PluginCheckReport,
  type PluginKind,
  pluginCheck,
  type RegisterResult,
  registerPlugin,
} from "../../src/index.js";
import { pluginPortsOf } from "../fakes/container.js";
import type { ScanWorld } from "../fakes/world.js";

const VERBS: Record<PluginKind, string> = {
  scanner: "scan",
  sensor: "sense",
  describer: "describe",
};

interface PluginState {
  discovery: Discovery | null;
  results: RegisterResult[];
  refusal: string | null;
  report: ReturnType<typeof diagnose> | null;
  check: PluginCheckReport | null;
}

const states = new WeakMap<ScanWorld, PluginState>();

function state(world: ScanWorld): PluginState {
  let found = states.get(world);

  if (found === undefined) {
    found = {
      discovery: null,
      results: [],
      refusal: null,
      report: null,
      check: null,
    };
    states.set(world, found);
  }

  return found;
}

function manifest(
  kind: string,
  name: string,
  protocol: number,
): Record<string, unknown> {
  return {
    kind,
    name,
    display: name,
    version: "1.0.0",
    protocol,
    install: `brew install ${name}`,
    check: false,
    long_running: false,
    units: [],
    settings: [],
    prompt_version: "p1",
  };
}

function install(
  world: ScanWorld,
  directory: string,
  program: string,
  stdout: string,
): void {
  world.fakes.programs.install(directory, program, (args) =>
    args[0] === "manifest" ? { stdout } : {},
  );
}

function ports(world: ScanWorld) {
  return pluginPortsOf(world.fakes);
}

Given(
  "the PATH holds {word} and {word}",
  function (this: ScanWorld, first: string, second: string) {
    this.fakes.programs.path.push(first, second);
  },
);

Given("the PATH holds {word}", function (this: ScanWorld, first: string) {
  this.fakes.programs.path.push(first);
});

Given(
  "{word} holds the {word} {string} with a valid manifest",
  function (this: ScanWorld, directory: string, kind: string, name: string) {
    const current = this.fakes.documentValidators.facts.protocol;

    install(
      this,
      directory,
      `recognizer-${VERBS[kind as PluginKind]}-${name}`,
      JSON.stringify(manifest(kind, name, current)),
    );
  },
);

Given(
  "{word} holds the sensor {string} on protocol {int}",
  function (
    this: ScanWorld,
    directory: string,
    name: string,
    protocol: number,
  ) {
    install(
      this,
      directory,
      `recognizer-sense-${name}`,
      JSON.stringify(manifest("sensor", name, protocol)),
    );
  },
);

Given(
  "{word} holds a program {string} whose manifest says it is a {word} called {string}",
  function (
    this: ScanWorld,
    directory: string,
    program: string,
    kind: string,
    name: string,
  ) {
    install(
      this,
      directory,
      program,
      JSON.stringify(
        manifest(kind, name, this.fakes.documentValidators.facts.protocol),
      ),
    );
  },
);

Given(
  "{word} holds a program {string} that prints no manifest",
  function (this: ScanWorld, directory: string, program: string) {
    install(this, directory, program, "usage: tool");
  },
);

Given(
  "a different describer {string} is already registered",
  function (this: ScanWorld, name: string) {
    this.fakes.pluginRegistry.state.set(process.cwd(), {
      sensors: {},
      describerProgram: `recognizer-describe-${name}`,
    });
  },
);

Given(
  "the repository registers the sensors {string} and {string} with install line {string}",
  function (this: ScanWorld, present: string, absent: string, line: string) {
    const spec = (name: string, installLine: string | null) => ({
      kind: "sensor" as const,
      subject: name,
      name,
      program: `recognizer-sense-${name}`,
      command: [`recognizer-sense-${name}`, "run"],
      settings: null,
      installLine,
    });

    this.fakes.repositoryChecks.directories.add("/repo");
    this.fakes.repositoryChecks.configReading = {
      problems: [],
      registered: {
        specs: [spec(present, null), spec(absent, line)],
        named: {},
        install: {},
        sensors: [present, absent],
        describer: false,
      },
    };
  },
);

Given(
  "a program {string} that prints {string} on stdout",
  function (this: ScanWorld, program: string, text: string) {
    install(this, "/bin", program, text);
  },
);

When("plugins are discovered", function (this: ScanWorld) {
  state(this).discovery = discoverPlugins(ports(this));
});

When(
  "the sensor {string} is registered twice",
  function (this: ScanWorld, name: string) {
    for (let time = 0; time < 2; time += 1) {
      state(this).results.push(
        registerPlugin(ports(this), {
          name,
          kind: "sensor",
          root: "/repo",
        }),
      );
    }
  },
);

When(
  "the describer {string} is registered",
  function (this: ScanWorld, name: string) {
    try {
      state(this).results.push(
        registerPlugin(ports(this), {
          name,
          kind: "describer",
          root: process.cwd(),
        }),
      );
    } catch (error) {
      assert.ok(error instanceof InvalidRequest);
      state(this).refusal = error.messages.join("\n");
    }
  },
);

When("the doctor runs", function (this: ScanWorld) {
  state(this).report = diagnose(ports(this), "/repo", false);
});

When(
  "the plugin check runs on {string}",
  async function (this: ScanWorld, program: string) {
    state(this).check = await pluginCheck(
      ports(this),
      `/bin/${program}`,
      undefined,
      {},
    );
  },
);

function discovery(world: ScanWorld): Discovery {
  const found = state(world).discovery;

  assert.ok(found !== null, "plugins were discovered");

  return found;
}

Then(
  "the discovery lists the sensor {string} then the describer {string}",
  function (this: ScanWorld, sensor: string, describer: string) {
    assert.deepEqual(
      discovery(this).plugins.map((one) => `${one.kind} ${one.name}`),
      [`sensor ${sensor}`, `describer ${describer}`],
    );
  },
);

Then("nothing is unreadable", function (this: ScanWorld) {
  assert.deepEqual(discovery(this).unreadable, []);
});

Then("the discovery lists no plugin", function (this: ScanWorld) {
  assert.deepEqual(discovery(this).plugins, []);
});

Then(
  "the unreadable entry for {string} says {string}",
  function (this: ScanWorld, command: string, text: string) {
    const entry = discovery(this).unreadable.find(
      (one) => one.command === command,
    );

    assert.ok(entry !== undefined, `${command} is unreadable`);
    assert.ok(entry.reason.includes(text), entry.reason);
  },
);

Then(
  "the plugin {string} is judged {string}",
  function (this: ScanWorld, name: string, judgement: string) {
    assert.equal(
      discovery(this).plugins.find((one) => one.name === name)?.judgement,
      judgement,
    );
  },
);

Then(
  "the discovery lists exactly {int} plugin",
  function (this: ScanWorld, count: number) {
    assert.equal(discovery(this).plugins.length, count);
  },
);

Then(
  "the discovery has {int} unreadable entries",
  function (this: ScanWorld, count: number) {
    assert.equal(discovery(this).unreadable.length, count);
  },
);

Then(
  "the unreadable commands are {string} and {string}",
  function (this: ScanWorld, first: string, second: string) {
    assert.deepEqual(
      discovery(this).unreadable.map((one) => one.command),
      [first, second],
    );
  },
);

Then(
  "the registry holds one write for {string}",
  function (this: ScanWorld, name: string) {
    assert.deepEqual(
      this.fakes.pluginRegistry.writes.map((one) => one.registration.name),
      [name],
    );
  },
);

Then(
  "the second registration says it is already registered",
  function (this: ScanWorld) {
    const [first, second] = state(this).results;

    assert.deepEqual(
      [first?.status, second?.status === "done" ? second.line : null],
      ["done", "recognizer-sense-alpha: already registered"],
    );
  },
);

Then(
  "the registration is refused naming {string}",
  function (this: ScanWorld, name: string) {
    assert.ok(state(this).refusal?.includes(name), state(this).refusal ?? "");
    assert.deepEqual(this.fakes.pluginRegistry.writes, []);
  },
);

Then(
  "the sensors area has a plugin-missing problem for {string} fixed by {string}",
  function (this: ScanWorld, name: string, fix: string) {
    const area = state(this).report?.areas.find(
      (one) => one.name === "sensors",
    );
    const problem = area?.problems.find(
      (one) => one.code === "plugin-missing" && one.subject === name,
    );

    assert.ok(problem !== undefined, `${name} is reported missing`);
    assert.equal(problem.fix.text, fix);
  },
);

Then(
  "the sensors area has no problem for {string}",
  function (this: ScanWorld, name: string) {
    const area = state(this).report?.areas.find(
      (one) => one.name === "sensors",
    );

    assert.deepEqual(
      area?.problems.filter((one) => one.subject === name),
      [],
    );
  },
);

Then(
  "the check result {string} fails",
  function (this: ScanWorld, name: string) {
    const entry = state(this).check?.results.find((one) => one.name === name);

    assert.equal(entry?.status, "fail");
  },
);
