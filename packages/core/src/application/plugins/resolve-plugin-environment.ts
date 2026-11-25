import {
  type PluginBootstrap,
  pluginEnvironment,
} from "../../domain/plugins/plugin-environment.js";

export function resolvePluginEnvironment(
  bootstrap: PluginBootstrap,
): Readonly<Record<string, string>> {
  return pluginEnvironment(bootstrap).pairs;
}
