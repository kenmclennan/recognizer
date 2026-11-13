import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { type Config, readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { detectLanguages } from "./detect.js";
import { InputError } from "./errors.js";
import {
  discoverPlugins,
  type InstalledPlugin,
  KINDS,
  programName,
} from "./plugin-discovery.js";
import { chooseScanner, languageRulesOf } from "./scanners.js";

const USAGE = ["usage: recognizer plugins [REPOSITORY] [--json]"];

const UNUSED = "-";

function scannerUse(
  io: Io,
  root: string,
  scanners: InstalledPlugin[],
  named: Record<string, string>,
): Map<string, string[]> {
  const used = new Map<string, string[]>();

  for (const language of detectLanguages(io, root, languageRulesOf(scanners))) {
    const choice = chooseScanner(language, scanners, named[language]);

    if (choice.ok) {
      used.set(choice.scanner.name, [
        ...(used.get(choice.scanner.name) ?? []),
        language,
      ]);
    }
  }

  return used;
}

function readRegistration(io: Io, root: string): Config | null {
  try {
    return readConfig(io, root, ["sensors", "describer", "scanners"]);
  } catch {
    return null;
  }
}

function isRegistered(plugin: InstalledPlugin, config: Config): boolean {
  const program = programName(plugin.kind, plugin.name);

  return plugin.kind === "sensor"
    ? registeredSensors(config).some((one) => one.command[0] === program)
    : config.describer?.command[0] === program;
}

const ORDER = new Map(KINDS.map((kind, at) => [kind, at]));

export function runPlugins(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });

  if (positionals.length > 1) {
    throw new InputError(USAGE);
  }

  const root = resolve(positionals[0] ?? ".");

  try {
    io.readDir(root);
  } catch {
    throw new InputError([`repository is not a directory: ${root}`]);
  }

  const { plugins, unreadable } = discoverPlugins(io);
  const config = readRegistration(io, root);
  const scanners = plugins.filter((one) => one.kind === "scanner");
  const chosen =
    config === null
      ? new Map<string, string[]>()
      : scannerUse(io, root, scanners, config.scanners ?? {});
  const sorted = [...plugins].sort(
    (a, b) =>
      (ORDER.get(a.kind) as number) - (ORDER.get(b.kind) as number) ||
      a.name.localeCompare(b.name),
  );
  const usedBy = (plugin: InstalledPlugin): string => {
    if (config === null) {
      return UNUSED;
    }

    if (plugin.kind === "scanner") {
      const languages = chosen.get(plugin.name);

      return languages === undefined
        ? UNUSED
        : `scanner for ${languages.join(", ")}`;
    }

    return isRegistered(plugin, config) ? "registered" : UNUSED;
  };

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify(
        sorted.map((plugin) => ({
          kind: plugin.kind,
          name: plugin.name,
          command: plugin.command,
          version: plugin.manifest.version,
          protocol: plugin.manifest.protocol,
          range: plugin.judgement,
          used_by: usedBy(plugin),
          install: plugin.manifest.install,
        })),
        null,
        2,
      )}\n`,
    );
  } else if (sorted.length > 0) {
    io.stdout(
      `${sorted
        .map(
          (plugin) =>
            `${plugin.kind}  ${plugin.name}  ${plugin.manifest.version}  protocol ${plugin.manifest.protocol}  ${plugin.judgement}  ${usedBy(plugin)}`,
        )
        .join("\n")}\n`,
    );
  }

  for (const { command, reason } of unreadable) {
    io.stderr(`${command}: ${reason}\n`);
  }

  return unreadable.length === 0 ? 0 : 1;
}
