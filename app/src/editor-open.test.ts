import { describe, expect, it } from "vitest";
import { fakeEditor } from "./editor-fake";
import {
  editorRelative,
  openFolderInEditor,
  openInEditor,
} from "./editor-open";

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
