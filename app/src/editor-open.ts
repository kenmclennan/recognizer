import type { Selection } from "./canvas-state";
import type { EditorPort } from "./editor-port";

export function editorRelative(selection: Selection): string | null {
  return selection === null || selection.kind === "edge" ? null : selection.id;
}

export async function openInEditor(
  selection: Selection,
  editor: EditorPort,
  notify: (text: string) => void,
): Promise<void> {
  const relative = editorRelative(selection);

  if (relative === null) {
    return;
  }

  try {
    await editor.openFile(relative);
  } catch (error) {
    notify(String(error instanceof Error ? error.message : error));
  }
}

export async function openFolderInEditor(
  editor: EditorPort,
  notify: (text: string) => void,
): Promise<void> {
  try {
    await editor.openFolder();
  } catch (error) {
    notify(String(error instanceof Error ? error.message : error));
  }
}
