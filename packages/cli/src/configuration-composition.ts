import {
  type ConfigurationPorts,
  configurationOver,
  type SetupScan,
  setupReadsOver,
} from "@recognizer/core";
import { ConfigAdapter } from "./adapters/filesystem/config-adapter.js";
import { ConfigKeysAdapter } from "./adapters/filesystem/config-keys-adapter.js";
import { PolicyAdapter } from "./adapters/filesystem/policy-adapter.js";
import { RepositoryFilesAdapter } from "./adapters/filesystem/repository-files-adapter.js";
import { ScanLockAdapter } from "./adapters/filesystem/scan-lock-adapter.js";
import { SetupFilesAdapter } from "./adapters/filesystem/setup-files-adapter.js";
import { YamlKeyedTextAdapter } from "./adapters/filesystem/yaml-keyed-text-adapter.js";
import { KeyOwnersAdapter } from "./adapters/plugins/key-owners-adapter.js";
import { ProgramsAdapter } from "./adapters/plugins/programs-adapter.js";
import { ScannersAdapter } from "./adapters/plugins/scanners-adapter.js";
import { SurveyPluginsAdapter } from "./adapters/plugins/survey-plugins-adapter.js";
import { AssistantAdapter } from "./adapters/system/assistant-adapter.js";
import { ClockAdapter } from "./adapters/system/clock-adapter.js";
import { type Io, packageVersion } from "./cli.js";
import { environmentIo } from "./environment-io.js";
import { pluginPorts } from "./plugins-container.js";

export interface ConfigurationOptions {
  environment?: Readonly<Record<string, string>>;
  scan?: SetupScan;
}

export const NO_SETUP_SCAN: SetupScan = {
  extract: async () => ({
    ok: false,
    reason: "the extract-only scan is not available here",
  }),
};

export function configurationPorts(
  io: Io,
  options: ConfigurationOptions = {},
): ConfigurationPorts {
  const own =
    options.environment === undefined
      ? io
      : environmentIo(io, options.environment);

  return {
    files: new SetupFilesAdapter(own),
    listing: new RepositoryFilesAdapter(own),
    plugins: new SurveyPluginsAdapter(own),
    assistant: new AssistantAdapter(own),
    scan: options.scan ?? NO_SETUP_SCAN,
    keys: new ConfigKeysAdapter(),
    keyedText: new YamlKeyedTextAdapter(),
    keyOwners: new KeyOwnersAdapter(own),
    config: new ConfigAdapter(own, "all"),
    policy: new PolicyAdapter(own),
    programs: new ProgramsAdapter(own),
    lock: new ScanLockAdapter(own),
    clock: new ClockAdapter(own),
    reads: setupReadsOver({
      plugins: pluginPorts(own),
      scanners: new ScannersAdapter(own),
    }),
    version: packageVersion(),
  };
}

export function configurationFor(io: Io, options: ConfigurationOptions = {}) {
  return configurationOver(configurationPorts(io, options));
}
