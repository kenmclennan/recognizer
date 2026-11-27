export type FileChange = {
  path: string;
  kind: "modified" | "added" | "deleted";
};

export type Changes = {
  files: FileChange[];
  moved: { branch: string | null; commit: string } | null;
};

export type ScanOrigin = { branch: string | null; commit: string | null };

export type ScanState = {
  origin: ScanOrigin;
  scannedAt: number;
  changes: Changes;
  scanning: string | null;
};

export const NO_CHANGES: Changes = { files: [], moved: null };
