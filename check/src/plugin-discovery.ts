import { join } from "node:path";
import type { Io } from "./cli.js";
import {
  CURRENT_PROTOCOL,
  judgeProtocol,
  type Manifest,
  type PluginKind,
  type ProtocolJudgement,
  readManifest,
} from "./plugin-manifest.js";

export const PREFIXES: Record<PluginKind, string> = {
  scanner: "recognizer-scan-",
  sensor: "recognizer-sense-",
  describer: "recognizer-describe-",
};

export const KINDS: PluginKind[] = ["scanner", "sensor", "describer"];

export interface InstalledPlugin {
  kind: PluginKind;
  name: string;
  command: string;
  manifest: Manifest;
  judgement: ProtocolJudgement;
}

export interface UnreadablePlugin {
  command: string;
  reason: string;
}

export interface Discovery {
  plugins: InstalledPlugin[];
  unreadable: UnreadablePlugin[];
}

export function programName(kind: PluginKind, name: string): string {
  return `${PREFIXES[kind]}${name}`;
}

function kindOf(fileName: string): PluginKind | null {
  return (
    KINDS.find(
      (kind) =>
        fileName.startsWith(PREFIXES[kind]) &&
        fileName.length > PREFIXES[kind].length,
    ) ?? null
  );
}

function pathDirectories(io: Io): string[] {
  return (io.env("PATH") ?? "").split(":").filter((one) => one !== "");
}

export function discoverPlugins(
  io: Io,
  kinds: readonly PluginKind[] = KINDS,
): Discovery {
  const seen = new Set<string>();
  const found: { kind: PluginKind; fileName: string; command: string }[] = [];

  for (const directory of pathDirectories(io)) {
    let entries: ReturnType<Io["readDir"]>;

    try {
      entries = io.readDir(directory);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const kind = entry.kind === "directory" ? null : kindOf(entry.name);

      if (kind === null || !kinds.includes(kind) || seen.has(entry.name)) {
        continue;
      }

      seen.add(entry.name);
      found.push({
        kind,
        fileName: entry.name,
        command: join(directory, entry.name),
      });
    }
  }

  const result: Discovery = { plugins: [], unreadable: [] };

  for (const { kind, fileName, command } of found) {
    const read = readManifest(io, command);

    if (!read.ok) {
      result.unreadable.push({ command, reason: read.reason });

      continue;
    }

    const { manifest } = read;
    const name = fileName.slice(PREFIXES[kind].length);

    if (manifest.kind !== kind) {
      result.unreadable.push({
        command,
        reason: `${command} manifest kind is ${manifest.kind}, not ${kind}`,
      });
    } else if (manifest.name !== name) {
      result.unreadable.push({
        command,
        reason: `${command} manifest name is ${manifest.name}, not ${name}`,
      });
    } else {
      result.plugins.push({
        kind,
        name,
        command,
        manifest,
        judgement: judgeProtocol(manifest),
      });
    }
  }

  return result;
}

export function findOnPath(io: Io, program: string): string | null {
  for (const directory of pathDirectories(io)) {
    const path = join(directory, program);

    if (io.exists(path)) {
      return path;
    }
  }

  return null;
}

export function supportedRange(current: number = CURRENT_PROTOCOL): string {
  return current > 1
    ? `protocols ${current - 1} and ${current}`
    : `protocol ${current}`;
}

export function unsupportedMessage(
  plugin: { kind: PluginKind; name: string; manifest: Manifest },
  install: string = plugin.manifest.install,
): string {
  return `${programName(plugin.kind, plugin.name)} speaks protocol ${plugin.manifest.protocol} and recognizer supports ${supportedRange()}: install ${install}`;
}
