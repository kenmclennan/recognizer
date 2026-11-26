import type { PluginPorts } from "@recognizer/core";
import { PluginRegistrationsAdapter } from "./adapters/filesystem/plugin-registrations-adapter.js";
import { PluginRegistryAdapter } from "./adapters/filesystem/plugin-registry-adapter.js";
import { CheckSandboxAdapter } from "./adapters/plugins/check-sandbox-adapter.js";
import { PluginTemplatesAdapter } from "./adapters/plugins/plugin-templates-adapter.js";
import { RepositoryChecksAdapter } from "./adapters/plugins/repository-checks-adapter.js";
import type { Io } from "./cli.js";
import { manifestPorts } from "./manifest-ports.js";

export function pluginPorts(io: Io): PluginPorts {
  return {
    ...manifestPorts(io),
    sandbox: new CheckSandboxAdapter(io),
    registry: new PluginRegistryAdapter(io),
    registrations: new PluginRegistrationsAdapter(io),
    templates: new PluginTemplatesAdapter(),
    repository: new RepositoryChecksAdapter(io),
  };
}
