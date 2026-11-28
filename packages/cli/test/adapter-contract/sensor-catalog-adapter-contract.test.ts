import {
  type RegisteredPlugin,
  registrationFileName,
  serializeRegistration,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { FakePluginRegistrations } from "../../../core/test/fakes/fake-plugin-registrations.js";
import { FakeSensorCatalog } from "../../../core/test/fakes/fake-sensor-catalog.js";
import { FakeSensors } from "../../../core/test/fakes/fake-sensors.js";
import { SensorCatalogAdapter } from "../../src/adapters/plugins/sensor-catalog-adapter.js";
import {
  registerShim,
  registryFolderFor,
  registryIo,
} from "../plugin-registry-shim.js";

const PROGRAMS = ["/bin/recognizer-sense-zeta", "/bin/recognizer-sense-alpha"];

function sensor(name: string, path: string): RegisteredPlugin {
  return {
    kind: "sensor",
    name,
    command: [path],
    manifest: [path, "manifest"],
    source: "user",
  };
}

describe("the sensor catalog's sensors in effect", () => {
  const named = [
    sensor("zeta", PROGRAMS[0] as string),
    sensor("alpha", PROGRAMS[1] as string),
    sensor("structure", "/bin/recognizer-sense-structure"),
  ];

  const registrations = new FakePluginRegistrations();

  named.forEach((entry, index) => {
    registrations.place(
      "user",
      registrationFileName(entry.kind, entry.name),
      serializeRegistration(entry),
      index + 1,
    );
  });

  const fake = new FakeSensorCatalog(new FakeSensors([]), registrations);

  const real = (() => {
    const directory = "/tmp/recognizer-sensor-catalog-conformance";

    for (const entry of named) {
      registerShim(`${directory}/recognizer-sense-${entry.name}`);
    }

    return new SensorCatalogAdapter(registryIo(registryFolderFor(directory)));
  })();

  it("excludes structure and orders by name, in the adapter and the fake alike", () => {
    const names = (catalog: { sensorsInEffect(): { name: string }[] }) =>
      catalog.sensorsInEffect().map((one) => one.name);

    expect(names(real)).toEqual(["alpha", "zeta"]);
    expect(names(fake)).toEqual(["alpha", "zeta"]);
  });

  it("carries the registration's command and manifest words in the fake as in the adapter", () => {
    const shaped = (catalog: {
      sensorsInEffect(): { command: string[]; manifest: string[] }[];
    }) =>
      catalog
        .sensorsInEffect()
        .map((one) => [one.command.length, one.manifest.slice(1)]);

    expect(shaped(fake)).toEqual(shaped(real));
  });
});
