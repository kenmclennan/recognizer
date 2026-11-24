import type { PolicyRule } from "./policy-rule.js";
import type { RepositoryText } from "./repository-text.js";

export interface PolicyRepository {
  rules(root: string): readonly PolicyRule[] | null;
  rulesAt(path: string): readonly PolicyRule[];
  defaultFile(root: string): string | null;
  document(root: string): Record<string, unknown>;
  text(root: string): RepositoryText;
  saveText(root: string, text: string): void;
  problems(text: string): string[];
  parseDocument(document: Record<string, unknown>): readonly PolicyRule[];
}
