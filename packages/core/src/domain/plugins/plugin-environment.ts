export const TOOLCHAIN_COMMANDS_VARIABLE = "RECOGNIZER_TOOLCHAIN_COMMANDS";

export interface PluginBootstrap {
  readonly pairs: Readonly<Record<string, string>>;
  readonly toolchainFolder: string | null;
}

export interface PluginEnvironment {
  readonly pairs: Readonly<Record<string, string>>;
}

export function pluginEnvironment(
  bootstrap: PluginBootstrap,
): PluginEnvironment {
  const { toolchainFolder } = bootstrap;
  const { [TOOLCHAIN_COMMANDS_VARIABLE]: _handoff, ...pairs } = bootstrap.pairs;

  if (toolchainFolder === null) {
    return { pairs };
  }

  const login = pairs.PATH ?? "";
  const path = login === "" ? toolchainFolder : `${toolchainFolder}:${login}`;

  return { pairs: { ...pairs, PATH: path } };
}
