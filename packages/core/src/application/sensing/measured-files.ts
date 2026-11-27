import type { PolicyRule } from "../../domain/policy-rule.js";
import type { Repository } from "../../domain/repository.js";
import { measuredModules } from "../analysis/sense-structure.js";
import type { DocumentFreshness } from "./freshness.js";

export function measuredFiles(
  repository: Repository,
  policy: readonly PolicyRule[] | null,
  sensor: string,
  freshness: DocumentFreshness,
): string[] {
  if (sensor !== "structure") {
    return [...freshness.current];
  }

  const covered = measuredModules(repository, policy);

  return freshness.current.filter((file) => covered.has(file));
}
