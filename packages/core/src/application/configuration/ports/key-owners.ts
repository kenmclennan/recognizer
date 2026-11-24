import type { KeySchema } from "../../../domain/configuration/published-keys.js";

export interface KeyOwners {
  schemas(): { schema: KeySchema; notAnswering: string[] };
}
