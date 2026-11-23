import type { PluginPorts } from "@recognizer/core";
import { PluginRegistryAdapter } from "./adapters/filesystem/plugin-registry-adapter.js";
import { CheckSandboxAdapter } from "./adapters/plugins/check-sandbox-adapter.js";
import { PluginTemplatesAdapter } from "./adapters/plugins/plugin-templates-adapter.js";
import { RepositoryChecksAdapter } from "./adapters/plugins/repository-checks-adapter.js";
import { SensorChecksAdapter } from "./adapters/plugins/sensor-checks-adapter.js";
import type { Io } from "./cli.js";
import { shippedPorts } from "./manifest-ports.js";

export function pluginPorts(io: Io): PluginPorts {
  return {
    ...shippedPorts(io),
    sandbox: new CheckSandboxAdapter(io),
    registry: new PluginRegistryAdapter(io),
    templates: new PluginTemplatesAdapter(),
    sensorChecks: new SensorChecksAdapter(io),
    repository: new RepositoryChecksAdapter(io),
  };
}
