import {
  resolvePluginEnvironment,
  TOOLCHAIN_COMMANDS_VARIABLE,
} from "@recognizer/core";

export function toolchainFolderFrom(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const folder = env[TOOLCHAIN_COMMANDS_VARIABLE];

  return folder === undefined || folder === "" ? null : folder;
}

export function pluginEnvironmentFrom(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const pairs: Record<string, string> = {};

  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      pairs[name] = value;
    }
  }

  return {
    ...resolvePluginEnvironment({
      pairs,
      toolchainFolder: toolchainFolderFrom(env),
    }),
  };
}
