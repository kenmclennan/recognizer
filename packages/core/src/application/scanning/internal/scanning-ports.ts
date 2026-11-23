import type { ConfigRepository } from "../../../domain/config-repository.js";
import type { StructureRepository } from "../../../domain/structure-repository.js";
import type {
  ScannerQueries,
  Scanners,
  SyncScanners,
} from "../ports/scanners.js";

export interface ScanningQueries {
  scanners: ScannerQueries;
  structure: StructureRepository;
  config: ConfigRepository;
}

export interface ScanningPorts extends ScanningQueries {
  scanners: Scanners;
}

export interface SyncScanningPorts extends ScanningQueries {
  scanners: SyncScanners;
}
