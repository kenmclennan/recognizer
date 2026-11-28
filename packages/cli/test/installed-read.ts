import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type InstalledRead,
  type Manifest,
  type ManifestRead,
  type PluginRegistrations,
  type RegisteredSensorInput,
  readInstalledSensors,
  readRegisteredSensors,
  selectSensors,
  withRegistered,
} from "@recognizer/core";
import { ProgramsAdapter } from "../src/adapters/plugins/programs-adapter.js";
import { nodeIo } from "../src/cli.js";
import { documentValidators } from "../src/manifest-ports.js";
import { REPO } from "./helpers.js";

export function exampleManifest(name: string): Manifest {
  return JSON.parse(
    readFileSync(
      join(REPO, `schema/manifest-examples/valid/sensor-${name}.json`),
      "utf8",
    ),
  ) as Manifest;
}

export function examplePorts(names: readonly string[] = ["crap", "mutation"]) {
  const plugins = names.map((name) => ({
    kind: "sensor" as const,
    name,
    command: [`recognizer-sense-${name}`],
    manifest: [`recognizer-sense-${name}`, "manifest"],
    source: "user" as const,
  }));
  const registrations: PluginRegistrations = {
    entries: () => ({ plugins, shadowed: [], unreadable: [], describer: null }),
    register: () => ({ status: "refused", reason: "read only" }),
    unregister: () => ({ status: "not-registered" }),
  };

  return {
    programs: new ProgramsAdapter(nodeIo()),
    validators: documentValidators,
    registrations,
  };
}

export function readExamples(
  failing: readonly string[] = [],
  names?: readonly string[],
): InstalledRead {
  return readInstalledSensors(examplePorts(), names, readCommandOf(failing));
}

function readCommandOf(failing: readonly string[]) {
  return (words: string[]): ManifestRead => {
    const name = (words[0] as string).replace("recognizer-sense-", "");

    return failing.includes(name)
      ? { ok: false, reason: `${words[0]} manifest exited 1` }
      : { ok: true, manifest: exampleManifest(name) };
  };
}

export function readRegisteredExamples(
  registered: readonly RegisteredSensorInput[],
  failing: readonly string[] = [],
): InstalledRead {
  return withRegistered(
    readExamples(failing),
    readRegisteredSensors(registered, readCommandOf(failing)),
  );
}

export function selectedWithExamples(
  registered: RegisteredSensorInput[],
  requested: "all" | string[],
  installed: readonly string[],
  suites?: readonly unknown[],
) {
  const first = selectSensors(registered, requested, installed);
  const read = readRegisteredExamples(first);

  return selectSensors(registered, requested, installed, suites, read);
}
