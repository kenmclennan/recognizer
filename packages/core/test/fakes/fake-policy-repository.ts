import type { PolicyRepository, PolicyRule } from "../../src/index.js";

export class FakePolicyRepository implements PolicyRepository {
  held: readonly PolicyRule[] | null = [];
  file: string | null = null;

  rules(): readonly PolicyRule[] | null {
    return this.held;
  }

  rulesAt(): readonly PolicyRule[] {
    return this.held ?? [];
  }

  defaultFile(): string | null {
    return this.file;
  }
}
