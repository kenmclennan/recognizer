import { describe, expect, it } from "vitest";
import {
  editorRelative,
  openFolderInEditor,
  openInEditor,
} from "../../src/editor-open";
import type { EditorPort } from "../../src/editor-port";

function fakeEditor(failWith: string | null = null) {
  const recorded: EditorPort & {
    files: string[];
    opened: { file: string; line: number | undefined }[];
    folders: number;
  } = {
    files: [],
    opened: [],
    folders: 0,
    async openFile(relative, line) {
      if (failWith !== null) {
        throw new Error(failWith);
      }

      recorded.files.push(relative);
      recorded.opened.push({ file: relative, line });
    },
    async openFolder() {
      if (failWith !== null) {
        throw new Error(failWith);
      }

      recorded.folders += 1;
    },
  };

  return recorded;
}

describe("opening the selection in the editor", () => {
  it("opens a module's id as a file", async () => {
    const editor = fakeEditor();

    await openInEditor({ kind: "module", id: "src/a.ts" }, editor, () => {});

    expect(editor.files).toEqual(["src/a.ts"]);
  });

  it("opens a folder's path as an entry", async () => {
    const editor = fakeEditor();

    await openInEditor({ kind: "folder", id: "src/deep" }, editor, () => {});

    expect(editor.files).toEqual(["src/deep"]);
  });

  it("passes a line to the editor, and undefined without one", async () => {
    const editor = fakeEditor();

    await openInEditor({ kind: "module", id: "src/a.ts" }, editor, () => {}, 7);
    await openInEditor({ kind: "module", id: "src/b.ts" }, editor, () => {});

    expect(editor.opened).toEqual([
      { file: "src/a.ts", line: 7 },
      { file: "src/b.ts", line: undefined },
    ]);
  });

  it("opens nothing for an edge or no selection", async () => {
    const editor = fakeEditor();

    await openInEditor({ kind: "edge", id: "a>b" }, editor, () => {});
    await openInEditor(null, editor, () => {});

    expect(editor.files).toEqual([]);
    expect(editorRelative(null)).toBeNull();
  });

  it("shows a rejected open through notify", async () => {
    const shown: string[] = [];

    await openInEditor(
      { kind: "module", id: "src/a.ts" },
      fakeEditor("could not start code"),
      (text) => shown.push(text),
    );

    expect(shown).toEqual(["could not start code"]);
  });

  it("opens the repository folder and shows a rejection", async () => {
    const editor = fakeEditor();
    const shown: string[] = [];

    await openFolderInEditor(editor, (text) => shown.push(text));
    await openFolderInEditor(fakeEditor("no"), (text) => shown.push(text));

    expect(editor.folders).toBe(1);
    expect(shown).toEqual(["no"]);
  });
});
