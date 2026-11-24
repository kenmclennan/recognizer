import type { ExtractionSelection } from "../../../domain/extraction.js";

export interface RecordedScan {
  readonly files: readonly { readonly path: string; readonly hash: string }[];
  readonly selection: ExtractionSelection;
}

export interface RecordedScans {
  read(root: string): readonly RecordedScan[];
}
