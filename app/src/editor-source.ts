import { invoke } from "@tauri-apps/api/core";
import type { EditorPort } from "./editor-port";

export const editorSource: EditorPort = {
  openFile: (relative) => invoke<void>("open_in_editor", { relative }),
  openFolder: () => invoke<void>("open_folder_in_editor"),
};
