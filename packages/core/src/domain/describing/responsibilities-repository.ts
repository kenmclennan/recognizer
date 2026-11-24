import type { Responsibilities } from "./responsibilities.js";

export interface ResponsibilitiesRepository {
  read(root: string): Responsibilities;
  write(root: string, responsibilities: Responsibilities): void;
}
