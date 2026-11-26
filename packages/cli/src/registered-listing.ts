import {
  type InstalledPlugin,
  type InstalledSensorEntry,
  judgeProtocol,
  readManifestCommand,
  readRegisteredSensors,
  type UnreadablePlugin,
  type UnreadableSensor,
} from "@recognizer/core";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { documentValidators, manifestPorts } from "./manifest-ports.js";

function withManifest(io: Io, root: string) {
  try {
    return registeredSensors(readConfig(io, root, ["sensors"])).filter(
      (sensor) => sensor.manifest !== undefined,
    );
  } catch {
    return [];
  }
}

export function registeredSensorEntries(
  io: Io,
  root: string,
  seen: ReadonlySet<string>,
): { entries: InstalledSensorEntry[]; unreadable: UnreadableSensor[] } {
  const sensors = withManifest(io, root);
  const read = readRegisteredSensors(sensors, (words) =>
    readManifestCommand(manifestPorts(io), words),
  );
  const names = new Set(seen);
  const entries: InstalledSensorEntry[] = [];

  for (const sensor of sensors) {
    const entry = read.entries[sensor.command.join("\0")];

    if (entry !== undefined && !names.has(entry.name)) {
      names.add(entry.name);
      entries.push(entry);
    }
  }

  return { entries, unreadable: read.unreadable };
}

export function registeredSensorPlugins(
  io: Io,
  root: string,
  seen: ReadonlySet<string>,
): { plugins: InstalledPlugin[]; unreadable: UnreadablePlugin[] } {
  const names = new Set(seen);
  const plugins: InstalledPlugin[] = [];
  const unreadable: UnreadablePlugin[] = [];
  const asked = new Set<string>();

  for (const { manifest: words } of withManifest(io, root)) {
    const command = (words as string[]).join(" ");

    if (asked.has(command)) {
      continue;
    }

    asked.add(command);

    const read = readManifestCommand(manifestPorts(io), words as string[]);

    if (!read.ok) {
      unreadable.push({ command, reason: read.reason });
    } else if (read.manifest.kind !== "sensor") {
      unreadable.push({
        command,
        reason: `${command} manifest is not a sensor`,
      });
    } else if (!names.has(read.manifest.name)) {
      names.add(read.manifest.name);
      plugins.push({
        kind: "sensor",
        name: read.manifest.name,
        command,
        manifest: read.manifest,
        judgement: judgeProtocol(
          read.manifest,
          documentValidators.facts.protocol,
        ),
        schema: "undeclared",
      });
    }
  }

  return { plugins, unreadable };
}
