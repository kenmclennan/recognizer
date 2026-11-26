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

  new PluginRegistrationsAdapter(registryIo(registry)).register({
    kind: KINDS[verb] as PluginKind,
    name,
    command: [path],
    manifest: [path, "manifest"],
    source: "user",
  });

  return join(registry);
}
