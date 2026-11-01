import type { EditorPort } from "./editor-port";

export type FakeEditor = EditorPort & {
  files: string[];
  opened: { file: string; line: number | undefined }[];
  folders: number;
};

export function fakeEditor(failWith: string | null = null): FakeEditor {
  const fake: FakeEditor = {
    files: [],
    opened: [],
    folders: 0,
    async openFile(relative, line) {
      if (failWith !== null) {
        throw new Error(failWith);
      }

      fake.files.push(relative);
      fake.opened.push({ file: relative, line });
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
