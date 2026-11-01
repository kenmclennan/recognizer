import { invoke } from "@tauri-apps/api/core";
import type { EditorPort } from "./editor-port";

export const editorSource: EditorPort = {
  openFile: (relative, line) =>
    invoke<void>("open_in_editor", { relative, line }),
  openFolder: () => invoke<void>("open_folder_in_editor"),
};
