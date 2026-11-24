export interface ScanFileText {
  readonly file: string;
  readonly text: string;
}

export interface ScanCache {
  read(root: string): readonly ScanFileText[];
}
