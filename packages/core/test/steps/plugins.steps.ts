import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  type CheckableSensor,
  checkSensors,
  type Discovery,
  diagnose,
  discoverPlugins,
  guideSensor,
  InvalidRequest,
  type PluginCheckReport,
  type PluginKind,
  type ProgramRun,
  pluginCheck,
  type RegisterResult,
  registerPlugin,
  registrationFileName,
  type SensorReport,
  sensorsToCheck,
  serializeRegistration,
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
  reports: SensorReport[];
  answers: Map<string, Partial<ProgramRun>>;
  selection: CheckableSensor[];
  guide: { text: string } | { failure: string } | null;
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
      reports: [],
      answers: new Map(),
      selection: [],
      guide: null,
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
  "the {word} {string} at {string} is registered",
  function (this: ScanWorld, kind: string, name: string, command: string) {
    this.fakes.pluginRegistrations.place(
      "user",
      registrationFileName(kind as PluginKind, name),
      serializeRegistration({
        kind: kind as PluginKind,
        name,
        command: [command],
        manifest: [command, "manifest"],
      }),
      1,
    );
  },
);

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

Given("the repository has a config", function (this: ScanWorld) {
  this.fakes.repositoryChecks.directories.add("/repo");
  this.fakes.repositoryChecks.configDocumentValue = {
    kind: "parsed",
    document: {},
  };
});

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

function sensorCommand(name: string): string[] {
  return [
    `/bin/recognizer-sense-${name}`,
    "run",
    "--repository",
    "{repository}",
  ];
}

function manifestCommand(name: string): string[] {
  return [`/bin/recognizer-sense-${name}`, "manifest"];
}

function installSensor(
  world: ScanWorld,
  name: string,
  declaresCheck: boolean,
): void {
  const answers = state(world).answers;

  world.fakes.programs.install("/bin", `recognizer-sense-${name}`, (args) => {
    if (args[0] === "manifest") {
      return {
        stdout: JSON.stringify({
          ...manifest(
            "sensor",
            name,
            world.fakes.documentValidators.facts.protocol,
          ),
          check: declaresCheck,
        }),
      };
    }

    return answers.get(name) ?? { stdout: '{"gaps":[]}' };
  });
}

function registerMachineWide(world: ScanWorld, name: string): void {
  const command = [`recognizer-sense-${name}`];

  world.fakes.pluginRegistrations.place(
    "user",
    registrationFileName("sensor", name),
    serializeRegistration({
      kind: "sensor",
      name,
      command,
      manifest: [...command, "manifest"],
    }),
    1,
  );
}

function reportOf(world: ScanWorld, name: string): SensorReport {
  const found = state(world).reports.find((one) => one.name === name);

  assert.ok(found !== undefined, `a report for ${name}`);

  return found;
}

function checkCalls(world: ScanWorld) {
  return world.fakes.programs.runs.filter((one) => one.args[0] === "check");
}

Given(
  "the sensor {string} declares a readiness check",
  function (this: ScanWorld, name: string) {
    installSensor(this, name, true);
  },
);

Given(
  "the sensor {string} declares no readiness check",
  function (this: ScanWorld, name: string) {
    installSensor(this, name, false);
  },
);

Given(
  "the check of {string} prints {string} and exits {int} with stderr {string}",
  function (
    this: ScanWorld,
    name: string,
    stdout: string,
    status: number,
    stderr: string,
  ) {
    state(this).answers.set(name, { stdout, status, stderr });
  },
);

Given(
  "the check of {string} times out",
  function (this: ScanWorld, name: string) {
    state(this).answers.set(name, { timedOut: true, status: null });
  },
);

Given(
  "the repository registers the checkable sensors {string} and {string}",
  function (this: ScanWorld, first: string, second: string) {
    for (const name of [first, second]) {
      installSensor(this, name, false);
      registerMachineWide(this, name);
    }
  },
);

Given("the repository registers no sensor", function (this: ScanWorld) {});

When(
  "the sensors {string} are checked",
  function (this: ScanWorld, names: string) {
    state(this).reports = checkSensors(
      ports(this),
      "/repo",
      names.split(",").map((name) => ({
        name,
        command: sensorCommand(name),
        manifest: manifestCommand(name),
      })),
      {},
    );
  },
);

When(
  "the sensors {string} are checked with --run",
  function (this: ScanWorld, names: string) {
    state(this).reports = checkSensors(
      ports(this),
      "/repo",
      names.split(",").map((name) => ({
        name,
        command: sensorCommand(name),
        manifest: manifestCommand(name),
      })),
      { run: true },
    );
  },
);

When(
  "the command {string} is checked as {string}",
  function (this: ScanWorld, command: string, name: string) {
    state(this).reports = checkSensors(
      ports(this),
      "/repo",
      [{ name, command: command.split(" ") }],
      {},
    );
  },
);

When(
  "the sensors to check are chosen with name {string}",
  function (this: ScanWorld, name: string) {
    try {
      state(this).selection = sensorsToCheck(
        ports(this),
        "/repo",
        name === "" ? undefined : name,
      );
    } catch (error) {
      assert.ok(error instanceof InvalidRequest);
      state(this).refusal = error.messages.join("\n");
    }
  },
);

When(
  "the sensors to check are chosen without suites",
  function (this: ScanWorld) {
    state(this).selection = sensorsToCheck(
      ports(this),
      "/repo",
      undefined,
      false,
    );
  },
);

When(
  "the setup guide of the command {string} is read",
  function (this: ScanWorld, command: string) {
    state(this).guide = guideSensor(ports(this), "/repo", {
      name: "alpha",
      command: command.split(" "),
    });
  },
);

When(
  "the setup guide of the command {string} with the manifest {string} is read",
  function (this: ScanWorld, command: string, manifest: string) {
    state(this).guide = guideSensor(ports(this), "/repo", {
      name: "alpha",
      command: command.split(" "),
      manifest: manifest.split(" "),
    });
  },
);

Then("no check call was made", function (this: ScanWorld) {
  assert.deepEqual(checkCalls(this), []);
});

Then("no program was run", function (this: ScanWorld) {
  assert.deepEqual(this.fakes.programs.runs, []);
});

Then(
  "the report of {string} is ready and unchecked",
  function (this: ScanWorld, name: string) {
    const report = reportOf(this, name);

    assert.deepEqual(
      [report.ready, report.checked, report.gaps],
      [true, false, []],
    );
  },
);

Then(
  "the report of {string} is ready and checked",
  function (this: ScanWorld, name: string) {
    const report = reportOf(this, name);

    assert.deepEqual(
      [report.ready, report.checked, report.gaps],
      [true, true, []],
    );
  },
);

Then(
  "the report of {string} has the gap {string} reading {string}",
  function (this: ScanWorld, name: string, code: string, line: string) {
    const report = reportOf(this, name);

    assert.equal(report.ready, false);
    assert.deepEqual(
      report.gaps.map((gap) => [gap.code, gap.line]),
      [[code, line]],
    );
  },
);

Then(
  "the reports come in the order {string}",
  function (this: ScanWorld, names: string) {
    assert.deepEqual(
      state(this).reports.map((one) => one.name),
      names.split(","),
    );
  },
);

Then(
  "the report of {string} has a gap with code {string}",
  function (this: ScanWorld, name: string, code: string) {
    assert.deepEqual(
      reportOf(this, name).gaps.map((gap) => gap.code),
      [code],
    );
  },
);

Then(
  "the report of {string} has no work",
  function (this: ScanWorld, name: string) {
    assert.equal(reportOf(this, name).work, undefined);
  },
);

Then(
  "the report of {string} has the work {string} with {int} to perform and {int} reusable",
  function (
    this: ScanWorld,
    name: string,
    unit: string,
    perform: number,
    reusable: number,
  ) {
    assert.deepEqual(reportOf(this, name).work, {
      unit,
      to_perform: perform,
      reusable,
    });
  },
);

Then(
  "the check call has a timeout of {int} ms",
  function (this: ScanWorld, ms: number) {
    assert.equal(checkCalls(this)[0]?.options?.timeoutMs, ms);
  },
);

Then("the check call has no timeout", function (this: ScanWorld) {
  const [call] = checkCalls(this);

  assert.ok(call !== undefined);
  assert.equal(call.options?.timeoutMs, undefined);
});

Then(
  "the sensors to check are {string}",
  function (this: ScanWorld, names: string) {
    assert.deepEqual(
      state(this).selection.map((one) => one.name),
      names.split(","),
    );
  },
);

Then(
  "the request is refused with {string}",
  function (this: ScanWorld, text: string) {
    assert.ok(state(this).refusal?.includes(text), state(this).refusal ?? "");
  },
);

Then(
  "the refusal lists {string} before {string}",
  function (this: ScanWorld, a: string, b: string) {
    const text = state(this).refusal ?? "";

    assert.ok(text.indexOf(a) !== -1 && text.indexOf(a) < text.indexOf(b));
  },
);

Then(
  "the suites were read {int} times",
  function (this: ScanWorld, count: number) {
    assert.equal(this.fakes.repositoryChecks.suiteReads, count);
  },
);

Then("the setup guide is empty", function (this: ScanWorld) {
  assert.deepEqual(state(this).guide, { text: "" });
});

Then(
  "the setup guide fails with {string}",
  function (this: ScanWorld, failure: string) {
    assert.deepEqual(state(this).guide, { failure });
  },
);

Given(
  "the guide of {string} exits {int} with stderr {string}",
  function (this: ScanWorld, name: string, status: number, stderr: string) {
    this.fakes.programs.install("/bin", `recognizer-sense-${name}`, (args) =>
      args[0] === "guide" ? { status, stderr } : {},
    );
  },
);
