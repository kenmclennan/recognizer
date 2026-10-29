import type { EditorPort } from "./editor-port";

export type FakeEditor = EditorPort & {
  files: string[];
  folders: number;
};

export function fakeEditor(failWith: string | null = null): FakeEditor {
  const fake: FakeEditor = {
    files: [],
    folders: 0,
    async openFile(relative) {
      if (failWith !== null) {
        throw new Error(failWith);
      }

      fake.files.push(relative);
    },
    async openFolder() {
      if (failWith !== null) {
        throw new Error(failWith);
      }

      fake.folders += 1;
    },
  };

  return fake;
}
