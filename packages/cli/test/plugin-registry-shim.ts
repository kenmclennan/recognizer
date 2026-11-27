import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { PluginKind } from "@recognizer/core";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { PluginRegistrationsAdapter } from "../src/adapters/filesystem/plugin-registrations-adapter.js";
import { type Io, nodeIo } from "../src/cli.js";

const PROGRAM = /^recognizer-(scan|sense|describe)-([a-z0-9][a-z0-9_-]*)$/;
const KINDS: Record<string, PluginKind> = {
  scan: "scanner",
  sense: "sensor",
  describe: "describer",
};
const folders = new Map<string, string>();
const linked = new Map<string, Set<string>>();

export function linkRegistryFolder(
  shimDirectory: string,
  registry: string,
): void {
  const own = registryFolderFor(shimDirectory);

  if (existsSync(own)) {
    for (const name of readdirSync(own)) {
      copyFileSync(join(own, name), join(registry, name));
    }
  }

  const known = linked.get(shimDirectory) ?? new Set<string>();

  known.add(registry);
  linked.set(shimDirectory, known);
}

export function registryFolderFor(shimDirectory: string): string {
  const known = folders.get(shimDirectory);

  if (known !== undefined) {
    return known;
  }

  const made = makeTempDir("recognizer-shim-registry-");

  folders.set(shimDirectory, made);

  return made;
}

export function registryIo(registry: string): Io {
  return {
    ...nodeIo(),
    env: (name) =>
      name === "RECOGNIZER_PLUGIN_DIRS" ? `:${registry}` : undefined,
  };
}

export function registerShim(path: string): string | undefined {
  const match = PROGRAM.exec(basename(path));

  if (match === null) {
    return undefined;
  }

  const [, verb = "", name = ""] = match;
  const registry = registryFolderFor(dirname(path));

  const entry = {
    kind: KINDS[verb] as PluginKind,
    name,
    command: [path],
    manifest: [path, "manifest"],
    source: "user" as const,
  };

  for (const folder of [registry, ...(linked.get(dirname(path)) ?? [])]) {
    new PluginRegistrationsAdapter(registryIo(folder)).register(entry);
  }

  return join(registry);
}

export function useRegisteredShims(...shimDirectories: string[]): () => void {
  const registry = makeTempDir("recognizer-registered-shims-");
  const saved = process.env.RECOGNIZER_PLUGIN_DIRS;

  for (const directory of shimDirectories) {
    linkRegistryFolder(directory, registry);
  }

  process.env.RECOGNIZER_PLUGIN_DIRS = `:${registry}`;

  return () => {
    if (saved === undefined) {
      delete process.env.RECOGNIZER_PLUGIN_DIRS;
    } else {
      process.env.RECOGNIZER_PLUGIN_DIRS = saved;
    }
  };
}
