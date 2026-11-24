import type { Repository } from "./repository.js";

export interface StructureRepository {
  exists(root: string): boolean;
  read(root: string): Repository;
  save(root: string, language: string, scanned: Repository): void;
  discard(root: string, language: string): boolean;
}
