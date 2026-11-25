import type { KeySchema } from "../../../domain/configuration/published-keys.js";

export interface KeyOwners {
  schemas(root?: string): { schema: KeySchema; notAnswering: string[] };
}
