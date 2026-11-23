import type { PolicyRepository, PolicyRule } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { readPolicy } from "../../load-findings.js";

export class PolicyAdapter implements PolicyRepository {
  constructor(private readonly io: Io) {}

  rules(root: string): readonly PolicyRule[] | null {
    return readPolicy(this.io, root);
  }
}
