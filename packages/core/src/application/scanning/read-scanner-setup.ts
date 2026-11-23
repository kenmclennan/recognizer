import type { ScanningQueries } from "./internal/scanning-ports.js";

export interface ScannerSetup {
  scanners: Record<string, string>;
  install: Record<string, string>;
}

export function readScannerSetup(
  ports: ScanningQueries,
  root: string,
): ScannerSetup {
  return ports.config.scannerSetup(root);
}
