import type { DescriberBuild } from "../../domain/config-repository.js";
import type { ScanningQueries } from "./internal/scanning-ports.js";

export interface ScannerSetup {
  scanners: Record<string, string>;
  install: Record<string, string>;
  describerBuild: DescriberBuild | null;
}

export function readScannerSetup(
  ports: ScanningQueries,
  root: string,
): ScannerSetup {
  return ports.config.scannerSetup(root);
}
