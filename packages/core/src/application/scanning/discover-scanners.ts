import type { ScanningQueries } from "./internal/scanning-ports.js";

export interface ScannerDiscovery {
  installed: number;
}

export function discoverScanners(ports: ScanningQueries): ScannerDiscovery {
  return ports.scanners.discover();
}
