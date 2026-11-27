import { describe, expect, it } from "vitest";
import {
  discoverPlugins,
  installedSensorNames,
  type PluginKind,
  programName,
  readInstalledSensors,
  serializeRegistration,
} from "../../src/index.js";
import { createFakes, pluginPortsOf } from "../fakes/container.js";

function setup() {
  const fakes = createFakes();

  function manifestOf(kind: PluginKind, name: string): Record<string, unknown> {
    return {
      kind,
      name,
      display: name,
      protocol: fakes.documentValidators.facts.protocol,
      install: `brew install ${name}`,
      settings: [],
    };
  }

  function onPath(kind: PluginKind, name: string): void {
    fakes.programs.install("/bin", programName(kind, name), (args) =>
      args[0] === "manifest"
        ? { stdout: JSON.stringify(manifestOf(kind, name)) }
        : {},
    );
  }

  function register(
    kind: PluginKind,
    name: string,
    modified: number | null = 1,
  ): void {
    const command = [`/registered/${name}`];

    fakes.programs.install("/registered", name, (args) =>
      args[0] === "manifest"
        ? { stdout: JSON.stringify(manifestOf(kind, name)) }
        : {},
    );
    fakes.pluginRegistrations.place(
      "user",
      `${kind}-${name}.json`,
      serializeRegistration({
        kind,
        name,
        command,
        manifest: [...command, "manifest"],
      }),
      modified,
    );
  }

  return { fakes, onPath, register, ports: () => pluginPortsOf(fakes) };
}

const names = (found: { plugins: { name: string }[] }) =>
  found.plugins.map((plugin) => plugin.name).sort();

describe("discoverPlugins with registrations", () => {
  it("finds nothing on PATH when nothing is registered", () => {
    const { onPath, ports } = setup();

    onPath("scanner", "alpha");
    onPath("sensor", "beta");

    expect(names(discoverPlugins(ports()))).toEqual([]);
  });

  it("uses only registered scanners when any is registered", () => {
    const { onPath, register, ports } = setup();

    onPath("scanner", "on-path");
    register("scanner", "alpha");

    const found = discoverPlugins(ports(), ["scanner"]);

    expect(names(found)).toEqual(["alpha"]);
    expect(found.plugins[0]?.command).toBe("/registered/alpha");
  });

  it("keeps two registered scanners so scanners.<language> can choose between them", () => {
    const { register, ports } = setup();

    register("scanner", "alpha");
    register("scanner", "beta");

    expect(names(discoverPlugins(ports(), ["scanner"]))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("finds no PATH plugin of a kind with no registration while another kind is registered", () => {
    const { onPath, register, ports } = setup();

    register("scanner", "alpha");
    onPath("describer", "on-path");

    expect(names(discoverPlugins(ports()))).toEqual(["alpha"]);
  });

  it("puts the newest registered describer in effect", () => {
    const { register, ports } = setup();

    register("describer", "older", 1);
    register("describer", "newer", 2);

    expect(names(discoverPlugins(ports(), ["describer"]))).toEqual(["newer"]);
  });

  it("reports a registered plugin whose manifest names another plugin as unreadable", () => {
    const { fakes, register, ports } = setup();

    register("scanner", "alpha");
    fakes.programs.install("/registered", "alpha", (args) =>
      args[0] === "manifest"
        ? {
            stdout: JSON.stringify({
              kind: "scanner",
              name: "other",
              display: "other",
              protocol: fakes.documentValidators.facts.protocol,
              install: "brew install other",
              settings: [],
            }),
          }
        : {},
    );

    const found = discoverPlugins(ports(), ["scanner"]);

    expect(found.plugins).toEqual([]);
    expect(found.unreadable).toHaveLength(1);
  });
});

describe("installed sensors with registrations", () => {
  it("lists no PATH sensor when none is registered", () => {
    const { onPath, ports } = setup();

    onPath("sensor", "alpha");

    expect(installedSensorNames(ports())).toEqual([]);
  });

  it("lists every registered sensor and no PATH sensor once one is registered", () => {
    const { onPath, register, ports } = setup();

    onPath("sensor", "on-path");
    register("sensor", "alpha");
    register("sensor", "beta");

    expect(installedSensorNames(ports())).toEqual(["alpha", "beta"]);
  });

  it("reads each registered sensor through its registered manifest command", () => {
    const { register, ports } = setup();

    register("sensor", "alpha");
    register("sensor", "beta");

    const read = readInstalledSensors(ports());

    expect(read.sensors.map((sensor) => sensor.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(read.unreadable).toEqual([]);
  });
});
