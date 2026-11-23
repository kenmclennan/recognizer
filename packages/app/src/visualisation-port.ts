import type { View, ViewFields } from "@recognizer/core";

export type ParsedView =
  | { ok: true; view: View; warnings: string[] }
  | { ok: false; reason: string };

export interface VisualisationPort {
  parse(text: string): Promise<ParsedView>;
  serialise(view: ViewFields): Promise<string>;
}
