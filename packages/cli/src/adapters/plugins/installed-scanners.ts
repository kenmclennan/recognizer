import { statSync } from "node:fs";
import { join } from "node:path";
import { type Discovery, discoverPlugins, PREFIXES } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { manifestPorts } from "../../manifest-ports.js";

let held: { key: string; discovery: Discovery } | undefined;

function stampOf(path: string): string | null {
  try {
    const found = statSync(path);

    return `${path}@${found.mtimeMs}:${found.size}`;
  } catch {
    return null;
  }
}

export function installedScanners(io: Io): Discovery {
  const ports = manifestPorts(io);
  const stamps = ports.programs
    .listOnPath([PREFIXES.scanner])
    .map((entry) => stampOf(join(entry.directory, entry.name)));
  const key = stamps.join("\n");
  const cacheable = stamps.every((stamp) => stamp !== null);

  if (cacheable && held?.key === key) {
    return held.discovery;
  }

  const discovery = discoverPlugins(ports, ["scanner"]);

  held = cacheable ? { key, discovery } : undefined;

  return discovery;
}
