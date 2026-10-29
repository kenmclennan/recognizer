export type EditorPort = {
  openFile(relative: string): Promise<void>;
  openFolder(): Promise<void>;
};

export const inertEditor: EditorPort = {
  openFile: async () => {},
  openFolder: async () => {},
};
