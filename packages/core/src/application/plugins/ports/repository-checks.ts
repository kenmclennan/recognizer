import type { InstalledPlugin } from "../../../domain/plugins/installed-plugin.js";
import type { PolicyRule } from "../../../domain/policy-rule.js";
import type { PublishedValues } from "../../configuration/inspect-config-document.js";
import type { CachedScansState } from "../../shared/cached-scans-state.js";

export type ConfigDocumentRead =
  | { kind: "absent" }
  | { kind: "unparseable"; message: string }
  | { kind: "parsed"; document: unknown };

export type PolicyParse =
  | { ok: true; rules: PolicyRule[] }
  | { ok: false; messages: string[] };

export type PolicyFacts =
  | { kind: "absent" }
  | {
      kind: "read";
      keys: string[];
      parsed: PolicyParse;
    };

export interface RepositoryChecks {
  isDirectory(root: string): boolean;
  languages(root: string, scanners: readonly InstalledPlugin[]): string[];
  configDocument(root: string): ConfigDocumentRead;
  configSchemaMessages(document: unknown): string[];
  publishedKeys(root: string): PublishedValues;
  policyFacts(root: string): PolicyFacts;
  scansState(root: string, languages: readonly string[]): CachedScansState;
  registeredSensors(
    root: string,
  ): { name: string; command: string[]; manifest?: string[] }[];
  suites(root: string): readonly unknown[] | undefined;
}
