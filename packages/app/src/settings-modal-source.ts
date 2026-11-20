import { invoke } from "@tauri-apps/api/core";
import type {
  ConfigKeysResult,
  RepositoryEdit,
  Settings,
  SettingsModalPort,
  WriteResult,
} from "./settings-modal-port";

export const settingsModalSource: SettingsModalPort = {
  readSettings: () => invoke<Settings>("read_settings"),
  writeSettings: (settings) => invoke<void>("write_settings", { settings }),
  readConfigKeys: () => invoke<ConfigKeysResult>("read_config_keys"),
  writeRepositoryConfig: (edits: RepositoryEdit[], baseHash: string) =>
    invoke<WriteResult>("write_repository_config", { edits, baseHash }),
};
