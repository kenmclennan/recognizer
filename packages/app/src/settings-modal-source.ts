import { invoke } from "@tauri-apps/api/core";
import { coreReply } from "./scan-source";
import type {
  ConfigKeysResult,
  PanesResult,
  RepositoryEdit,
  SettingEdit,
  Settings,
  SettingsModalPort,
  WriteResult,
} from "./settings-modal-port";
import { applyEdits, type StoredSettings, toValues } from "./settings-values";

const readStored = () => invoke<StoredSettings>("read_settings");

export const settingsModalSource: SettingsModalPort = {
  readSettings: async (): Promise<Settings> => toValues(await readStored()),
  writeSettings: async (edits: SettingEdit[]) =>
    invoke<void>("write_settings", {
      settings: applyEdits(await readStored(), edits),
    }),
  readPanes: async () =>
    coreReply<PanesResult>(
      await invoke<unknown>("core_call", { op: "settings.panes", args: {} }),
    ),
  readConfigKeys: () => invoke<ConfigKeysResult>("read_config_keys"),
  writeRepositoryConfig: (edits: RepositoryEdit[], baseHash: string) =>
    invoke<WriteResult>("write_repository_config", { edits, baseHash }),
};
