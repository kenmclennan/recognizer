import type { PolicyRepository, PolicyRule } from "../../src/index.js";

export class FakePolicyRepository implements PolicyRepository {
  rules(): readonly PolicyRule[] | null {
    return [];
  }
}
