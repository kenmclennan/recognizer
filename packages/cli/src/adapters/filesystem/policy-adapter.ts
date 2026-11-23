import {
  InvalidRequest,
  type PolicyRepository,
  type PolicyRule,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { policyFile } from "../../config.js";
import { readPolicy } from "../../load-findings.js";
import { parsePolicy } from "./policy-translator.js";

export class PolicyAdapter implements PolicyRepository {
  constructor(private readonly io: Io) {}

  rules(root: string): readonly PolicyRule[] | null {
    return readPolicy(this.io, root);
  }

  rulesAt(path: string): readonly PolicyRule[] {
    let text: string;

    try {
      text = this.io.readFile(path);
    } catch {
      throw new InvalidRequest([`cannot read policy file: ${path}`]);
    }

    return parsePolicy(text);
  }

  defaultFile(root: string): string | null {
    const file = policyFile(root);

    return this.io.exists(file) ? file : null;
  }
}
