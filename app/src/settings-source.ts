import { invoke } from "@tauri-apps/api/core";

export type Settings = {
  editor: string;
};

export const settingsSource = {
  read: () => invoke<Settings>("read_settings"),
  write: (settings: Settings) => invoke<void>("write_settings", { settings }),
};
