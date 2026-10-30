export type ScanReport =
  | { status: "command-missing"; hint: string }
  | { status: "config-invalid"; message: string }
  | { status: "scan-failed"; exitCode: number; stderr: string }
  | {
      status: "scanned";
      exitCode: 0 | 1;
      stderr: string;
      scans: { file: string; text: string }[];
      policy: string | null;
      baseline?: string | null;
    };
