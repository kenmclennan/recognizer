import type { Repository } from "./repository.js";
import type { ResponsibilityKinds } from "./scan-plan.js";

export interface StructureRepository {
  exists(root: string): boolean;
  read(root: string): Repository;
  save(root: string, language: string, scanned: Repository): void;
  discard(root: string, language: string): boolean;
  responsibilityKinds(root: string): ResponsibilityKinds;
}
