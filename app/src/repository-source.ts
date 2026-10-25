import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ScanReport } from "./scan-report";

export const repositorySource = {
  windowFolder: () => invoke<string | null>("window_folder"),
  scanFolder: () => invoke<ScanReport>("scan_folder"),
  chooseFolder: () => invoke<void>("choose_folder"),
  onFolderAssigned: (run: () => void) => listen("folder-assigned", () => run()),
};

export type RepositorySource = typeof repositorySource;
