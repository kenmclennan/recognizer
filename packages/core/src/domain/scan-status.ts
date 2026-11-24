export type ScanStatus =
  | { running: false }
  | {
      running: true;
      phase: string;
      sensors: string[];
      describe: boolean;
      startedBy: string;
      refusal?: string;
    };
