import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Manifest,
  type ManifestRead,
  readShippedSensors,
  type ShippedRead,
} from "@recognizer/core";
import type { Io } from "../src/cli.js";
import { shippedPorts } from "../src/manifest-ports.js";
import { REPO } from "./helpers.js";

export function exampleManifest(name: string): Manifest {
  return JSON.parse(
    readFileSync(
      join(REPO, `schema/manifest-examples/valid/sensor-${name}.json`),
      "utf8",
    ),
  ) as Manifest;
}

export function readExamples(
  failing: readonly string[] = [],
  names?: readonly string[],
): ShippedRead {
  const read = (prefix: string[]): ManifestRead => {
    const name = (prefix[0] as string).replace("recognizer-sense-", "");

    return failing.includes(name)
      ? { ok: false, reason: `${prefix[0]} manifest exited 1` }
      : { ok: true, manifest: exampleManifest(name) };
  };

  return readShippedSensors(shippedPorts({} as Io), read, names);
}
