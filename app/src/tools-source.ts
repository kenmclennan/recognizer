import { invoke } from "@tauri-apps/api/core";
import type { ToolsReport } from "./tools-notice";

export const toolsSource = {
  recognizerVersion: () => invoke<ToolsReport>("recognizer_version"),
};
