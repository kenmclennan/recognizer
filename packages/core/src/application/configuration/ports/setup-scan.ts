export type SetupScanOutcome = { ok: true } | { ok: false; reason: string };

export interface SetupScan {
  extract(
    root: string,
    onLine: (line: string) => void,
  ): Promise<SetupScanOutcome>;
}
