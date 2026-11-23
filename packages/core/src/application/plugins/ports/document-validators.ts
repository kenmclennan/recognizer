import type { PluginFacts } from "../../../domain/plugins/manifest.js";

export interface DocumentValidators {
  readonly facts: PluginFacts;
  manifest(value: unknown): string | null;
  scan(value: unknown): string | null;
  findings(value: unknown, expected?: { name?: string }): string | null;
  check(value: unknown): string | null;
  event(value: unknown): boolean;
}
