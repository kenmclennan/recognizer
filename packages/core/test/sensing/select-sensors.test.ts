import { describe, expect, it } from "vitest";
import { selectSensors } from "../../src/application/sensing/select-sensors.js";
import {
  InvalidRequest,
  type PluginLimits,
  registrationFileName,
  type SensorRequest,
  type SensorSelection,
  serializeRegistration,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";

const NO_SENSORS =
  "no sensors are registered: register one with recognizer plugin register <program|path>";

function world(...registered: string[]) {
  const fakes = createFakes();

  for (const name of registered) {
    const command = [`/registered/${name}`];

    fakes.pluginRegistrations.place(
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

  const ports = {
    sensors: fakes.sensors,
    config: fakes.config,
    clock: fakes.clock,
    catalog: fakes.catalog,
    files: fakes.files,
  };
  const select = (sense: null | "all" | SensorRequest[]): SensorSelection =>
    selectSensors(ports, {
      root: "/work/repository",
      config: fakes.config.run(),
      limits: {} as PluginLimits,
      sense,
    });

  return { fakes, select };
}

function refusal(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidRequest) {
      return error.messages;
    }

    throw error;
  }

  return [];
}

describe("selectSensors over the registry", () => {
  it("runs every registered sensor in every repository", () => {
    const { fakes, select } = world("gamma", "alpha", "beta");

    fakes.config.sensorSettingsByName = { alpha: { depth: 2 } };

    expect(select("all").selected.map((one) => one.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("builds the run command from the registration words and the config settings", () => {
    const { fakes, select } = world("alpha", "beta");

    fakes.config.sensorSettingsByName = { alpha: { depth: 2 } };

    const [alpha, beta] = select("all").selected;

    expect(alpha?.command).toEqual([
      "/registered/alpha",
      "run",
      "--repository",
      "{repository}",
      "--commit",
      "{commit}",
      "--output",
      "{output}",
      "--settings",
      '{"depth":2}',
    ]);
    expect(beta?.command.slice(-2)).toEqual(["--settings", "{}"]);
    expect(beta?.manifest).toEqual(["/registered/beta", "manifest"]);
  });

  it("refuses a sensor that is not registered", () => {
    const { select } = world("a");

    expect(refusal(() => select([{ name: "ghost" }]))).toEqual([
      "no such sensor: ghost",
      "registered sensors: a",
    ]);
  });

  it("refuses when no sensor is registered", () => {
    const { select } = world();

    expect(refusal(() => select("all"))).toEqual([NO_SENSORS]);
    expect(refusal(() => select([{ name: "ghost" }]))).toEqual([NO_SENSORS]);
  });

  it("selects the registered names and refuses the unknown one", () => {
    const { select } = world("a", "b", "c");

    expect(refusal(() => select([{ name: "a" }, { name: "ghost" }]))).toEqual([
      "no such sensor: ghost",
      "registered sensors: a, b, c",
    ]);
  });

  it("does not put a sensor named structure in effect", () => {
    const { fakes } = world("a", "structure");

    expect(fakes.catalog.sensorsInEffect().map((one) => one.name)).toEqual([
      "a",
    ]);
  });

  it("selects nothing when no sense is requested", () => {
    const { select } = world("a");

    expect(select(null).selected).toEqual([]);
  });
});
