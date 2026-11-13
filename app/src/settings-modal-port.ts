export type Settings = {
  editor: string;
  describing: { model: string; batchSize: number; confirmAboveUsd: number };
};

export type RepositoryEdit = {
  op: "set" | "unset" | "add-section";
  key: string;
  value?: string;
};

export type ConfigKeysResult =
  | { status: "ok"; schema: unknown }
  | { status: "unavailable"; reason: string };

export type WriteResult =
  | { status: "written"; text: string }
  | { status: "refused"; key: string | null; reason: string }
  | { status: "changed"; reason: string }
  | { status: "unavailable"; reason: string };

export type SettingsModalPort = {
  readSettings(): Promise<Settings>;
  writeSettings(settings: Settings): Promise<void>;
  readConfigKeys(): Promise<ConfigKeysResult>;
  writeRepositoryConfig(
    edits: RepositoryEdit[],
    baseHash: string,
  ): Promise<WriteResult>;
};
