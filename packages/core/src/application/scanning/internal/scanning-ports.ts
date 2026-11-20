import type { Store } from "../../shared/ports/store.js";
import type {
  ScannerQueries,
  Scanners,
  SyncScanners,
} from "../ports/scanners.js";

export interface ScanningQueries {
  scanners: ScannerQueries;
  store: Store;
}

export interface ScanningPorts extends ScanningQueries {
  scanners: Scanners;
}

export interface SyncScanningPorts extends ScanningQueries {
  scanners: SyncScanners;
}
