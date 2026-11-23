import type { Repository } from "../../../domain/repository.js";
import type { RunEntry } from "../../../domain/run-record.js";
import type { PluginProgress } from "../../../domain/scan-event.js";
import type { PluginLimits, Say } from "../../shared/ports/process.js";

export type ExtractionDecision =
  | { run: true; reason: string }
  | { run: false; commit: string };

export interface ExtractCall {
  root: string;
  language: string;
  commit: string | null;
  modified: boolean | null;
  limits: PluginLimits;
  onEvent: (name: string, event: PluginProgress) => void;
  say: Say;
}

export type ExtractResult =
  | {
      ok: true;
      entry: RunEntry;
      bytes: string;
      modules: number;
      edges: number;
    }
  | { ok: false; entry: RunEntry; reason: string; message: string };

export interface ScannerQueries {
  discover(): { installed: number };
  detect(root: string, named: Record<string, string>): string[];
  decide(
    root: string,
    force: boolean,
    commit: string | null,
    dirty: boolean,
  ): ExtractionDecision;
  cachedLanguages(root: string): string[];
  readCached(root: string, language: string): Repository | null;
  scanFile(root: string, language: string): string;
  previousProtocolNote(
    language: string,
  ): { scanner: string; text: string } | null;
}

export interface Scanners extends ScannerQueries {
  extract(call: ExtractCall): Promise<ExtractResult>;
}

export interface SyncScanners extends ScannerQueries {
  extract(call: ExtractCall): ExtractResult;
}
