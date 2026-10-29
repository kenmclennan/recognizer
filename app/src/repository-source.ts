import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Changes, ScanOrigin } from "./footer-scan";
import type { ScanReport } from "./scan-report";

export const repositorySource = {
  windowFolder: () => invoke<string | null>("window_folder"),
  scanFolder: () => invoke<ScanReport>("scan_folder"),
  adoptScan: () => invoke<ScanOrigin>("adopt_scan"),
  watchChanges: () => invoke<void>("watch_changes"),
  sourceLine: (relative: string, line: number) =>
    invoke<string | null>("read_source_line", { relative, line }),
  chooseFolder: () => invoke<void>("choose_folder"),
  onFolderAssigned: (run: () => void) => listen("folder-assigned", () => run()),
  onRescan: (run: () => void) => listen("rescan", () => run()),
  onChanges: (run: (changes: Changes) => void) =>
    listen<Changes>("changes-changed", (event) => run(event.payload)),
};

export type RepositorySource = typeof repositorySource;
