import {
  type PluginKind,
  registrationFileName,
  serializeRegistration,
} from "@recognizer/core";

export const REGISTRY_FOLDER = "/fake-registry";

export interface RegisteredEntry {
  kind: PluginKind;
  name: string;
  command?: string[];
  manifest?: string[];
}

const PREFIX: Record<PluginKind, string> = {
  scanner: "recognizer-scan-",
  sensor: "recognizer-sense-",
  describer: "recognizer-describe-",
};

export function registeredPlugins(entries: RegisteredEntry[]): {
  files: Record<string, string>;
  env: Record<string, string>;
} {
  const files: Record<string, string> = {};

  for (const entry of entries) {
    const program = `${PREFIX[entry.kind]}${entry.name}`;
    const command = entry.command ?? [program];

    files[
      `${REGISTRY_FOLDER}/${registrationFileName(entry.kind, entry.name)}`
    ] = serializeRegistration({
      kind: entry.kind,
      name: entry.name,
      command,
      manifest: entry.manifest ?? [...command, "manifest"],
    });
  }

  return { files, env: { RECOGNIZER_PLUGIN_DIRS: `:${REGISTRY_FOLDER}` } };
}
