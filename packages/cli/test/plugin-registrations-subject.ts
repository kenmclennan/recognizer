import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginRegistrations } from "@recognizer/core";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { type Io, nodeIo } from "../src/cli.js";
import type { RegistrationsSubject } from "./plugin-registrations-cases.js";

export function ioOverFolders(folders: { homebrew: string; user: string }): Io {
  return {
    ...nodeIo(),
    env: (name: string) =>
      name === "RECOGNIZER_PLUGIN_DIRS"
        ? `${folders.homebrew}:${folders.user}`
        : undefined,
  };
}

export function realSubject(
  make: (io: Io) => PluginRegistrations,
): RegistrationsSubject & { folders: { homebrew: string; user: string } } {
  const root = makeTempDir("recognizer-registrations-");
  const folders = { homebrew: join(root, "brew"), user: join(root, "user") };

  return {
    folders,
    registrations: make(ioOverFolders(folders)),
    place: (source, fileName, text, modified) => {
      mkdirSync(folders[source], { recursive: true });

      const path = join(folders[source], fileName);

      writeFileSync(path, text);
      utimesSync(path, modified, modified);
    },
    present: (source, fileName) => existsSync(join(folders[source], fileName)),
  };
}
