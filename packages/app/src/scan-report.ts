export type StructureScan = { file: string; document: unknown };

export type ScanReport = {
  scans: StructureScan[];
  notices: string[];
};
