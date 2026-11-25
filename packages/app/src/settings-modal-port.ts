import type { SettingsPane } from "./settings-modal-model";

export type Settings = {
  values: Record<string, string>;
};

export type SettingEdit = {
  key: string;
  value: string | number | boolean;
};

export type RepositoryEdit = {
  op: "set" | "unset" | "add-section";
  key: string;
  value?: string;
};

export type ConfigKeysResult =
  | { status: "ok"; schema: unknown }
  | { status: "unavailable"; reason: string };

export type PanesResult =
  | { status: "ok"; panes: SettingsPane[] }
  | { status: "unavailable"; reason: string };

export type WriteResult =
  | { status: "written"; text: string }
  | { status: "refused"; key: string | null; reason: string }
  | { status: "changed"; reason: string }
  | { status: "unavailable"; reason: string };

export type SettingsModalPort = {
  readSettings(): Promise<Settings>;
  writeSettings(edits: SettingEdit[]): Promise<void>;
  readPanes(): Promise<PanesResult>;
  readConfigKeys(): Promise<ConfigKeysResult>;
  writeRepositoryConfig(
    edits: RepositoryEdit[],
    baseHash: string,
  ): Promise<WriteResult>;
};
