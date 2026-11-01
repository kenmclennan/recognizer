export type EditorPort = {
  openFile(relative: string, line?: number): Promise<void>;
  openFolder(): Promise<void>;
};

export const inertEditor: EditorPort = {
  openFile: async () => {},
  openFolder: async () => {},
};
