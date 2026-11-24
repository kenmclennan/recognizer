export interface FileStamp {
  readonly modified: number | null;
  readonly length: number;
}

export interface WorkTree {
  isFile(root: string, relative: string): Promise<boolean>;
  stamp(root: string, relative: string): Promise<FileStamp | null>;
  hash(root: string, relative: string): Promise<string | null>;
  exists(root: string, relative: string): Promise<boolean>;
  walk(
    root: string,
    relative: string,
    descend: (path: string) => Promise<boolean>,
  ): Promise<readonly string[]>;
}
